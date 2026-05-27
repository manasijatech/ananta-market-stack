from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any


def json_dumps(value: Any) -> str:
    return json.dumps(value, default=str, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def safe_data(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "model_dump"):
        return safe_data(value.model_dump(mode="json"))
    if isinstance(value, dict):
        return {str(key): safe_data(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [safe_data(item) for item in value]
    if hasattr(value, "__dict__"):
        return {str(key): safe_data(item) for key, item in vars(value).items() if not key.startswith("_")}
    return str(value)

