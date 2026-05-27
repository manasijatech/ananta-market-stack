from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Callable

from app.services.alerts_engine.ast import AlertLogicNode


@dataclass(frozen=True)
class ConditionEvaluation:
    matched: bool
    reason: str
    details: dict[str, Any]


@dataclass(frozen=True)
class ConditionRuntimeContext:
    rolling_references: dict[str, dict[str, Any]]
    state_manager: Any | None = None


@dataclass(frozen=True)
class ConditionConfigField:
    name: str
    label: str
    type: str = "number"
    description: str = ""
    default: Any = None
    required: bool = False
    options: list[dict[str, Any]] | None = None
    min_value: float | None = None
    max_value: float | None = None


@dataclass(frozen=True)
class ConditionDefinition:
    operator: str
    label: str
    description: str
    family: str
    fields: list[str]
    evaluator: Callable[
        [AlertLogicNode, dict[str, Any], dict[str, Any], ConditionRuntimeContext | None],
        ConditionEvaluation,
    ]
    config_fields: list[ConditionConfigField] | None = None
    state_requirements: list[str] | None = None
    examples: list[str] | None = None


ROLLING_OPERATORS = {
    "rolling_pct_change_gte",
    "rolling_pct_change_lte",
    "rolling_abs_change_gte",
    "rolling_abs_change_lte",
    "rolling_volume_spike_gte",
}

DEFAULT_ROLLING_WINDOW_SECONDS = 300
MIN_ROLLING_WINDOW_SECONDS = 5
MAX_ROLLING_WINDOW_SECONDS = 6 * 60 * 60


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _config_value(node: AlertLogicNode, key: str, default: Any = None) -> Any:
    config = node.config or {}
    if key in config and config[key] not in (None, ""):
        return config[key]
    if key == "value":
        return node.value if node.value not in (None, "") else default
    if key == "window_seconds":
        return node.window_seconds if node.window_seconds not in (None, "") else default
    if key == "compare_to":
        return node.compare_to if node.compare_to not in (None, "") else default
    if key == "hold_seconds":
        return node.hold_seconds if node.hold_seconds not in (None, "") else default
    if key == "occurrences":
        return node.occurrences if node.occurrences not in (None, "") else default
    if key == "occurrence_window_seconds":
        return node.occurrence_window_seconds if node.occurrence_window_seconds not in (None, "") else default
    if key == "trigger_mode":
        return node.trigger_mode if node.trigger_mode not in (None, "") else default
    return default


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _node_state_identity(node: AlertLogicNode) -> str:
    payload = node.model_dump(exclude_none=True)
    payload.pop("children", None)
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha1(encoded.encode("utf-8")).hexdigest()[:16]


def rolling_window_seconds(node: AlertLogicNode) -> int:
    try:
        raw = int(_config_value(node, "window_seconds", DEFAULT_ROLLING_WINDOW_SECONDS))
    except (TypeError, ValueError):
        raw = DEFAULT_ROLLING_WINDOW_SECONDS
    return max(MIN_ROLLING_WINDOW_SECONDS, min(raw, MAX_ROLLING_WINDOW_SECONDS))


def rolling_reference_key(node: AlertLogicNode) -> str:
    baseline = str(_config_value(node, "baseline", "oldest") or "oldest")
    min_samples = _as_int(_config_value(node, "min_samples"), 3)
    coverage = _config_value(node, "min_coverage_ratio", 0.8)
    return f"{node.operator or ''}:{node.field or ''}:{rolling_window_seconds(node)}:{baseline}:{min_samples}:{coverage}"


def iter_rolling_conditions(node: AlertLogicNode):
    if node.kind == "condition" and (node.operator or "") in ROLLING_OPERATORS:
        yield node
    for child in node.children:
        yield from iter_rolling_conditions(child)


def _rolling_reference(node: AlertLogicNode, context: ConditionRuntimeContext | None) -> tuple[float | None, dict[str, Any]]:
    if context is None:
        return None, {}
    payload = context.rolling_references.get(rolling_reference_key(node)) or {}
    return _as_float(payload.get("reference")), payload


