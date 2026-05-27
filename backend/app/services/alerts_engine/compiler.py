from __future__ import annotations

from typing import Any

from app.services.alerts_engine.ast import AlertWorkflowAst, ast_to_dict, ensure_workflow_ast
from app.services.alerts_engine.conditions import (
    CONDITION_REGISTRY,
    FIELD_REGISTRY,
    MAX_ROLLING_WINDOW_SECONDS,
    MIN_ROLLING_WINDOW_SECONDS,
    ROLLING_OPERATORS,
    rolling_window_seconds,
)
from app.services.alerts_engine.dsl import validate_dsl_text
from app.services.alerts_engine.explain import explain_ast


def _node_value(node, key: str, default=None):
    config = node.config or {}
    if key in config and config[key] not in (None, ""):
        return config[key]
    return getattr(node, key, default)


def _validate_logic(node, errors: list[str]) -> None:
    if node.kind in {"all", "any"}:
        if not node.children:
            errors.append(f"{node.kind} group must contain at least one condition")
        for child in node.children:
            _validate_logic(child, errors)
        return
    if node.kind == "not":
        if len(node.children) != 1:
            errors.append("not group must contain exactly one condition")
        for child in node.children:
            _validate_logic(child, errors)
        return
    if node.operator not in CONDITION_REGISTRY:
        errors.append(f"Unsupported operator: {node.operator}")
    if node.operator != "always" and not node.field:
        errors.append(f"Operator {node.operator} requires a field")
    field_names = {item["name"] for item in FIELD_REGISTRY}
    if node.operator != "always" and node.field and node.field not in field_names:
        errors.append(f"Unknown field: {node.field}")
    if node.compare_to and node.compare_to not in field_names:
        errors.append(f"Unknown compare_to field: {node.compare_to}")
    if node.operator in ROLLING_OPERATORS:
        window_seconds = rolling_window_seconds(node)
        raw_window = _node_value(node, "window_seconds", window_seconds)
        try:
            requested_window = int(raw_window)
        except (TypeError, ValueError):
            requested_window = window_seconds
            errors.append("window_seconds must be a number")
        if requested_window < MIN_ROLLING_WINDOW_SECONDS or requested_window > MAX_ROLLING_WINDOW_SECONDS:
            errors.append(
                f"Rolling window for {node.operator} must be between "
                f"{MIN_ROLLING_WINDOW_SECONDS} and {MAX_ROLLING_WINDOW_SECONDS} seconds"
            )
        config = node.config or {}
        baseline = str(config.get("baseline", "oldest") or "oldest")
        if baseline not in {"oldest", "nearest_window_start", "mean", "median", "min", "max"}:
            errors.append(f"Unsupported rolling baseline: {baseline}")
        min_samples = config.get("min_samples")
        if min_samples is not None:
            try:
                if int(min_samples) < 1:
                    errors.append("min_samples must be at least 1")
            except (TypeError, ValueError):
                errors.append("min_samples must be a number")
        min_coverage = config.get("min_coverage_ratio")
        if min_coverage is not None:
            try:
                coverage = float(min_coverage)
                if coverage < 0 or coverage > 1:
                    errors.append("min_coverage_ratio must be between 0 and 1")
            except (TypeError, ValueError):
                errors.append("min_coverage_ratio must be a number")
    if node.trigger_mode and node.trigger_mode not in {"level", "rising_edge", "falling_edge", "every_match"}:
        errors.append(f"Unsupported trigger_mode: {node.trigger_mode}")
    if node.hold_seconds is not None:
        try:
            if int(node.hold_seconds) < 1:
                errors.append("hold_seconds must be at least 1")
        except (TypeError, ValueError):
            errors.append("hold_seconds must be a number")
    if node.occurrences is not None:
        try:
            if int(node.occurrences) < 1:
                errors.append("occurrences must be at least 1")
        except (TypeError, ValueError):
            errors.append("occurrences must be a number")
    if node.occurrence_window_seconds is not None:
        try:
            if int(node.occurrence_window_seconds) < 1:
                errors.append("occurrence_window_seconds must be at least 1")
        except (TypeError, ValueError):
            errors.append("occurrence_window_seconds must be a number")


def compile_workflow_dsl(dsl: Any) -> dict[str, Any]:
    workflow_ast = ensure_workflow_ast(dsl)
    dsl_text = getattr(dsl, "dsl_text", None) if hasattr(dsl, "dsl_text") else (dsl or {}).get("dsl_text")
    errors: list[str] = []
    if dsl_text:
        dsl_result = validate_dsl_text(str(dsl_text), workflow_ast)
        errors.extend(dsl_result["errors"])
        if dsl_result["valid"] and dsl_result["workflow_ast"]:
            workflow_ast = AlertWorkflowAst(**dsl_result["workflow_ast"])
    _validate_logic(workflow_ast.logic, errors)
    explanation = explain_ast(workflow_ast)
    return {
        "valid": not errors,
        "errors": errors,
        "workflow_ast": ast_to_dict(workflow_ast),
        "compiled_summary": explanation,
    }
