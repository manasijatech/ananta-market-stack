from __future__ import annotations

from typing import Any

from app.services.alerts_engine.ast import AlertWorkflowAst, ast_to_dict, ensure_workflow_ast
from app.services.alerts_engine.conditions import CONDITION_REGISTRY
from app.services.alerts_engine.dsl import validate_dsl_text
from app.services.alerts_engine.explain import explain_ast


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

