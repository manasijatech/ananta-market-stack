from __future__ import annotations

import ast as py_ast
from typing import Any

from app.services.alerts_engine.ast import AlertLogicNode, AlertWorkflowAst, ast_to_dict, ensure_workflow_ast
from app.services.alerts_engine.conditions import CONDITION_REGISTRY, FIELD_REGISTRY


ALLOWED_BOOL_FUNCS = {"all", "any", "not"}
OPERATOR_MAP = {
    py_ast.Gt: "gt",
    py_ast.GtE: "gte",
    py_ast.Lt: "lt",
    py_ast.LtE: "lte",
}


class DslValidationError(ValueError):
    pass


def _field_names() -> set[str]:
    return {item["name"] for item in FIELD_REGISTRY}


def _literal(node: py_ast.AST) -> Any:
    if isinstance(node, py_ast.Constant):
        return node.value
    raise DslValidationError("Only literal numeric/string/bool values are allowed in expressions.")


def _name(node: py_ast.AST) -> str:
    if isinstance(node, py_ast.Name):
        value = node.id
    else:
        raise DslValidationError("Expected a field name.")
    if value not in _field_names():
        raise DslValidationError(f"Unknown field '{value}'.")
    return value


def _compile_compare(node: py_ast.Compare) -> AlertLogicNode:
    if len(node.ops) != 1 or len(node.comparators) != 1:
        raise DslValidationError("Chained comparisons are not supported.")
    field = _name(node.left)
    op_type = type(node.ops[0])
    operator = OPERATOR_MAP.get(op_type)
    if operator is None:
        raise DslValidationError("Only >, >=, < and <= comparisons are supported.")
    right = node.comparators[0]
    if isinstance(right, py_ast.Name):
        return AlertLogicNode(kind="condition", field=field, operator=f"field_{operator}", compare_to=_name(right))
    return AlertLogicNode(kind="condition", field=field, operator=operator, value=_literal(right))


def _compile_call(node: py_ast.Call) -> AlertLogicNode:
    if not isinstance(node.func, py_ast.Name):
        raise DslValidationError("Only named functions are allowed.")
    name = node.func.id
    if name in {"all", "any"}:
        return AlertLogicNode(kind=name, children=[_compile_expr(arg) for arg in node.args])
    if name == "not":
        if len(node.args) != 1:
            raise DslValidationError("not() requires exactly one expression.")
        return AlertLogicNode(kind="not", children=[_compile_expr(node.args[0])])
    if name not in CONDITION_REGISTRY:
        raise DslValidationError(f"Unknown function/operator '{name}'.")
    kwargs: dict[str, Any] = {}
    for kw in node.keywords:
        if not kw.arg:
            continue
        if kw.arg in {"compare_to", "field"} and isinstance(kw.value, py_ast.Name):
            kwargs[kw.arg] = _name(kw.value)
        elif kw.arg in {"baseline", "reference_mode", "trigger_mode", "unit"} and isinstance(kw.value, py_ast.Name):
            kwargs[kw.arg] = kw.value.id
        else:
            kwargs[kw.arg] = _literal(kw.value)
    if node.args:
        field = _name(node.args[0])
    else:
        field = str(kwargs.pop("field", ""))
    if field and field not in _field_names():
        raise DslValidationError(f"Unknown field '{field}'.")
    return AlertLogicNode(
        kind="condition",
        field=field or None,
        operator=name,
        value=kwargs.get("value"),
        compare_to=kwargs.get("compare_to"),
        window_seconds=int(kwargs["window_seconds"]) if kwargs.get("window_seconds") is not None else None,
        hold_seconds=int(kwargs["hold_seconds"]) if kwargs.get("hold_seconds") is not None else None,
        occurrences=int(kwargs["occurrences"]) if kwargs.get("occurrences") is not None else None,
        occurrence_window_seconds=int(kwargs["occurrence_window_seconds"]) if kwargs.get("occurrence_window_seconds") is not None else None,
        trigger_mode=str(kwargs["trigger_mode"]) if kwargs.get("trigger_mode") is not None else None,
        config={
            key: value
            for key, value in kwargs.items()
            if key
            not in {
                "value",
                "compare_to",
                "window_seconds",
                "hold_seconds",
                "occurrences",
                "occurrence_window_seconds",
                "trigger_mode",
            }
        },
    )


