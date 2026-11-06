"""Choose direct tool schemas or one code_run tool for a broker-chat turn."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from app.agent_harness.code_mode import (
    DEFERRED_PREFIXES,
    HYBRID_DIRECT_TOOLS,
    MCP_GATE_TOOLS,
    api_tools,
    auto_strategy,
    select_strategy,
    strategy_instructions,
)
from app.agent_tools.code_mode_tools import make_code_run
from app.config import get_settings
from app.execution_planes.code_sandbox_client import sandbox_status

logger = logging.getLogger(__name__)


@dataclass
class CodeModePlan:
    mode: str
    tools: list[Any]
    mcp_servers: list[Any]
    instruction: str = ""
    event: dict[str, Any] | None = None
    api_names: list[str] = field(default_factory=list)
    # Set when CHAT_TOOL_MODE is auto: {strategy, reason} for tool_strategy_selected.
    strategy: dict[str, Any] | None = None


def build_code_tool_event(kind: str, payload: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Shape inner code_run calls like the runner's tool_call_* events."""
    from app.agent_tools.tool_labels import decorate_tool_payload

    tool_name = str(payload.get("tool_name") or "tool")
    public = decorate_tool_payload(
        tool_name,
        {
            "tool_name": tool_name,
            "tool_call_id": payload.get("tool_call_id"),
            "parent_tool": payload.get("parent_tool") or "code_run",
            "parent_tool_call_id": payload.get("parent_tool_call_id"),
        },
    )
    if payload.get("cached") is not None:
        public["cached"] = payload.get("cached")
    if kind == "tool_call_started":
        public["arguments"] = payload.get("arguments")
    else:
        output = payload.get("output")
        text = json.dumps(output, default=str, ensure_ascii=False) if not isinstance(output, str) else output
        public["ok"] = payload.get("ok")
        public["output_metadata"] = {"type": type(output).__name__, "length": len(text), "preview": text[:300]}
    return public, {**payload, **public}


def requested_tool_mode(metadata: dict | None) -> str:
    """Server setting wins. Client metadata is ignored unless the server flag allows it."""
    settings = get_settings()
    accepted = {"direct", "code_mode", "hybrid", "auto"}
    mode = settings.chat_tool_mode if settings.chat_tool_mode in accepted else "direct"
    if not settings.chat_tool_mode_allow_metadata_override or not isinstance(metadata, dict):
        return mode
    override = metadata.get("chat_tool_mode")
    if isinstance(override, str):
        cleaned = override.strip().lower()
        if cleaned in accepted:
            return cleaned
    return mode


def _dedupe(tools: list[Any]) -> list[Any]:
    seen: set[str] = set()
    chosen: list[Any] = []
    for tool in tools:
        name = getattr(tool, "name", None)
        if not isinstance(name, str) or name in seen:
            continue
        seen.add(name)
        chosen.append(tool)
    return chosen


async def function_tools_from_mcp_servers(servers: list[Any]) -> tuple[list[Any], list[Any]]:
    """Convert MCP servers to FunctionTools. On failure, return the servers unchanged."""
    if not servers:
        return [], []
    try:
        from agents.mcp import MCPUtil
        from agents.run_context import RunContextWrapper

        converted = await MCPUtil.get_all_function_tools(
            list(servers),
            False,
            RunContextWrapper(context=None),
            None,
        )
    except Exception:
        logger.exception("code mode could not convert MCP servers into function tools")
        return [], list(servers)
    return list(converted), []


async def prepare_broker_chat_tools(
    *,
    metadata: dict | None,
    local_tools: list[Any],
    mcp_handle: Any,
    user_id: str,
    session_key: str,
    emit,
    message: str | None = None,
    route: str | None = None,
) -> CodeModePlan:
    servers = list(getattr(mcp_handle, "active_servers", None) or [])
    requested = requested_tool_mode(metadata)
    strategy = None
    instruction_mode = None
    if requested == "auto":
        chosen, why = auto_strategy(message, route)
        strategy = {"strategy": chosen, "reason": why}
        instruction_mode = "auto" if chosen == "code_mode" else None
        requested = chosen
    if requested not in {"code_mode", "hybrid"}:
        return CodeModePlan(mode="direct", tools=list(local_tools), mcp_servers=servers, strategy=strategy)
    try:
        available, reason = await sandbox_status()
        chosen = select_strategy(
            requested,
            SimpleNamespace(available=available, capabilities=("python.bridge",) if available else ()),
        )
        if chosen == "direct":
            return CodeModePlan(
                mode="direct",
                tools=list(local_tools),
                mcp_servers=servers,
                event={"fallback": "direct", "reason": reason or "sandbox_unavailable"},
                strategy=strategy,
            )
        converted, failed = await function_tools_from_mcp_servers(servers)
        if failed:
            return CodeModePlan(
                mode="direct",
                tools=list(local_tools),
                mcp_servers=servers,
                event={"fallback": "direct", "reason": "mcp_conversion_failed"},
                strategy=strategy,
            )
        extra = list(getattr(mcp_handle, "extra_tools", None) or [])
        merged = _dedupe([*local_tools, *extra, *converted])
        mcp_names = {tool.name for tool in extra} | {tool.name for tool in converted}
        flattened = getattr(mcp_handle, "flattened_tool_names", None) or []
        mcp_names.update(name for name in flattened if isinstance(name, str))
        reads = api_tools(merged, mcp_names=mcp_names)
        read_names = {tool.name for tool in reads}
        hybrid = chosen == "hybrid"
        direct_names = HYBRID_DIRECT_TOOLS & read_names if hybrid else set()
        kept = [
            tool for tool in merged
            if (tool.name not in read_names or tool.name in direct_names)
            and tool.name not in MCP_GATE_TOOLS
            and not str(tool.name).startswith(DEFERRED_PREFIXES)
        ]
        present = {tool.name for tool in kept}
        kept.extend(tool for tool in reads if tool.name in direct_names and tool.name not in present)
        kept.append(make_code_run(
            reads, user_id=user_id, session_key=session_key, emit=emit, direct_fallback=hybrid,
        ))
        return CodeModePlan(
            mode="hybrid" if hybrid else "code_mode",
            tools=kept,
            mcp_servers=[],
            instruction=strategy_instructions(instruction_mode or hybrid),
            api_names=[tool.name for tool in reads],
            strategy=strategy,
        )
    except Exception:
        logger.exception("code mode setup failed; falling back to direct tools")
        return CodeModePlan(
            mode="direct",
            tools=list(local_tools),
            mcp_servers=servers,
            event={"fallback": "direct", "reason": "code_mode_error"},
            strategy=strategy,
        )
