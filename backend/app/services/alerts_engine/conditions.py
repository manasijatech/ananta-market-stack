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
        matched = pct >= threshold if op in {"pct_change_gte", "rolling_pct_change_gte"} else pct <= -abs(threshold)
    return ConditionEvaluation(matched, f"{node.field} {op} {threshold}%", {"current": current, "reference": reference, "change_pct": pct})


def _abs_change(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    current, reference = _values(node, tick, previous)
    threshold = _as_float(node.value) or 0.0
    change = None if current is None or reference is None else current - reference
    op = node.operator or ""
    matched = False
    if change is not None:
        matched = change >= threshold if op in {"abs_change_gte", "rolling_abs_change_gte"} else change <= threshold
    return ConditionEvaluation(matched, f"{node.field} {op} {threshold}", {"current": current, "reference": reference, "change": change})


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


def _range_breakout(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    _ = previous
    ltp = _as_float(tick.get(node.field or "ltp"))
    high = _as_float(tick.get(node.compare_to or "high"))
    low = _as_float(tick.get(node.compare_to or "low"))
    op = node.operator or ""
    matched = False
    reference = None
    if op == "breaks_day_high":
        reference = high
        matched = bool(ltp is not None and high is not None and ltp >= high)
    elif op == "breaks_day_low":
        reference = low
        matched = bool(ltp is not None and low is not None and ltp <= low)
    return ConditionEvaluation(matched, f"{node.field or 'ltp'} {op}", {"ltp": ltp, "reference": reference})


def _gap(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    _ = previous
    open_price = _as_float(tick.get(node.field or "open"))
    close = _as_float(tick.get(node.compare_to or "close"))
    threshold = _as_float(node.value) or 0.0
    pct = None
    if open_price is not None and close not in (None, 0):
        pct = ((open_price - close) / close) * 100
    op = node.operator or ""
    matched = False
    if pct is not None:
        matched = pct >= threshold if op == "gap_up_pct_gte" else pct <= -abs(threshold)
    return ConditionEvaluation(matched, f"{op} {threshold}%", {"open": open_price, "close": close, "gap_pct": pct})


def _volume_spike(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    current = _as_float(tick.get(node.field or "volume"))
    reference = _as_float(tick.get(node.compare_to or "avg_volume")) or _as_float(previous.get(node.field or "volume"))
    multiplier = _as_float(node.value) or 2.0
    matched = bool(current is not None and reference not in (None, 0) and current >= reference * multiplier)
    return ConditionEvaluation(matched, f"{node.field or 'volume'} volume_spike {multiplier}x", {"current": current, "reference": reference, "multiplier": multiplier})


def _oi_change(node: AlertLogicNode, tick: dict[str, Any], previous: dict[str, Any]) -> ConditionEvaluation:
    field = node.field or "open_interest"
    current = _as_float(tick.get(field))
    prior = _as_float(previous.get(field))
    threshold = _as_float(node.value) or 0.0
    change = None if current is None or prior is None else current - prior
    op = node.operator or ""
    matched = False
    if change is not None:
        matched = change >= threshold if op == "oi_change_gte" else change <= threshold
    return ConditionEvaluation(matched, f"{field} {op} {threshold}", {"current": current, "previous": prior, "change": change})


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
    "abs_change_gte": ConditionDefinition("abs_change_gte", "Absolute move up", "Absolute change versus a reference reaches a threshold.", "momentum", ["number"], _abs_change),
    "abs_change_lte": ConditionDefinition("abs_change_lte", "Absolute move down", "Absolute change versus a reference falls below a threshold.", "momentum", ["number"], _abs_change),
    "rolling_abs_change_gte": ConditionDefinition("rolling_abs_change_gte", "Rolling absolute move up", "Absolute change over a rolling state window reaches a threshold.", "rolling", ["number"], _abs_change),
    "rolling_abs_change_lte": ConditionDefinition("rolling_abs_change_lte", "Rolling absolute move down", "Absolute change over a rolling state window falls below a threshold.", "rolling", ["number"], _abs_change),
    "field_gt": ConditionDefinition("field_gt", "Field greater than field", "Compare two fields in the same tick.", "comparison", ["number"], _field_compare),
    "field_gte": ConditionDefinition("field_gte", "Field greater/equal field", "Compare two fields in the same tick.", "comparison", ["number"], _field_compare),
    "field_lt": ConditionDefinition("field_lt", "Field less than field", "Compare two fields in the same tick.", "comparison", ["number"], _field_compare),
    "field_lte": ConditionDefinition("field_lte", "Field less/equal field", "Compare two fields in the same tick.", "comparison", ["number"], _field_compare),
    "breaks_day_high": ConditionDefinition("breaks_day_high", "Breaks day high", "Latest traded price is at or above day high.", "breakout", ["number"], _range_breakout),
    "breaks_day_low": ConditionDefinition("breaks_day_low", "Breaks day low", "Latest traded price is at or below day low.", "breakout", ["number"], _range_breakout),
    "gap_up_pct_gte": ConditionDefinition("gap_up_pct_gte", "Gap up percent", "Open is above previous close by a percent threshold.", "gap", ["number"], _gap),
    "gap_down_pct_gte": ConditionDefinition("gap_down_pct_gte", "Gap down percent", "Open is below previous close by a percent threshold.", "gap", ["number"], _gap),
    "volume_spike": ConditionDefinition("volume_spike", "Volume spike", "Current volume is a multiple of a reference volume.", "volume", ["number"], _volume_spike),
    "relative_volume_gte": ConditionDefinition("relative_volume_gte", "Relative volume", "Current volume is a multiple of average/reference volume.", "volume", ["number"], _volume_spike),
    "oi_change_gte": ConditionDefinition("oi_change_gte", "Open interest increase", "Open interest increased by at least the configured amount.", "options", ["number"], _oi_change),
    "oi_change_lte": ConditionDefinition("oi_change_lte", "Open interest decrease", "Open interest decreased by at least the configured amount.", "options", ["number"], _oi_change),
    "always": ConditionDefinition("always", "Always", "Always matches; useful for testing delivery.", "utility", [], _always),
}


FIELD_REGISTRY = [
    {"name": "ltp", "type": "number", "description": "Latest traded price."},
    {"name": "last_price", "type": "number", "description": "Last traded price from the raw broker payload."},
    {"name": "open", "type": "number", "description": "Current day open."},
    {"name": "high", "type": "number", "description": "Current day high."},
    {"name": "low", "type": "number", "description": "Current day low."},
    {"name": "close", "type": "number", "description": "Previous close or broker reference close."},
    {"name": "average_price", "type": "number", "description": "Broker-reported average traded price when available."},
    {"name": "volume", "type": "number", "description": "Latest volume from quote or OHLC payload."},
    {"name": "avg_volume", "type": "number", "description": "Reference average volume when provided by enrichment."},
    {"name": "open_interest", "type": "number", "description": "Open interest for derivative contracts."},
    {"name": "previous_open_interest", "type": "number", "description": "Previous open interest when available."},
    {"name": "oi_day_change", "type": "number", "description": "Open-interest day change."},
    {"name": "oi_day_change_percentage", "type": "number", "description": "Open-interest day change percentage."},
    {"name": "day_change", "type": "number", "description": "Absolute day change."},
    {"name": "day_change_perc", "type": "number", "description": "Broker-reported day change percent."},
    {"name": "last_trade_quantity", "type": "number", "description": "Quantity from the latest trade."},
    {"name": "last_trade_time", "type": "number", "description": "Latest trade timestamp from the broker."},
    {"name": "total_buy_quantity", "type": "number", "description": "Total buy quantity in the order book."},
    {"name": "total_sell_quantity", "type": "number", "description": "Total sell quantity in the order book."},
    {"name": "best_bid_price", "type": "number", "description": "Best bid price from top-of-book depth."},
    {"name": "best_bid_quantity", "type": "number", "description": "Best bid quantity from top-of-book depth."},
    {"name": "best_bid_orders", "type": "number", "description": "Best bid order count from top-of-book depth."},
    {"name": "best_ask_price", "type": "number", "description": "Best ask price from top-of-book depth."},
    {"name": "best_ask_quantity", "type": "number", "description": "Best ask quantity from top-of-book depth."},
    {"name": "best_ask_orders", "type": "number", "description": "Best ask order count from top-of-book depth."},
    {"name": "bid_price", "type": "number", "description": "Broker-provided bid price when available."},
    {"name": "bid_quantity", "type": "number", "description": "Broker-provided bid quantity when available."},
    {"name": "offer_price", "type": "number", "description": "Broker-provided offer price when available."},
    {"name": "offer_quantity", "type": "number", "description": "Broker-provided offer quantity when available."},
    {"name": "upper_circuit_limit", "type": "number", "description": "Upper circuit price limit."},
    {"name": "lower_circuit_limit", "type": "number", "description": "Lower circuit price limit."},
    {"name": "week_52_high", "type": "number", "description": "52-week high."},
    {"name": "week_52_low", "type": "number", "description": "52-week low."},
    {"name": "high_trade_range", "type": "number", "description": "Broker high trade range when available."},
    {"name": "low_trade_range", "type": "number", "description": "Broker low trade range when available."},
    {"name": "implied_volatility", "type": "number", "description": "Implied volatility when available for derivatives."},
    {"name": "market_cap", "type": "number", "description": "Market capitalization when provided by the broker."},
    {"name": "reference_price", "type": "number", "description": "Computed reference price used for percent or absolute move conditions."},
    {"name": "change_pct", "type": "number", "description": "Computed percent change versus the selected reference."},
    {"name": "abs_change", "type": "number", "description": "Computed absolute change versus the selected reference."},
    {"name": "gap_pct", "type": "number", "description": "Computed open-versus-close gap percentage."},
    {"name": "volume_ratio", "type": "number", "description": "Computed volume divided by average/reference volume."},
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
