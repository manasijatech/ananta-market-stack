from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from agents.mcp import MCPServerManager, MCPServerSse, MCPServerStreamableHttp
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
    }


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
        "cache_tools_list": connection.tool_cache_enabled,
        "name": connection.name or "Configured MCP server",
        "client_session_timeout_seconds": float(connection.timeout_seconds),
        "max_retry_attempts": 2,
        "retry_backoff_seconds_base": 0.75,
        "require_approval": "never",
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

    if mcp_config.mcp_inventory_is_stale(db, run.user_id):
        try:
            mcp_schema = await mcp_config.refresh_mcp_inventory(db, run.user_id)
            if mcp_schema.inventory_error:
                broker_chat.append_event(
                    db,
                    run,
                    event_type="mcp_inventory_refresh_failed",
                    public_payload={"status": "failed", "message": "Could not refresh MCP capabilities."},
                    full_payload={"status": "failed", "message": mcp_schema.inventory_error},
                )
            else:
                broker_chat.append_event(
                    db,
                    run,
                    event_type="mcp_inventory_refreshed",
                    public_payload={
                        "status": "refreshed",
                        "tool_count": len(mcp_schema.inventory.get("tools", [])),
                        "prompt_count": len(mcp_schema.inventory.get("prompts", [])),
                        "resource_count": len(mcp_schema.inventory.get("resources", [])),
                    },
                    full_payload={"status": "refreshed", "inventory": mcp_schema.inventory},
                )
        except Exception as exc:
            broker_chat.append_event(
                db,
                run,
                event_type="mcp_inventory_refresh_failed",
                public_payload={"status": "failed", "message": "Could not refresh MCP capabilities."},
                full_payload={"status": "failed", "message": str(exc), "error_type": exc.__class__.__name__},
            )

    try:
        connection = mcp_config.get_enabled_mcp_connection(db, run.user_id)
    except Exception as exc:
        broker_chat.append_event(
            db,
            run,
            event_type="mcp_unavailable",
            public_payload={"status": "unavailable", "message": "MCP configuration is invalid."},
            full_payload={"status": "unavailable", "message": str(exc), "error_type": exc.__class__.__name__},
        )
        return BrokerChatMcpHandle(manager=None, active_servers=[], enabled=True)

    if connection is None:
        broker_chat.append_event(
            db,
            run,
            event_type="mcp_unavailable",
            public_payload={"status": "disabled", "message": "MCP is not enabled in System Config."},
        )
        return BrokerChatMcpHandle(manager=None, active_servers=[], enabled=True)

    server = _build_mcp_server(connection)
    manager = MCPServerManager(
        [server],
        connect_timeout_seconds=float(connection.timeout_seconds),
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
                    "url": connection.url,
                    "transport": connection.transport,
                },
            )

    if not manager.active_servers:
        await manager.__aexit__(None, None, None)
        return BrokerChatMcpHandle(manager=None, active_servers=[], enabled=True)

    inventory = connection.inventory or {}
    tool_count = len(inventory.get("tools", [])) if isinstance(inventory.get("tools"), list) else 0
    prompt_count = len(inventory.get("prompts", [])) if isinstance(inventory.get("prompts"), list) else 0
    resource_count = len(inventory.get("resources", [])) if isinstance(inventory.get("resources"), list) else 0

    broker_chat.append_event(
        db,
        run,
        event_type="mcp_connected",
        public_payload={
            "status": "connected",
            "name": connection.name,
            "transport": connection.transport,
            "server_count": len(manager.active_servers),
            "tool_count": tool_count,
            "prompt_count": prompt_count,
            "resource_count": resource_count,
        },
        full_payload={
            "status": "connected",
            "name": connection.name,
            "url": connection.url,
            "transport": connection.transport,
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
