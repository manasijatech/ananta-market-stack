import ast
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _python_files() -> list[Path]:
    roots = [
        BACKEND_ROOT / "app",
        BACKEND_ROOT / "broker",
        BACKEND_ROOT / "common",
        BACKEND_ROOT / "db",
        BACKEND_ROOT / "tests",
    ]
    files: list[Path] = []
    for root in roots:
        files.extend(path for path in root.rglob("*.py") if path.is_file())
    return files


def test_backend_never_imports_datetime_utc_directly():
    offenders: list[str] = []
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        found = False
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom):
                continue
            if node.module != "datetime":
                continue
            if any(alias.name == "UTC" for alias in node.names):
                found = True
                break
        if found:
            offenders.append(str(path.relative_to(BACKEND_ROOT)))
    assert offenders == [], (
        "Use common.datetime_compat.UTC instead of datetime.UTC for Python 3.10 "
        f"compatibility. Offenders: {offenders}"
    )


def test_backend_avoids_bare_timeouterror_in_asyncio_paths():
    offenders: list[str] = []
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        found = False
        for node in ast.walk(tree):
            if not isinstance(node, ast.ExceptHandler):
                continue
            if isinstance(node.type, ast.Name) and node.type.id == "TimeoutError":
                found = True
                break
        if found:
            offenders.append(str(path.relative_to(BACKEND_ROOT)))
    assert offenders == [], (
        "Catch asyncio.TimeoutError explicitly in backend async loops for "
        f"cross-platform consistency. Offenders: {offenders}"
    )
