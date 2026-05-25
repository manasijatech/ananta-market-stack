from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from agents.mcp import MCPServerManager, MCPServerSse, MCPServerStreamableHttp
from agents.run_context import RunContextWrapper
from sqlalchemy.orm import Session

from app.services import broker_chat, mcp_config
from db.models import BrokerChatRun


@dataclass
class BrokerChatMcpHandle:
    """Connected MCP server lifecycle for one broker-chat run."""

    manager: MCPServerManager | None
    active_servers: list[Any]
    enabled: bool
    inventory: dict[str, Any] | None = None

    async def close(self) -> None:
        if self.manager is None:
            return
        try:
            await self.manager.__aexit__(None, None, None)
        except Exception:
            pass


def broker_chat_mcp_config() -> dict[str, Any]:
    """Agent-level MCP behavior recommended for this chat surface."""

    return {
        "convert_schemas_to_strict": True,
        "include_server_in_tool_names": True,
        "failure_error_function": mcp_tool_failure_message,
    }


def mcp_tool_failure_message(_context: RunContextWrapper[Any], error: Exception) -> str:
    """Return a model-visible, recoverable MCP tool error."""

    message = mcp_config.describe_exception(error)
    if _looks_like_json_argument_error(message):
        return (
            "Recoverable MCP tool argument error. The previous MCP tool call did not contain exactly one valid JSON object. "
            "Retry the same tool once with one JSON object matching that tool's schema. "
            "Do not concatenate JSON objects or combine multiple tool calls into one call. "
            f"Parser error: {message}"
        )
    return (
        "Recoverable MCP tool error. Do not fail the whole chat because of this single MCP call. "
        "If the request can be corrected, retry once with valid arguments; otherwise continue with other MCP/local tools or explain the unavailable source. "
        f"Tool error: {message}"
    )


def _looks_like_json_argument_error(message: str) -> bool:
    lowered = message.lower()
    return (
        "invalid json input" in lowered
        or "parsing tool arguments" in lowered
        or "jsondecodeerror" in lowered
        or "extra data" in lowered
        or "expected a json object" in lowered
    )


def mcp_context_instructions(handle: BrokerChatMcpHandle) -> str:
    if not handle.enabled or not handle.active_servers:
        return ""
    inventory = handle.inventory or {}
    sections = [
        "MCP is connected for this run. Treat connected MCP servers as additional tool and context providers. "
        "Use their advertised tools, prompts, and resources according to the server-provided names, descriptions, schemas, and the user's request. "
        "For the user's connected broker account and portfolio state, local broker tools remain the authoritative source."
    ]
    inventory_sections: list[str] = []
    servers = inventory.get("servers")
    if isinstance(servers, list) and servers:
        inventory_sections.append(f"Servers:\n{_inventory_json(servers)}")
    for label, key in (("Tools", "tools"), ("Prompts", "prompts"), ("Resources", "resources")):
        value = inventory.get(key)
        if value:
            inventory_sections.append(f"{label}:\n{_inventory_json(value)}")
    errors = inventory.get("errors")
    if errors:
        inventory_sections.append(f"Inventory listing notes:\n{_inventory_json(errors)}")
    if inventory_sections:
        sections.append(
            "Cached MCP inventory follows. It is not a whitelist; live MCP tool availability is determined by the connected server.\n\n"
            + "\n\n".join(inventory_sections)
        )
    return "\n\n".join(sections)


def _inventory_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _build_mcp_server(connection: mcp_config.McpConnectionConfig):
    params = {
        "url": connection.url,
        "headers": connection.headers,
        "timeout": float(connection.timeout_seconds),
        "sse_read_timeout": float(max(connection.timeout_seconds, 30)),
    }
    kwargs = {
        "cache_tools_list": True,
        "name": connection.name or f"MCP server {connection.id}",
        "client_session_timeout_seconds": float(connection.timeout_seconds),
        "max_retry_attempts": 2,
        "retry_backoff_seconds_base": 0.75,
        "require_approval": "never",
        "failure_error_function": mcp_tool_failure_message,
    }
    if connection.transport == "sse":
        return MCPServerSse(params, **kwargs)
    return MCPServerStreamableHttp(params, **kwargs)