def _compile_expr(node: py_ast.AST) -> AlertLogicNode:
    if isinstance(node, py_ast.BoolOp):
        kind = "all" if isinstance(node.op, py_ast.And) else "any"
        return AlertLogicNode(kind=kind, children=[_compile_expr(value) for value in node.values])
    if isinstance(node, py_ast.UnaryOp) and isinstance(node.op, py_ast.Not):
        return AlertLogicNode(kind="not", children=[_compile_expr(node.operand)])
    if isinstance(node, py_ast.Compare):
        return _compile_compare(node)
    if isinstance(node, py_ast.Call):
        return _compile_call(node)
    raise DslValidationError("Unsupported expression. Use comparisons, all(), any(), not(), and registered operators.")


def compile_dsl_text(text: str, base_ast: AlertWorkflowAst | None = None) -> AlertWorkflowAst:
    try:
        parsed = py_ast.parse(text.strip(), mode="eval")
    except SyntaxError as exc:
        raise DslValidationError(str(exc)) from exc
    compiled = base_ast or AlertWorkflowAst()
    compiled.logic = _compile_expr(parsed.body)
    compiled.metadata["dsl_text"] = text
    return compiled


def validate_dsl_text(text: str, base_ast: AlertWorkflowAst | None = None) -> dict[str, Any]:
    try:
        ast = compile_dsl_text(text, base_ast)
    except DslValidationError as exc:
        return {"valid": False, "errors": [str(exc)], "workflow_ast": None}
    return {"valid": True, "errors": [], "workflow_ast": ast_to_dict(ast)}


def _dsl_token(value: Any, *, field_name: bool = False) -> str:
    if isinstance(value, str) and value.isidentifier():
        if field_name and value not in _field_names():
            return repr(value)
        return value
    return repr(value)


def ast_to_dsl(logic: AlertLogicNode) -> str:
    if logic.kind in {"all", "any"}:
        return f"{logic.kind}({', '.join(ast_to_dsl(child) for child in logic.children)})"
    if logic.kind == "not":
        return f"not({ast_to_dsl(logic.children[0])})" if logic.children else "not(always())"
    if logic.operator and logic.operator.startswith("field_"):
        symbol = {"field_gt": ">", "field_gte": ">=", "field_lt": "<", "field_lte": "<="}.get(logic.operator, ">")
        return f"{logic.field} {symbol} {logic.compare_to}"
    if logic.operator in {"gt", "gte", "lt", "lte"}:
        symbol = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[logic.operator]
        return f"{logic.field} {symbol} {repr(logic.value)}"
    args = [_dsl_token(logic.field, field_name=True)] if logic.field else []
    if logic.value is not None:
        args.append(f"value={repr(logic.value)}")
    if logic.compare_to:
        args.append(f"compare_to={_dsl_token(logic.compare_to, field_name=True)}")
    if logic.window_seconds:
        args.append(f"window_seconds={logic.window_seconds}")
    if logic.hold_seconds:
        args.append(f"hold_seconds={logic.hold_seconds}")
    if logic.occurrences:
        args.append(f"occurrences={logic.occurrences}")
    if logic.occurrence_window_seconds:
        args.append(f"occurrence_window_seconds={logic.occurrence_window_seconds}")
    if logic.trigger_mode and logic.trigger_mode != "level":
        args.append(f"trigger_mode={_dsl_token(logic.trigger_mode)}")
    for key, value in sorted((logic.config or {}).items()):
        if key not in {"value", "compare_to", "window_seconds", "hold_seconds", "occurrences", "occurrence_window_seconds", "trigger_mode"}:
            args.append(f"{key}={_dsl_token(value)}")
    return f"{logic.operator or 'always'}({', '.join(args)})"


def dsl_for_workflow(dsl: Any) -> str:
    return ast_to_dsl(ensure_workflow_ast(dsl).logic)
