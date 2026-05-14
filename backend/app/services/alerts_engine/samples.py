from __future__ import annotations

from typing import Any

from app.services.alerts_engine.ast import AlertWorkflowAst
from app.services.alerts_engine.explain import explain_ast


def sample_tick_for_ast(workflow_ast: AlertWorkflowAst) -> dict[str, Any]:
    return {
        "symbol": "SAMPLE",
        "exchange": "NSE",
        "ltp": 100.0,
        "open": 98.0,
        "high": 101.0,
        "low": 96.0,
        "close": 97.5,
        "volume": 250000,
        "avg_volume": 100000,
        "open_interest": 50000,
        "day_change": 2.5,
        "day_change_perc": 2.56,
    }


def sample_alerts_for_ast(workflow_ast: AlertWorkflowAst) -> dict[str, Any]:
    tick = sample_tick_for_ast(workflow_ast)
    explanation = explain_ast(workflow_ast)
    notification = workflow_ast.notification or {}
    title = notification.get("title_template") or "{symbol} alert"
    message = notification.get("message_template") or "{symbol} matched workflow"
    try:
        rendered_title = title.format(**tick)
    except Exception:
        rendered_title = title
    try:
        rendered_message = message.format(**tick)
    except Exception:
        rendered_message = message
    return {
        "example_tick": tick,
        "samples": [{"title": rendered_title, "message": rendered_message, "why": explanation["summary"]}],
    }