def _values(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> tuple[float | None, float | None, dict[str, Any]]:
    current = _as_float(tick.get(node.field or ""))
    rolling_payload: dict[str, Any] = {}
    if (node.operator or "") in ROLLING_OPERATORS:
        reference, rolling_payload = _rolling_reference(node, context)
        if reference is None and not rolling_payload:
            reference = _as_float(previous.get(node.field or ""))
    elif _config_value(node, "compare_to"):
        reference = _as_float(tick.get(str(_config_value(node, "compare_to"))))
    else:
        reference = _as_float(previous.get(node.field or ""))
    return current, reference, rolling_payload


def _threshold(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = previous
    _ = context
    current = _as_float(tick.get(node.field or ""))
    threshold = _as_float(_config_value(node, "value", 0.0)) or 0.0
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


def _cross(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = context
    current = _as_float(tick.get(node.field or ""))
    prior = _as_float(previous.get(node.field or ""))
    threshold = _as_float(_config_value(node, "value", 0.0)) or 0.0
    op = node.operator or ""
    matched = False
    if current is not None and prior is not None:
        if op == "crosses_above":
            matched = prior < threshold <= current
        elif op == "crosses_below":
            matched = prior > threshold >= current
    return ConditionEvaluation(matched, f"{node.field} {op} {threshold}", {"current": current, "previous": prior, "threshold": threshold})


def _pct_change(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    current, reference, rolling_payload = _values(node, tick, previous, context)
    threshold = _as_float(_config_value(node, "value", 0.0)) or 0.0
    pct = None
    if current is not None and reference not in (None, 0):
        pct = ((current - reference) / reference) * 100
    op = node.operator or ""
    matched = False
    if pct is not None:
        matched = pct >= threshold if op in {"pct_change_gte", "rolling_pct_change_gte"} else pct <= -abs(threshold)
    return ConditionEvaluation(
        matched,
        f"{node.field} {op} {threshold}%",
        {"current": current, "reference": reference, "change_pct": pct, "rolling": rolling_payload},
    )


def _abs_change(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    current, reference, rolling_payload = _values(node, tick, previous, context)
    threshold = _as_float(_config_value(node, "value", 0.0)) or 0.0
    change = None if current is None or reference is None else current - reference
    op = node.operator or ""
    matched = False
    if change is not None:
        matched = change >= threshold if op in {"abs_change_gte", "rolling_abs_change_gte"} else change <= -abs(threshold)
    return ConditionEvaluation(
        matched,
        f"{node.field} {op} {threshold}",
        {"current": current, "reference": reference, "change": change, "rolling": rolling_payload},
    )


def _field_compare(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = previous
    _ = context
    current = _as_float(tick.get(node.field or ""))
    compare_to = str(_config_value(node, "compare_to", "") or "")
    reference = _as_float(tick.get(compare_to))
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
    return ConditionEvaluation(
        matched,
        f"{node.field} {op} {compare_to}",
        {"current": current, "reference": reference, "reference_field": compare_to},
    )


def _range_breakout(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = context
    ltp = _as_float(tick.get(node.field or "ltp"))
    previous_ltp = _as_float(previous.get(node.field or "ltp"))
    op = node.operator or ""
    matched = False
    reference = None
    if op == "breaks_day_high":
        high = _as_float(tick.get(str(_config_value(node, "compare_to", "high") or "high")))
        reference = high
        matched = bool(ltp is not None and high is not None and (previous_ltp is None or previous_ltp < high) and ltp >= high)
    elif op == "breaks_day_low":
        low = _as_float(tick.get(str(_config_value(node, "compare_to", "low") or "low")))
        reference = low
        matched = bool(ltp is not None and low is not None and (previous_ltp is None or previous_ltp > low) and ltp <= low)
    return ConditionEvaluation(matched, f"{node.field or 'ltp'} {op}", {"ltp": ltp, "previous": previous_ltp, "reference": reference})


def _gap(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = previous
    _ = context
    open_price = _as_float(tick.get(node.field or "open"))
    close = _as_float(tick.get(str(_config_value(node, "compare_to", "close"))))
    threshold = _as_float(_config_value(node, "value", 0.0)) or 0.0
    pct = None
    if open_price is not None and close not in (None, 0):
        pct = ((open_price - close) / close) * 100
    op = node.operator or ""
    matched = False
    if pct is not None:
        matched = pct >= threshold if op == "gap_up_pct_gte" else pct <= -abs(threshold)
    return ConditionEvaluation(matched, f"{op} {threshold}%", {"open": open_price, "close": close, "gap_pct": pct})


def _volume_spike(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = context
    current = _as_float(tick.get(node.field or "volume"))
    reference_field = str(_config_value(node, "compare_to", "avg_volume") or "avg_volume")
    reference = _as_float(tick.get(reference_field)) or _as_float(previous.get(node.field or "volume"))
    multiplier = _as_float(_config_value(node, "value", 2.0)) or 2.0
    min_volume = _as_float(_config_value(node, "min_volume"))
    matched = bool(current is not None and reference not in (None, 0) and current >= reference * multiplier)
    if min_volume is not None:
        matched = bool(matched and current is not None and current >= min_volume)
    return ConditionEvaluation(
        matched,
        f"{node.field or 'volume'} volume_spike {multiplier}x",
        {"current": current, "reference": reference, "reference_field": reference_field, "multiplier": multiplier, "min_volume": min_volume},
    )


def _rolling_volume_spike(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = previous
    current = _as_float(tick.get(node.field or "volume"))
    reference, rolling_payload = _rolling_reference(node, context)
    multiplier = _as_float(_config_value(node, "value", 2.0)) or 2.0
    min_volume = _as_float(_config_value(node, "min_volume"))
    matched = bool(current is not None and reference not in (None, 0) and current >= reference * multiplier)
    if min_volume is not None:
        matched = bool(matched and current is not None and current >= min_volume)
    return ConditionEvaluation(
        matched,
        f"{node.field or 'volume'} rolling_volume_spike {multiplier}x",
        {
            "current": current,
            "reference": reference,
            "multiplier": multiplier,
            "min_volume": min_volume,
            "rolling": rolling_payload,
        },
    )


def _oi_change(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = context
    field = node.field or "open_interest"
    current = _as_float(tick.get(field))
    prior = _as_float(tick.get("previous_open_interest")) or _as_float(previous.get(field))
    threshold = _as_float(_config_value(node, "value", 0.0)) or 0.0
    change = None if current is None or prior is None else current - prior
    op = node.operator or ""
    matched = False
    if change is not None:
        if op == "oi_change_gte":
            matched = change >= threshold
        elif op == "oi_change_lte":
            matched = change <= -abs(threshold)
        else:
            pct = (change / prior) * 100 if prior not in (None, 0) else None
            matched = bool(pct is not None and (pct >= threshold if op == "oi_change_pct_gte" else pct <= -abs(threshold)))
            return ConditionEvaluation(matched, f"{field} {op} {threshold}%", {"current": current, "previous": prior, "change": change, "change_pct": pct})
    return ConditionEvaluation(matched, f"{field} {op} {threshold}", {"current": current, "previous": prior, "change": change})


def _spread_lte(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = previous
    _ = context
    bid = _as_float(tick.get("best_bid_price")) or _as_float(tick.get("bid_price"))
    ask = _as_float(tick.get("best_ask_price")) or _as_float(tick.get("offer_price"))
    max_spread = _as_float(_config_value(node, "value", 0.0)) or 0.0
    spread = None if bid is None or ask is None else ask - bid
    mode = str(_config_value(node, "unit", "absolute"))
    if mode == "bps" and spread is not None and bid not in (None, 0):
        spread_value = (spread / bid) * 10000
    elif mode == "percent" and spread is not None and bid not in (None, 0):
        spread_value = (spread / bid) * 100
    else:
        spread_value = spread
    matched = bool(spread_value is not None and spread_value >= 0 and spread_value <= max_spread)
    return ConditionEvaluation(matched, f"spread_lte {max_spread} {mode}", {"bid": bid, "ask": ask, "spread": spread, "spread_value": spread_value, "unit": mode})


def _book_ratio(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = previous
    _ = context
    op = node.operator or ""
    threshold = _as_float(_config_value(node, "value", 1.0)) or 1.0
    if op.startswith("total_buy_sell_ratio"):
        buy = _as_float(tick.get("total_buy_quantity"))
        sell = _as_float(tick.get("total_sell_quantity"))
    else:
        buy = _as_float(tick.get("best_bid_quantity"))
        sell = _as_float(tick.get("best_ask_quantity"))
    ratio = None if buy is None or sell in (None, 0) else buy / sell
    matched = False
    if ratio is not None:
        matched = ratio >= threshold if op.endswith("_gte") else ratio <= threshold
    return ConditionEvaluation(matched, f"{op} {threshold}", {"buy": buy, "sell": sell, "ratio": ratio})


def _apply_stateful_wrappers(
    node: AlertLogicNode,
    tick: dict[str, Any],
    result: ConditionEvaluation,
    context: ConditionRuntimeContext | None,
) -> ConditionEvaluation:
    state_manager = getattr(context, "state_manager", None) if context else None
    if state_manager is None:
        if node.hold_seconds or node.occurrences or (node.trigger_mode and node.trigger_mode != "level"):
            details = {**result.details, "state_status": "unavailable", "stateful_match": result.matched}
            return ConditionEvaluation(False, f"{result.reason}; state unavailable", details)
        return result
    state_key = _node_state_identity(node)
    return state_manager.apply(node, tick, result, state_key=state_key)


def _always(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any],
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    _ = node
    _ = tick
    _ = previous
    _ = context
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
    "rolling_volume_spike_gte": ConditionDefinition("rolling_volume_spike_gte", "Rolling volume spike", "Current volume is a multiple of its rolling baseline.", "volume", ["number"], _rolling_volume_spike),
    "oi_change_gte": ConditionDefinition("oi_change_gte", "Open interest increase", "Open interest increased by at least the configured amount.", "options", ["number"], _oi_change),
    "oi_change_lte": ConditionDefinition("oi_change_lte", "Open interest decrease", "Open interest decreased by at least the configured amount.", "options", ["number"], _oi_change),
    "oi_change_pct_gte": ConditionDefinition("oi_change_pct_gte", "Open interest percent increase", "Open interest increased by at least the configured percent.", "options", ["number"], _oi_change),
    "oi_change_pct_lte": ConditionDefinition("oi_change_pct_lte", "Open interest percent decrease", "Open interest decreased by at least the configured percent.", "options", ["number"], _oi_change),
    "spread_lte": ConditionDefinition("spread_lte", "Spread below", "Top-of-book spread is below a configured absolute, percent, or bps threshold.", "orderbook", ["number"], _spread_lte),
    "bid_ask_imbalance_gte": ConditionDefinition("bid_ask_imbalance_gte", "Bid/ask imbalance above", "Best bid quantity divided by best ask quantity is at or above the threshold.", "orderbook", ["number"], _book_ratio),
    "bid_ask_imbalance_lte": ConditionDefinition("bid_ask_imbalance_lte", "Bid/ask imbalance below", "Best bid quantity divided by best ask quantity is at or below the threshold.", "orderbook", ["number"], _book_ratio),
    "total_buy_sell_ratio_gte": ConditionDefinition("total_buy_sell_ratio_gte", "Total buy/sell ratio above", "Total buy quantity divided by total sell quantity is at or above the threshold.", "orderbook", ["number"], _book_ratio),
    "total_buy_sell_ratio_lte": ConditionDefinition("total_buy_sell_ratio_lte", "Total buy/sell ratio below", "Total buy quantity divided by total sell quantity is at or below the threshold.", "orderbook", ["number"], _book_ratio),
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


def _config_field_payload(field: ConditionConfigField) -> dict[str, Any]:
    return {
        "name": field.name,
        "label": field.label,
        "type": field.type,
        "description": field.description,
        "default": field.default,
        "required": field.required,
        "options": field.options or [],
        "min": field.min_value,
        "max": field.max_value,
    }


def _operator_config_fields(operator: str) -> list[ConditionConfigField]:
    value = ConditionConfigField("value", "Threshold", "number", "Threshold value used by the operator.", required=True)
    compare_to = ConditionConfigField("compare_to", "Reference field", "field", "Same-tick reference field.", default="")
    window = ConditionConfigField("window_seconds", "Window seconds", "number", "Rolling lookback window.", default=300, min_value=MIN_ROLLING_WINDOW_SECONDS, max_value=MAX_ROLLING_WINDOW_SECONDS)
    min_samples = ConditionConfigField("min_samples", "Minimum samples", "number", "Minimum rolling samples before this operator can match.", default=3, min_value=1)
    coverage = ConditionConfigField("min_coverage_ratio", "Minimum coverage", "number", "Fraction of the rolling window that must be covered before matching.", default=0.8, min_value=0, max_value=1)
    baseline = ConditionConfigField(
        "baseline",
        "Rolling baseline",
        "select",
        "How the rolling reference is selected from the sampled window.",
        default="oldest",
        options=[
            {"value": "oldest", "label": "Oldest sample"},
            {"value": "nearest_window_start", "label": "Nearest window start"},
            {"value": "mean", "label": "Mean"},
            {"value": "median", "label": "Median"},
            {"value": "min", "label": "Minimum"},
            {"value": "max", "label": "Maximum"},
        ],
    )
    trigger_mode = ConditionConfigField(
        "trigger_mode",
        "Trigger mode",
        "select",
        "Optional stateful edge filter applied after the operator result.",
        default="level",
        options=[
            {"value": "level", "label": "While true"},
            {"value": "rising_edge", "label": "Only when it becomes true"},
            {"value": "falling_edge", "label": "Only when it becomes false"},
            {"value": "every_match", "label": "Every raw match"},
        ],
    )
    hold = ConditionConfigField("hold_seconds", "Hold seconds", "number", "Require the condition to remain true for this long.", default=None, min_value=1)
    occurrences = ConditionConfigField("occurrences", "Occurrences", "number", "Require this many raw matches inside the occurrence window.", default=None, min_value=1)
    occurrence_window = ConditionConfigField("occurrence_window_seconds", "Occurrence window", "number", "Window used by the occurrences tracker.", default=300, min_value=1)
    if operator in ROLLING_OPERATORS:
        return [value, window, baseline, min_samples, coverage, trigger_mode, hold, occurrences, occurrence_window]
    if operator in {"pct_change_gte", "pct_change_lte", "abs_change_gte", "abs_change_lte"}:
        return [value, compare_to, trigger_mode, hold, occurrences, occurrence_window]
    if operator in {"crosses_above", "crosses_below", "gt", "gte", "lt", "lte"}:
        return [value, trigger_mode, hold, occurrences, occurrence_window]
    if operator in {"volume_spike", "relative_volume_gte"}:
        return [value, compare_to, ConditionConfigField("min_volume", "Minimum volume", "number", "Optional hard minimum volume.", default=None, min_value=0), trigger_mode, hold, occurrences, occurrence_window]
    if operator.startswith("oi_change"):
        return [value, trigger_mode, hold, occurrences, occurrence_window]
    if operator == "spread_lte":
        return [
            value,
            ConditionConfigField(
                "unit",
                "Spread unit",
                "select",
                "Measure spread as absolute price points, percent, or basis points.",
                default="absolute",
                options=[
                    {"value": "absolute", "label": "Absolute"},
                    {"value": "percent", "label": "Percent"},
                    {"value": "bps", "label": "Basis points"},
                ],
            ),
            trigger_mode,
            hold,
            occurrences,
            occurrence_window,
        ]
    if operator in {"bid_ask_imbalance_gte", "bid_ask_imbalance_lte", "total_buy_sell_ratio_gte", "total_buy_sell_ratio_lte"}:
        return [value, trigger_mode, hold, occurrences, occurrence_window]
    if operator.startswith("field_") or operator.startswith("breaks_") or operator.startswith("gap_"):
        return [value, compare_to, trigger_mode, hold, occurrences, occurrence_window]
    return [trigger_mode, hold, occurrences, occurrence_window]


def _operator_state_requirements(operator: str) -> list[str]:
    requirements: list[str] = []
    if operator in ROLLING_OPERATORS:
        requirements.append("rolling_series")
    if operator in {"crosses_above", "crosses_below", "breaks_day_high", "breaks_day_low"} or operator.startswith("oi_change"):
        requirements.append("previous_tick")
    if operator in {"spread_lte", "bid_ask_imbalance_gte", "bid_ask_imbalance_lte", "total_buy_sell_ratio_gte", "total_buy_sell_ratio_lte"}:
        requirements.append("orderbook")
    return requirements


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
                "config_fields": [_config_field_payload(field) for field in _operator_config_fields(item.operator)],
                "state_requirements": _operator_state_requirements(item.operator),
                "examples": item.examples or [],
            }
            for item in CONDITION_REGISTRY.values()
        ],
        "functions": [
            {"name": "all", "description": "All child expressions must match."},
            {"name": "any", "description": "At least one child expression must match."},
            {"name": "not", "description": "Invert a child expression."},
        ],
    }


def evaluate_logic(
    node: AlertLogicNode,
    tick: dict[str, Any],
    previous: dict[str, Any] | None = None,
    context: ConditionRuntimeContext | None = None,
) -> ConditionEvaluation:
    previous = previous or {}
    kind = node.kind
    if kind in {"all", "any"}:
        child_results = [evaluate_logic(child, tick, previous, context) for child in node.children]
        matched = all(item.matched for item in child_results) if kind == "all" else any(item.matched for item in child_results)
        reasons = [item.reason for item in child_results if item.matched]
        result = ConditionEvaluation(matched, ", ".join(reasons) or "no conditions matched", {"children": [item.details for item in child_results]})
        return _apply_stateful_wrappers(node, tick, result, context)
    if kind == "not":
        child = evaluate_logic(node.children[0], tick, previous, context) if node.children else ConditionEvaluation(False, "empty not", {})
        result = ConditionEvaluation(not child.matched, f"not ({child.reason})", {"child": child.details})
        return _apply_stateful_wrappers(node, tick, result, context)
    operator = node.operator or "always"
    definition = CONDITION_REGISTRY.get(operator)
    if definition is None:
        return ConditionEvaluation(False, f"unsupported operator {operator}", {"operator": operator})
    result = definition.evaluator(node, tick, previous, context)
    return _apply_stateful_wrappers(node, tick, result, context)
