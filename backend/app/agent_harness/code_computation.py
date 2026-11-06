"""Conservative syntactic evidence of computation, paired with numeric stdout."""
import ast
import json


def contains_computation(arguments):
    try:
        if isinstance(arguments, str):
            arguments = json.loads(arguments)
        tree = ast.parse(arguments.get('code', ''))
    except (ValueError, TypeError, AttributeError, SyntaxError, RecursionError):
        return False
    data = (ast.Name, ast.Attribute, ast.Subscript, ast.Call)
    for node in ast.walk(tree):
        if isinstance(node, (ast.BinOp, ast.AugAssign, ast.Compare)):
            if any(isinstance(child, data) for child in ast.walk(node)):
                return True
        if isinstance(node, ast.Call):
            function = node.func
            # api.earnings_rows() computes unit conversions (value_cr) for the script.
            if isinstance(function, ast.Attribute) and function.attr == 'earnings_rows':
                return True
            aggregate = (isinstance(function, ast.Name) and function.id in {'sum','round','min','max','sorted','len'}
                         or isinstance(function, ast.Attribute) and isinstance(function.value, ast.Name)
                         and function.value.id == 'statistics')
            if aggregate and any(isinstance(child, data) for arg in node.args for child in ast.walk(arg)):
                return True
    return False