async def connect_broker_chat_mcp(
    db: Session,
    run: BrokerChatRun,
    metadata: dict[str, Any],
) -> BrokerChatMcpHandle:
    """Connect configured MCP servers for one run, dropping failures safely.

    The broker chat can operate without MCP. Any configuration or connection
    failure is persisted as a chat event and the caller receives an empty active
    server list so local broker tools still work.
    """

    if not metadata.get("use_mcp"):
        return BrokerChatMcpHandle(manager=None, active_servers=[], enabled=False)

    selected_server_ids = _selected_server_ids(metadata)
    for server_id in mcp_config.stale_mcp_server_ids(db, run.user_id, selected_server_ids):
        try:
            mcp_schema = await mcp_config.refresh_mcp_inventory(db, run.user_id, server_id)
            if mcp_schema.inventory_error:
                broker_chat.append_event(
                    db,
                    run,
                    event_type="mcp_inventory_refresh_failed",
                    public_payload={"status": "failed", "message": "Could not refresh MCP capabilities."},
                    full_payload={"status": "failed", "server_id": server_id, "message": mcp_schema.inventory_error},
                )
            else:
                broker_chat.append_event(
                    db,
                    run,
                    event_type="mcp_inventory_refreshed",
                    public_payload={
                        "status": "refreshed",
                        "server_id": server_id,
                        "name": mcp_schema.name,
                        "tool_count": len(mcp_schema.inventory.get("tools", [])),
                        "prompt_count": len(mcp_schema.inventory.get("prompts", [])),
                        "resource_count": len(mcp_schema.inventory.get("resources", [])),
                    },
                    full_payload={"status": "refreshed", "server_id": server_id, "inventory": mcp_schema.inventory},
                )
        except Exception as exc:
            broker_chat.append_event(
                db,
                run,
                event_type="mcp_inventory_refresh_failed",
                public_payload={"status": "failed", "message": "Could not refresh MCP capabilities."},
                full_payload={
                    "status": "failed",
                    "server_id": server_id,
                    "message": str(exc),
                    "error_type": exc.__class__.__name__,
                },
            )

    try:
        connections = mcp_config.get_enabled_mcp_connections(db, run.user_id, selected_server_ids)
    except Exception as exc:
        broker_chat.append_event(
            db,
            run,
            event_type="mcp_unavailable",
            public_payload={"status": "unavailable", "message": "MCP configuration is invalid."},
            full_payload={"status": "unavailable", "message": str(exc), "error_type": exc.__class__.__name__},
        )
        return BrokerChatMcpHandle(manager=None, active_servers=[], enabled=True)

    if not connections:
        broker_chat.append_event(
            db,
            run,
            event_type="mcp_unavailable",
            public_payload={"status": "disabled", "message": "MCP is not enabled in System Config."},
        )
        return BrokerChatMcpHandle(manager=None, active_servers=[], enabled=True)

    servers = [_build_mcp_server(connection) for connection in connections]
    manager = MCPServerManager(
        servers,
        connect_timeout_seconds=float(max(connection.timeout_seconds for connection in connections)),
        cleanup_timeout_seconds=5.0,
        drop_failed_servers=True,
        strict=False,
        connect_in_parallel=True,
    )
    await manager.__aenter__()

    if manager.errors:
        for failed_server, exc in manager.errors.items():
            broker_chat.append_event(
                db,
                run,
                event_type="mcp_connection_failed",
                public_payload={"status": "failed", "message": "Could not connect to the configured MCP server."},
                full_payload={
                    "status": "failed",
                    "message": str(exc),
                    "error_type": exc.__class__.__name__,
                    "server": getattr(failed_server, "name", None) or str(failed_server),
                },
            )

    if not manager.active_servers:
        await manager.__aexit__(None, None, None)
        return BrokerChatMcpHandle(manager=None, active_servers=[], enabled=True)

    inventory = _combined_inventory(connections)
    tool_count = len(inventory.get("tools", [])) if isinstance(inventory.get("tools"), list) else 0
    prompt_count = len(inventory.get("prompts", [])) if isinstance(inventory.get("prompts"), list) else 0
    resource_count = len(inventory.get("resources", [])) if isinstance(inventory.get("resources"), list) else 0

    broker_chat.append_event(
        db,
        run,
        event_type="mcp_connected",
        public_payload={
            "status": "connected",
            "server_names": [connection.name for connection in connections],
            "server_count": len(manager.active_servers),
            "tool_count": tool_count,
            "prompt_count": prompt_count,
            "resource_count": resource_count,
        },
        full_payload={
            "status": "connected",
            "servers": [
                {
                    "id": connection.id,
                    "name": connection.name,
                    "url": connection.url,
                    "transport": connection.transport,
                }
                for connection in connections
            ],
            "server_count": len(manager.active_servers),
            "inventory": inventory,
        },
    )
    return BrokerChatMcpHandle(
        manager=manager,
        active_servers=list(manager.active_servers),
        enabled=True,
        inventory=inventory,
    )


def _selected_server_ids(metadata: dict[str, Any]) -> list[str] | None:
    raw = metadata.get("mcp_server_ids")
    if not isinstance(raw, list):
        return None
    return [str(item) for item in raw if str(item).strip()]


def _combined_inventory(connections: list[mcp_config.McpConnectionConfig]) -> dict[str, Any]:
    combined: dict[str, Any] = {"servers": [], "tools": [], "prompts": [], "resources": []}
    errors: dict[str, Any] = {}
    for connection in connections:
        inventory = connection.inventory or {}
        combined["servers"].append({"id": connection.id, "name": connection.name, "transport": connection.transport})
        for key in ("tools", "prompts", "resources"):
            items = inventory.get(key)
            if not isinstance(items, list):
                continue
            for item in items:
                combined[key].append({"server_id": connection.id, "server_name": connection.name, **(item if isinstance(item, dict) else {"value": item})})
        if inventory.get("errors"):
            errors[connection.id] = inventory.get("errors")
    if errors:
        combined["errors"] = errors
    return combined
