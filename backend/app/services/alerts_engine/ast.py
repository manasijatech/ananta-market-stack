from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


AST_VERSION = 2


class AlertUniverseNode(BaseModel):
    kind: str = "static_symbols"
    symbols: list[dict[str, Any]] = Field(default_factory=list)
    watchlist_id: str | None = None
    preset_id: str | None = None
    filters: dict[str, Any] = Field(default_factory=dict)
    op: str | None = None
    children: list["AlertUniverseNode"] = Field(default_factory=list)
    label: str | None = None


class AlertLogicNode(BaseModel):
    kind: str = "condition"
    field: str | None = None
    operator: str | None = None
    value: float | int | str | bool | None = None
    compare_to: str | None = None
    window_seconds: int | None = None
    hold_seconds: int | None = None
    occurrences: int | None = None
    children: list["AlertLogicNode"] = Field(default_factory=list)


class AlertWorkflowAst(BaseModel):
    version: int = AST_VERSION
    target_universe: AlertUniverseNode = Field(default_factory=AlertUniverseNode)
    logic: AlertLogicNode = Field(default_factory=lambda: AlertLogicNode(kind="all"))
    cooldown_seconds: int = 300
    notification: dict[str, Any] = Field(default_factory=dict)
    channels: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


def ast_to_dict(ast: AlertWorkflowAst) -> dict[str, Any]:
    return ast.model_dump(exclude_none=True)


def _target_entry_to_symbol(entry: Any) -> dict[str, Any]:
    if hasattr(entry, "model_dump"):
        payload = entry.model_dump()
    else:
        payload = dict(entry or {})
    symbol = str(payload.get("symbol") or "").strip().upper()
    exchange = str(payload.get("exchange") or "").strip().upper() or None
    ref = payload.get("instrument_ref") or {}
    if hasattr(ref, "model_dump"):
        ref = ref.model_dump(exclude_none=True)
    return {
        "symbol": symbol,
        "exchange": exchange,
        "instrument_ref": ref,
        "label": payload.get("label"),
        "metadata": payload.get("metadata") or {},
    }


def _legacy_targeting_to_universe(targeting: Any) -> AlertUniverseNode:
    mode = getattr(targeting, "mode", None) or (targeting or {}).get("mode", "single_symbol")
    entries = getattr(targeting, "entries", None) if not isinstance(targeting, dict) else targeting.get("entries", [])
    symbols = [_target_entry_to_symbol(entry) for entry in entries or []]
    symbols = [item for item in symbols if item.get("symbol")]
    filters = getattr(targeting, "filters", None) if not isinstance(targeting, dict) else targeting.get("filters", {})
    preset_id = getattr(targeting, "preset_id", None) if not isinstance(targeting, dict) else targeting.get("preset_id")
    preset_label = getattr(targeting, "preset_label", None) if not isinstance(targeting, dict) else targeting.get("preset_label")
    if mode == "preset_universe" and preset_id:
        return AlertUniverseNode(kind="curated_preset", preset_id=preset_id, label=preset_label, filters=filters or {})
    return AlertUniverseNode(kind="static_symbols", symbols=symbols, label=preset_label, filters=filters or {})


def _legacy_conditions_to_logic(combine: str, conditions: list[Any]) -> AlertLogicNode:
    children: list[AlertLogicNode] = []
    for condition in conditions:
        payload = condition.model_dump(exclude_none=True) if hasattr(condition, "model_dump") else dict(condition or {})
        children.append(
            AlertLogicNode(
                kind="condition",
                field=payload.get("field"),
                operator=payload.get("operator"),
                value=payload.get("value"),
                compare_to=payload.get("compare_to"),
                window_seconds=payload.get("window_seconds"),
            )
        )
    return AlertLogicNode(kind="any" if combine == "any" else "all", children=children)


def ensure_workflow_ast(dsl: Any) -> AlertWorkflowAst:
    """Return a v2 AST for either a new DSL payload or a legacy rule payload."""

    if hasattr(dsl, "model_dump"):
        payload = dsl.model_dump()
    else:
        payload = dict(dsl or {})
    existing = payload.get("workflow_ast")
    if isinstance(existing, AlertWorkflowAst):
        return existing
    if isinstance(existing, dict) and existing:
        return AlertWorkflowAst(**existing)

    combine = str(payload.get("combine") or "all")
    conditions = payload.get("conditions") or []
    targeting = payload.get("targeting") or {}
    notification = payload.get("notification") or {}
    channels = payload.get("channels") or {}
    return AlertWorkflowAst(
        target_universe=_legacy_targeting_to_universe(targeting),
        logic=_legacy_conditions_to_logic(combine, conditions),
        cooldown_seconds=int(payload.get("cooldown_seconds") or 300),
        notification=notification.model_dump() if hasattr(notification, "model_dump") else dict(notification or {}),
        channels=channels.model_dump() if hasattr(channels, "model_dump") else dict(channels or {}),
        metadata={"migrated_from": "legacy_rule"},
    )

