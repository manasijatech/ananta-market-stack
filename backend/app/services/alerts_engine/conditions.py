from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from app.services.alerts_engine.ast import AlertLogicNode


@dataclass(frozen=True)
class ConditionEvaluation:
    matched: bool
    reason: str
    details: dict[str, Any]


@dataclass(frozen=True)
class ConditionDefinition:
    operator: str
    label: str
    description: str
    family: str
    fields: list[str]
    evaluator: Callable[[AlertLogicNode, dict[str, Any], dict[str, Any]], ConditionEvaluation]


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _values(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> tuple[float | None, float | None]:
    current = _as_float(tick.get(node.field or ""))
    if node.compare_to:
        reference = _as_float(tick.get(node.compare_to))
    else:
        reference = _as_float(previous.get(node.field or ""))
    return current, reference


def _threshold(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    _ = previous
    current = _as_float(tick.get(node.field or ""))
    threshold = _as_float(node.value) or 0.0
    op = node.operator or ""
    matched = False
    if current is not None:
        if op == "gt":
            matched = current > threshold
        elif op == "gte":
            matched = current >= threshold
        elif op == "lt":
            matched = current < threshold
        elif op == "lte":
            matched = current <= threshold
    return ConditionEvaluation(matched, f"{node.field} {op} {threshold}", {"current": current, "threshold": threshold})


def _cross(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    current = _as_float(tick.get(node.field or ""))
    prior = _as_float(previous.get(node.field or ""))
    threshold = _as_float(node.value) or 0.0
    op = node.operator or ""
    matched = False
    if current is not None:
        if op == "crosses_above":
            matched = current >= threshold if prior is None else prior < threshold <= current
        elif op == "crosses_below":
            matched = current <= threshold if prior is None else prior > threshold >= current
    return ConditionEvaluation(matched, f"{node.field} {op} {threshold}", {"current": current, "previous": prior, "threshold": threshold})


def _pct_change(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    current, reference = _values(node, tick, previous)
    threshold = _as_float(node.value) or 0.0
    pct = None
    if current is not None and reference not in (None, 0):
        pct = ((current - reference) / reference) * 100
    op = node.operator or ""
    matched = False
    if pct is not None:
        matched = pct >= threshold if op in {"pct_change_gte", "rolling_pct_change_gte"} else pct <= threshold
    return ConditionEvaluation(matched, f"{node.field} {op} {threshold}%", {"current": current, "reference": reference, "change_pct": pct})


def _field_compare(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    _ = previous
    current = _as_float(tick.get(node.field or ""))
    reference = _as_float(tick.get(str(node.compare_to or "")))
    op = node.operator or ""
    matched = False
    if current is not None and reference is not None:
        if op == "field_gt":
            matched = current > reference
        elif op == "field_gte":
            matched = current >= reference
        elif op == "field_lt":
            matched = current < reference
        elif op == "field_lte":
            matched = current <= reference
    return ConditionEvaluation(matched, f"{node.field} {op} {node.compare_to}", {"current": current, "reference": reference})


def _volume_spike(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    current = _as_float(tick.get(node.field or "volume"))
    reference = _as_float(tick.get(node.compare_to or "avg_volume")) or _as_float(previous.get(node.field or "volume"))
    multiplier = _as_float(node.value) or 2.0
    matched = bool(current is not None and reference not in (None, 0) and current >= reference * multiplier)
    return ConditionEvaluation(matched, f"{node.field or 'volume'} volume_spike {multiplier}x", {"current": current, "reference": reference, "multiplier": multiplier})


def _always(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    _ = node
    _ = tick
    _ = previous
    return ConditionEvaluation(True, "always", {})


CONDITION_REGISTRY: dict[str, ConditionDefinition] = {
    "gt": ConditionDefinition("gt", "Greater than", "Field is greater than a fixed value.", "threshold", ["number"], _threshold),
    "gte": ConditionDefinition("gte", "Greater than or equal", "Field reaches or exceeds a fixed value.", "threshold", ["number"], _threshold),
    "lt": ConditionDefinition("lt", "Less than", "Field is less than a fixed value.", "threshold", ["number"], _threshold),
    "lte": ConditionDefinition("lte", "Less than or equal", "Field reaches or falls below a fixed value.", "threshold", ["number"], _threshold),
    "crosses_above": ConditionDefinition("crosses_above", "Crosses above", "Field crosses above a threshold using the prior tick.", "price", ["number"], _cross),
    "crosses_below": ConditionDefinition("crosses_below", "Crosses below", "Field crosses below a threshold using the prior tick.", "price", ["number"], _cross),
    "pct_change_gte": ConditionDefinition("pct_change_gte", "Percent change up", "Percent change versus a reference field reaches a threshold.", "momentum", ["number"], _pct_change),
    "pct_change_lte": ConditionDefinition("pct_change_lte", "Percent change down", "Percent change versus a reference field falls below a threshold.", "momentum", ["number"], _pct_change),
    "rolling_pct_change_gte": ConditionDefinition("rolling_pct_change_gte", "Rolling percent move up", "Percent change over a rolling state window reaches a threshold.", "rolling", ["number"], _pct_change),
    "rolling_pct_change_lte": ConditionDefinition("rolling_pct_change_lte", "Rolling percent move down", "Percent change over a rolling state window falls below a threshold.", "rolling", ["number"], _pct_change),
    "field_gt": ConditionDefinition("field_gt", "Field greater than field", "Compare two fields in the same tick.", "comparison", ["number"], _field_compare),
    "field_gte": ConditionDefinition("field_gte", "Field greater/equal field", "Compare two fields in the same tick.", "comparison", ["number"], _field_compare),
    "field_lt": ConditionDefinition("field_lt", "Field less than field", "Compare two fields in the same tick.", "comparison", ["number"], _field_compare),
    "field_lte": ConditionDefinition("field_lte", "Field less/equal field", "Compare two fields in the same tick.", "comparison", ["number"], _field_compare),
    "volume_spike": ConditionDefinition("volume_spike", "Volume spike", "Current volume is a multiple of a reference volume.", "volume", ["number"], _volume_spike),
    "always": ConditionDefinition("always", "Always", "Always matches; useful for testing delivery.", "utility", [], _always),
}


FIELD_REGISTRY = [
    {"name": "ltp", "type": "number", "description": "Latest traded price."},
    {"name": "open", "type": "number", "description": "Current day open."},
    {"name": "high", "type": "number", "description": "Current day high."},
    {"name": "low", "type": "number", "description": "Current day low."},
    {"name": "close", "type": "number", "description": "Previous close or broker reference close."},
    {"name": "volume", "type": "number", "description": "Latest volume from quote or OHLC payload."},
    {"name": "avg_volume", "type": "number", "description": "Reference average volume when provided by enrichment."},
    {"name": "open_interest", "type": "number", "description": "Open interest for derivative contracts."},
    {"name": "day_change", "type": "number", "description": "Absolute day change."},
    {"name": "day_change_perc", "type": "number", "description": "Broker-reported day change percent."},
]


def condition_registry_payload() -> dict[str, Any]:
    return {
        "fields": FIELD_REGISTRY,
        "operators": [
            {
                "operator": item.operator,
                "label": item.label,
                "description": item.description,
                "family": item.family,
                "fields": item.fields,
            }
            for item in CONDITION_REGISTRY.values()
        ],
        "functions": [
            {"name": "all", "description": "All child expressions must match."},
            {"name": "any", "description": "At least one child expression must match."},
            {"name": "not", "description": "Invert a child expression."},
        ],
    }


def evaluate_logic(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any] | None = None) -> ConditionEvaluation:
    previous = previous or {}
    kind = node.kind
    if kind in {"all", "any"}:
        child_results = [evaluate_logic(child, tick, previous) for child in node.children]
        matched = all(item.matched for item in child_results) if kind == "all" else any(item.matched for item in child_results)
        reasons = [item.reason for item in child_results if item.matched]
        return ConditionEvaluation(matched, ", ".join(reasons) or "no conditions matched", {"children": [item.details for item in child_results]})
    if kind == "not":
        child = evaluate_logic(node.children[0], tick, previous) if node.children else ConditionEvaluation(False, "empty not", {})
        return ConditionEvaluation(not child.matched, f"not ({child.reason})", {"child": child.details})
    operator = node.operator or "always"
    definition = CONDITION_REGISTRY.get(operator)
    if definition is None:
        return ConditionEvaluation(False, f"unsupported operator {operator}", {"operator": operator})
    return definition.evaluator(node, tick, previous)

