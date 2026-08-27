"""AG-UI and A2UI adapters over Adaptive Workspace.

These are translation layers. Chat still streams existing broker-chat SSE.
The canvas still renders a validated WorkspaceSpec through the Ananta registry.
"""

from __future__ import annotations

import json
from typing import Any

from app.schemas.adaptive_workspace import (
    A2UI_CATALOG_ID,
    A2UI_VERSION,
    ALLOWED_COMPONENT_TYPES,
    MICRO_APP_KINDS,
    WorkspaceSpec,
    workspace_spec_dump,
)
from app.services.adaptive_workspace import parse_spec_or_error, validation_payload

AGUI_PROTOCOL = "ag-ui"
A2UI_ROOT_ID = "a2ui-root"
A2UI_GRID_TYPES = frozenset({"Grid", "Column", "Row"})

MICRO_APP_REGISTRY: dict[str, dict[str, Any]] = {
    "payoff-diagram": {
        "id": "payoff-diagram",
        "label": "Options payoff",
        "description": "Sandboxed P/L toy for a call, put, or straddle. Numbers only; no orders.",
        "actions": ["select", "refresh"],
        "default_props": {
            "appId": "payoff-diagram",
            "kind": "straddle",
            "spot": 25000,
            "strike": 25000,
            "premium": 180,
            "width_pct": 8,
        },
    },
}


def _json_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, default=str, ensure_ascii=False)
    except TypeError:
        return str(value)


