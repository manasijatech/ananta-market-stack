"""Flatten gated MCP describe_tools/execute_tool servers into first-class tools.

Some hosted MCP servers (Drishti) advertise a two-step protocol: describe_tools
returns a short-lived call_token, then execute_tool requires that token as a
top-level argument. Smaller models loop on that dance — they describe, then
call execute_tool without call_token (or nest it under arguments), then
describe again.

This module hides the gated pair from the model and exposes each described
capability as a normal FunctionTool that refreshes tokens internally.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from agents.mcp import create_static_tool_filter
from agents.tool import FunctionTool

logger = logging.getLogger(__name__)

DESCRIBE_TOOL_NAMES = frozenset({"describe_tools", "describe_tool"})
EXECUTE_TOOL_NAMES = frozenset({"execute_tool", "execute"})
DEFAULT_DESCRIBE_NAMES = (
    "get_daily_summary",
    "get_news",
    "get_top_movers",
    "get_price_and_volume",
    "get_events",
    "get_research",
    "get_filings",
    "get_morning_report",
    "get_evening_report",
)


def looks_like_call_token_error(message: str) -> bool:
    blob = message.lower()
    return (
        "call_token" in blob
        or "unexpired call_token" in blob
        or "describe the tool first" in blob
        or "describe the tool" in blob
    )


def parse_described_tools(payload: Any) -> list[dict[str, Any]]:
    data = _coerce_json(payload)
    items: list[Any] = []
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        for key in ("tools", "items", "result", "data"):
            value = data.get(key)
            if isinstance(value, list):
                items = value
                break
            if isinstance(value, dict) and isinstance(value.get("tools"), list):
                items = value["tools"]
                break
        else:
            if isinstance(data.get("name"), str):
                items = [data]
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        parsed = _parse_described_item(item)
        if not parsed or parsed["name"] in seen:
            continue
        seen.add(parsed["name"])
        out.append(parsed)
    return out


def mcp_result_payload(result: Any) -> Any:
    if result is None:
        return ""
    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        return structured
    parts: list[str] = []
    for item in getattr(result, "content", None) or []:
        text = getattr(item, "text", None)
        if isinstance(text, str) and text.strip():
            parts.append(text)
    joined = "\n".join(parts)
    if getattr(result, "isError", False):
        return {"ok": False, "retry": False, "message": joined or "MCP tool error"}
    return _coerce_json(joined) if joined else joined


async def flatten_gated_mcp_servers(servers: list[Any]) -> tuple[list[FunctionTool], list[str]]:
    """Hide describe/execute when present; wrap described tools if they are not listed natively."""

    wrappers: list[FunctionTool] = []
    exposed_names: list[str] = []
    for server in servers:
        try:
            listed = await server.list_tools()
        except Exception:
            logger.exception("Could not list MCP tools on %s", getattr(server, "name", server))
            continue
        names = [str(getattr(tool, "name", "") or "") for tool in listed]
        describe = _match_name(names, DESCRIBE_TOOL_NAMES)
        execute = _match_name(names, EXECUTE_TOOL_NAMES)
        if not describe or not execute:
            continue
        native = [name for name in names if name not in {describe, execute}]
        if native:
            server.tool_filter = create_static_tool_filter(blocked_tool_names=[describe, execute])
            exposed_names.extend(native)
            continue
        bridge = _GatedMcpBridge(server, describe=describe, execute=execute)
        described = await bridge.describe_all()
        if not described:
            continue
        server.tool_filter = create_static_tool_filter(blocked_tool_names=[describe, execute])
        for item in described:
            wrappers.append(_wrapper_for(bridge, item))
            exposed_names.append(item["name"])
    return wrappers, exposed_names


def _match_name(names: list[str], candidates: frozenset[str]) -> str | None:
    lowered = {name.lower(): name for name in names if name}
    for candidate in candidates:
        if candidate in lowered:
            return lowered[candidate]
    for name in names:
        leaf = name.rsplit("_", 1)[-1].lower() if "_" in name else name.lower()
        if name.lower() in candidates or leaf in candidates:
            return name
        if name.lower().endswith("describe_tools") and "describe_tools" in candidates:
            return name
        if name.lower().endswith("execute_tool") and "execute_tool" in candidates:
            return name
    return None


def _parse_described_item(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    name = item.get("name") or item.get("tool") or item.get("tool_name")
    if not isinstance(name, str) or not name.strip():
        return None
    cleaned = name.strip()
    if cleaned.lower() in DESCRIBE_TOOL_NAMES or cleaned.lower() in EXECUTE_TOOL_NAMES:
        return None
    schema = (
        item.get("inputSchema")
        or item.get("input_schema")
        or item.get("parameters")
        or item.get("schema")
        or {"type": "object", "properties": {}}
    )
    if not isinstance(schema, dict):
        schema = {"type": "object", "properties": {}}
    if schema.get("type") != "object":
        schema = {"type": "object", "properties": schema.get("properties") or {}, "additionalProperties": True}
    if "properties" not in schema:
        schema["properties"] = {}
    token = item.get("call_token") or item.get("token") or ""
    return {
        "name": cleaned,
        "description": str(item.get("description") or item.get("title") or cleaned),
        "call_token": str(token) if token else "",
        "schema": schema,
    }


def _coerce_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return ""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
        return text


class _GatedMcpBridge:
    def __init__(self, server: Any, *, describe: str, execute: str) -> None:
        self.server = server
        self.describe = describe
        self.execute = execute
        self.tokens: dict[str, str] = {}

    async def describe_all(self) -> list[dict[str, Any]]:
        items = parse_described_tools(await self._call(self.describe, {}))
        if not items:
            items = parse_described_tools(
                await self._call(self.describe, {"names": list(DEFAULT_DESCRIBE_NAMES)})
            )
        for item in items:
            token = item.get("call_token") or ""
            if token:
                self.tokens[item["name"]] = str(token)
        return items

    async def invoke(self, name: str, arguments: dict[str, Any]) -> Any:
        token = self.tokens.get(name) or ""
        if not token:
            await self._refresh_token(name)
            token = self.tokens.get(name) or ""
        payload = await self._execute(name, arguments, token)
        if looks_like_call_token_error(str(payload)):
            await self._refresh_token(name)
            token = self.tokens.get(name) or ""
            payload = await self._execute(name, arguments, token)
        if looks_like_call_token_error(str(payload)):
            return {
                "ok": False,
                "retry": False,
                "code": "mcp_call_token_failed",
                "message": (
                    f"Could not execute MCP tool {name}. Stop calling describe_tools/execute_tool. "
                    "Use intel_get_feed and any MCP results already gathered, then answer the user."
                ),
            }
        return payload

    async def _refresh_token(self, name: str) -> None:
        items = parse_described_tools(await self._call(self.describe, {"names": [name]}))
        for item in items:
            token = item.get("call_token") or ""
            if token:
                self.tokens[item["name"]] = str(token)

    async def _execute(self, name: str, arguments: dict[str, Any], token: str) -> Any:
        return await self._call(
            self.execute,
            {"name": name, "arguments": arguments or {}, "call_token": token},
        )

    async def _call(self, tool_name: str, arguments: dict[str, Any]) -> Any:
        result = await self.server.call_tool(tool_name, arguments)
        return mcp_result_payload(result)


def _wrapper_for(bridge: _GatedMcpBridge, item: dict[str, Any]) -> FunctionTool:
    tool_name = item["name"]
    schema = item["schema"]

    async def on_invoke(_ctx: Any, input_json: str) -> Any:
        try:
            arguments = json.loads(input_json) if input_json else {}
        except json.JSONDecodeError:
            return {
                "ok": False,
                "retry": True,
                "message": f"{tool_name} requires one JSON object matching its schema.",
            }
        if not isinstance(arguments, dict):
            arguments = {}
        try:
            return await bridge.invoke(tool_name, arguments)
        except Exception as exc:
            return {
                "ok": False,
                "retry": False,
                "message": f"MCP {tool_name} failed: {exc}. Do not retry the gated describe/execute loop. Continue with intel_get_feed.",
            }

    return FunctionTool(
        name=tool_name,
        description=item["description"]
        + " Call this tool directly. Do not use describe_tools or execute_tool.",
        params_json_schema=schema,
        on_invoke_tool=on_invoke,
        strict_json_schema=False,
    )
