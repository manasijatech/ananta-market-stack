from __future__ import annotations

from typing import Any

from app.services.alerts_engine.ast import AlertLogicNode, AlertWorkflowAst


def _logic_sentence(node: AlertLogicNode) -> str:
    if node.kind == "all":
        return "all of these conditions match: " + "; ".join(_logic_sentence(child) for child in node.children)
    if node.kind == "any":
        return "any of these conditions match: " + "; ".join(_logic_sentence(child) for child in node.children)
    if node.kind == "not":
        return "not " + (_logic_sentence(node.children[0]) if node.children else "an empty condition")
    parts = [str(node.field or "value"), str(node.operator or "matches")]
    if node.value is not None:
        parts.append(str(node.value))
    if node.compare_to:
        parts.append(f"against {node.compare_to}")
    if node.window_seconds:
        parts.append(f"over {node.window_seconds} seconds")
    return " ".join(parts)


def explain_ast(workflow_ast: AlertWorkflowAst) -> dict[str, Any]:
    universe = workflow_ast.target_universe
    if universe.kind == "watchlist":
        target = f"symbols in watchlist {universe.label or universe.watchlist_id}"
    elif universe.kind == "curated_preset":
        target = f"symbols in preset {universe.label or universe.preset_id}"
    elif universe.kind == "metadata_filter":
        target = "symbols matching metadata filters"
    elif universe.kind == "set_expression":
        target = f"symbols from a {universe.op or 'set'} expression"
    else:
        target = f"{len(universe.symbols)} static symbol(s)"
    market_cap_filter = workflow_ast.market_cap_filter
    market_cap_summary = "all market caps"
    if market_cap_filter.mode == "custom" and (
        market_cap_filter.min_value is not None or market_cap_filter.max_value is not None
    ):
        lower = f">= {market_cap_filter.min_value:g}" if market_cap_filter.min_value is not None else "no lower bound"
        upper = f"<= {market_cap_filter.max_value:g}" if market_cap_filter.max_value is not None else "no upper bound"
        market_cap_summary = f"market cap {lower}, {upper}"
    return {
        "summary": f"Evaluate {target} with {market_cap_summary}; trigger when {_logic_sentence(workflow_ast.logic)}.",
        "target": target,
        "logic": _logic_sentence(workflow_ast.logic),
        "cooldown_seconds": workflow_ast.cooldown_seconds,
        "market_cap_filter": workflow_ast.market_cap_filter.model_dump(exclude_none=True),
    }