def _payload(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload")
    return payload if isinstance(payload, dict) else {}


def broker_events_to_agui(
    events: list[dict[str, Any]],
    *,
    thread_id: str,
    run_id: str,
    spec: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Map stored broker-chat SSE events onto AG-UI event objects.

    Does not replace the Ananta stream. Token/tool/run events stay on SSE;
    this function is a derived view for the inspector and export tools.
    """

    mapped: list[dict[str, Any]] = [
        {"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id},
    ]
    if isinstance(spec, dict):
        mapped.append({"type": "STATE_SNAPSHOT", "snapshot": {"spec": spec}})

    message_id = f"{run_id}:assistant"
    reasoning_id = f"{run_id}:reasoning"
    text_open = False
    reasoning_open = False
    streamed_tokens = False
    finished = False

    def close_text() -> None:
        nonlocal text_open
        if text_open:
            mapped.append({"type": "TEXT_MESSAGE_END", "messageId": message_id})
            text_open = False

    def close_reasoning() -> None:
        nonlocal reasoning_open
        if reasoning_open:
            mapped.append({"type": "REASONING_MESSAGE_END", "messageId": reasoning_id})
            mapped.append({"type": "REASONING_END", "messageId": reasoning_id})
            reasoning_open = False

    def open_text() -> None:
        nonlocal text_open
        if not text_open:
            close_reasoning()
            mapped.append({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": "assistant"})
            text_open = True

    ordered = sorted(events, key=lambda item: int(item.get("sequence") or 0))
    for event in ordered:
        event_type = str(event.get("event_type") or "")
        payload = _payload(event)
        sequence = event.get("sequence")

        if event_type in {"run_started", "response_started", "response_completed", "agent_updated"}:
            continue

        if event_type == "token":
            delta = payload.get("text")
            if not isinstance(delta, str) or not delta:
                continue
            open_text()
            mapped.append({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": delta})
            streamed_tokens = True
            continue

        if event_type == "reasoning":
            message = payload.get("message")
            if not isinstance(message, str) or not message:
                continue
            if not reasoning_open:
                close_text()
                mapped.append({"type": "REASONING_START", "messageId": reasoning_id})
                mapped.append({"type": "REASONING_MESSAGE_START", "messageId": reasoning_id, "role": "reasoning"})
                reasoning_open = True
            mapped.append({"type": "REASONING_MESSAGE_CONTENT", "messageId": reasoning_id, "delta": message})
            continue

        if event_type == "tool_call_started":
            close_text()
            close_reasoning()
            call_id = payload.get("tool_call_id") or f"{run_id}:tool:{sequence}"
            name = payload.get("tool_name") or "tool"
            mapped.append(
                {
                    "type": "TOOL_CALL_START",
                    "toolCallId": str(call_id),
                    "toolCallName": str(name),
                    "parentMessageId": message_id,
                }
            )
            arguments = payload.get("arguments")
            if arguments is not None:
                mapped.append({"type": "TOOL_CALL_ARGS", "toolCallId": str(call_id), "delta": _json_text(arguments)})
            continue

        if event_type == "tool_call_completed":
            close_text()
            close_reasoning()
            call_id = payload.get("tool_call_id") or f"{run_id}:tool-end:{sequence}"
            mapped.append({"type": "TOOL_CALL_END", "toolCallId": str(call_id)})
            content = payload.get("output")
            if content is None:
                content = payload.get("output_metadata")
            mapped.append(
                {
                    "type": "TOOL_CALL_RESULT",
                    "messageId": f"{run_id}:tool-result:{sequence}",
                    "toolCallId": str(call_id),
                    "content": _json_text(content),
                    "role": "tool",
                }
            )
            continue

        if event_type == "message_output":
            close_reasoning()
            content = payload.get("content")
            if not streamed_tokens and isinstance(content, str) and content:
                open_text()
                mapped.append({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": content})
            continue

        if event_type == "run_completed":
            close_reasoning()
            close_text()
            if isinstance(spec, dict):
                mapped.append({"type": "STATE_SNAPSHOT", "snapshot": {"spec": spec}})
            mapped.append({"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id})
            finished = True
            continue

        if event_type in {"run_failed", "run_cancelled"}:
            close_reasoning()
            close_text()
            mapped.append(
                {
                    "type": "RUN_ERROR",
                    "message": str(payload.get("message") or event_type),
                    "code": event_type,
                }
            )
            finished = True

    if not finished and isinstance(spec, dict):
        mapped.append({"type": "STATE_SNAPSHOT", "snapshot": {"spec": spec}})
    return mapped


def desk_state_agui(*, thread_id: str, run_id: str, spec: dict[str, Any] | None) -> list[dict[str, Any]]:
    events = [
        {"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id},
        {"type": "STATE_SNAPSHOT", "snapshot": {"spec": spec or {}}},
        {"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id},
    ]
    return events


def _component_type_from_a2ui(entry: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    raw = entry.get("component")
    if isinstance(raw, str):
        fields = {key: value for key, value in entry.items() if key not in {"id", "component", "weight"}}
        return raw, fields
    if isinstance(raw, dict) and len(raw) == 1:
        name, fields = next(iter(raw.items()))
        return str(name), fields if isinstance(fields, dict) else {}
    return None, {}


def workspace_spec_to_a2ui(spec: WorkspaceSpec, *, surface_id: str = "desk") -> list[dict[str, Any]]:
    dumped = workspace_spec_dump(spec)
    children = [item["id"] for item in dumped["components"]]
    components: list[dict[str, Any]] = [
        {
            "id": A2UI_ROOT_ID,
            "component": "Grid",
            "columns": 12,
            "children": children,
        }
    ]
    for item in dumped["components"]:
        components.append(
            {
                "id": item["id"],
                "component": item["type"],
                "position": item["position"],
                "data": item.get("data"),
                "props": item.get("props") or {},
                "actions": item.get("actions") or [],
            }
        )
    return [
        {
            "version": A2UI_VERSION,
            "createSurface": {"surfaceId": surface_id, "catalogId": A2UI_CATALOG_ID},
        },
        {
            "version": A2UI_VERSION,
            "updateComponents": {"surfaceId": surface_id, "components": components},
        },
        {
            "version": A2UI_VERSION,
            "updateDataModel": {
                "surfaceId": surface_id,
                "path": "/",
                "value": {
                    "title": dumped["title"],
                    "version": dumped["version"],
                    "layout": dumped["layout"],
                },
            },
        },
    ]


def a2ui_to_workspace_spec(messages: Any) -> tuple[WorkspaceSpec | None, dict[str, Any]]:
    if isinstance(messages, dict) and isinstance(messages.get("messages"), list):
        messages = messages["messages"]
    if not isinstance(messages, list) or not messages:
        return None, validation_payload(issues=[{"path": "", "message": "A2UI messages must be a non-empty list"}])

    catalog_id: str | None = None
    title = "Untitled desk"
    layout = {"mode": "grid", "columns": 12}
    collected: list[dict[str, Any]] = []

    for index, message in enumerate(messages):
        path = f"messages.{index}"
        if not isinstance(message, dict):
            return None, validation_payload(issues=[{"path": path, "message": "A2UI message must be an object"}])
        version = message.get("version")
        if version not in {A2UI_VERSION, "0.9", None}:
            return None, validation_payload(issues=[{"path": f"{path}.version", "message": f"unsupported A2UI version {version!r}"}])
        if "createSurface" in message:
            surface = message.get("createSurface")
            if not isinstance(surface, dict):
                return None, validation_payload(issues=[{"path": f"{path}.createSurface", "message": "createSurface must be an object"}])
            catalog_id = surface.get("catalogId")
            if catalog_id not in {A2UI_CATALOG_ID, None}:
                return None, validation_payload(
                    issues=[{"path": f"{path}.createSurface.catalogId", "message": f"catalog must be {A2UI_CATALOG_ID}"}]
                )
            continue
        if "updateDataModel" in message:
            model = message.get("updateDataModel")
            if not isinstance(model, dict):
                continue
            value = model.get("value")
            if isinstance(value, dict):
                if isinstance(value.get("title"), str) and value["title"].strip():
                    title = value["title"]
                if isinstance(value.get("layout"), dict):
                    layout = value["layout"]
            continue
        if "updateComponents" not in message:
            if set(message.keys()) <= {"version", "deleteSurface"}:
                continue
            return None, validation_payload(issues=[{"path": path, "message": "unsupported A2UI message"}])
        update = message.get("updateComponents")
        if not isinstance(update, dict) or not isinstance(update.get("components"), list):
            return None, validation_payload(issues=[{"path": f"{path}.updateComponents", "message": "components must be a list"}])
        for component_index, entry in enumerate(update["components"]):
            component_path = f"{path}.updateComponents.components.{component_index}"
            if not isinstance(entry, dict):
                return None, validation_payload(issues=[{"path": component_path, "message": "component must be an object"}])
            component_type, fields = _component_type_from_a2ui(entry)
            if component_type is None:
                return None, validation_payload(issues=[{"path": f"{component_path}.component", "message": "component discriminator is required"}])
            if component_type in A2UI_GRID_TYPES or entry.get("id") == A2UI_ROOT_ID:
                continue
            if component_type not in ALLOWED_COMPONENT_TYPES:
                return None, validation_payload(
                    issues=[{"path": f"{component_path}.component", "message": f"component type {component_type!r} is not in the catalog"}]
                )
            component_id = entry.get("id")
            if not isinstance(component_id, str):
                return None, validation_payload(issues=[{"path": f"{component_path}.id", "message": "component id is required"}])
            position = fields.get("position") if isinstance(fields.get("position"), dict) else entry.get("position")
            data = fields.get("data", entry.get("data"))
            props = fields.get("props", entry.get("props"))
            actions = fields.get("actions", entry.get("actions"))
            item: dict[str, Any] = {
                "id": component_id,
                "type": component_type,
                "position": position or {"x": 0, "y": 0, "w": 6, "h": 3},
            }
            if data is not None:
                item["data"] = data
            if props is not None:
                item["props"] = props
            if actions is not None:
                item["actions"] = actions
            collected.append(item)

    if catalog_id not in {A2UI_CATALOG_ID, None}:
        return None, validation_payload(issues=[{"path": "createSurface.catalogId", "message": f"catalog must be {A2UI_CATALOG_ID}"}])

    parsed, validation = parse_spec_or_error(
        {
            "version": "1",
            "title": title,
            "layout": layout,
            "components": collected,
        }
    )
    return parsed, validation


def round_trip_a2ui(spec: WorkspaceSpec, *, surface_id: str = "desk") -> tuple[WorkspaceSpec | None, dict[str, Any], list[dict[str, Any]]]:
    messages = workspace_spec_to_a2ui(spec, surface_id=surface_id)
    parsed, validation = a2ui_to_workspace_spec(messages)
    return parsed, validation, messages


def list_micro_apps() -> list[dict[str, Any]]:
    return [dict(item) for item in MICRO_APP_REGISTRY.values()]


def get_micro_app(app_id: str) -> dict[str, Any]:
    item = MICRO_APP_REGISTRY.get(app_id)
    if item is None:
        raise ValueError("micro-app is not in the curated registry")
    return dict(item)


def _finite_number(value: Any, *, lo: float, hi: float, default: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    number = float(value)
    if number != number or number in {float("inf"), float("-inf")}:
        return default
    return max(lo, min(hi, number))


def bind_micro_app_payload(app_id: str, props: dict[str, Any] | None = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
    app = get_micro_app(app_id)
    source = {**(app.get("default_props") or {}), **(params or {}), **(props or {})}
    bound: dict[str, Any] = {"appId": app_id}
    if app_id == "payoff-diagram":
        kind = source.get("kind") if source.get("kind") in MICRO_APP_KINDS else "straddle"
        bound.update(
            {
                "kind": kind,
                "spot": _finite_number(source.get("spot"), lo=0.01, hi=10_000_000, default=25000),
                "strike": _finite_number(source.get("strike"), lo=0.01, hi=10_000_000, default=25000),
                "premium": _finite_number(source.get("premium"), lo=0, hi=1_000_000, default=180),
                "width_pct": _finite_number(source.get("width_pct"), lo=1, hi=50, default=8),
            }
        )
        return bound
    raise ValueError("micro-app is not in the curated registry")

