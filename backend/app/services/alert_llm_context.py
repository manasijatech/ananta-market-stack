from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from common.datetime_compat import UTC
from market_stack_sdk import MarketStackClient
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.alert import AlertLlmAnalysisConfig, AlertWorkflowOut
from app.services import alpha_config

PLACEHOLDER_PATTERN = re.compile(r"@([A-Za-z][A-Za-z0-9_.]*)(?:\(([^)]*)\))?")
DATA_PLACEHOLDERS = {"news", "announcements", "earnings", "concalls"}

DEFAULT_PROMPT_TEMPLATE = """Analyze why this alert triggered for {symbol}.

Trigger: @trigger.reason
Workflow: @trigger.summary
Price data: @price.full
Recent news: @news(days=2, max_pages=1, max_items=5)
Recent announcements: @announcements(days=2, max_pages=1, max_items=5, detailed=true)
Recent earnings: @earnings(days=2, max_pages=1, max_items=3, detailed=true)
Recent concalls: @concalls(days=2, max_pages=1, max_items=2)

Give a concise market-relevant explanation, include likely drivers, and mention when context is insufficient."""


@dataclass(frozen=True)
class PlaceholderCall:
    raw: str
    name: str
    args: dict[str, Any]


def placeholder_catalog() -> dict[str, Any]:
    return {
        "defaults": {
            "prompt_template": DEFAULT_PROMPT_TEMPLATE,
        },
        "placeholders": [
            {
                "name": "@price.full",
                "label": "Full price data",
                "description": "Full enriched tick/quote payload for only the matched symbol.",
                "example": "@price.full",
                "params": [],
            },
            {
                "name": "@trigger.reason",
                "label": "Trigger reason",
                "description": "Matched condition reason from the workflow evaluator.",
                "example": "@trigger.reason",
                "params": [],
            },
            {
                "name": "@trigger.summary",
                "label": "Workflow summary",
                "description": "Compiled workflow explanation, target, logic, and cooldown.",
                "example": "@trigger.summary",
                "params": [],
            },
            {
                "name": "@trigger.details",
                "label": "Trigger details",
                "description": "Current tick, previous tick, condition details, and workflow identifiers.",
                "example": "@trigger.details",
                "params": [],
            },
            {
                "name": "@news",
                "label": "News",
                "description": "GET /v1/news with symbol injected automatically.",
                "example": "@news(days=2, max_pages=1, max_items=5, sentiment=null)",
                "params": ["days", "from", "to", "max_pages", "max_items", "sentiment", "limit"],
            },
            {
                "name": "@announcements",
                "label": "Announcements",
                "description": "GET /v1/announcements with symbol injected automatically.",
                "example": "@announcements(days=2, max_pages=1, max_items=5, detailed=true, categories=null)",
                "params": ["days", "from", "to", "max_pages", "max_items", "categories", "detailed", "limit"],
            },
            {
                "name": "@earnings",
                "label": "Earnings",
                "description": "GET /v1/earnings with symbol injected automatically.",
                "example": "@earnings(days=2, max_pages=1, max_items=3, detailed=true, categories=null)",
                "params": ["days", "from", "to", "max_pages", "max_items", "categories", "detailed", "limit"],
            },
            {
                "name": "@concalls",
                "label": "Conference calls",
                "description": "GET /v1/concalls with symbol injected automatically.",
                "example": "@concalls(days=2, max_pages=1, max_items=2)",
                "params": ["days", "from", "to", "max_pages", "max_items", "limit"],
            },
        ],
    }


def default_prompt_template() -> str:
    return DEFAULT_PROMPT_TEMPLATE


def _parse_value(raw: str) -> Any:
    value = raw.strip()
    if not value or value.lower() in {"null", "none"}:
        return None
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value


def _parse_args(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    args: dict[str, Any] = {}
    for part in raw.split(","):
        if not part.strip():
            continue
        if "=" not in part:
            args[part.strip()] = True
            continue
        key, value = part.split("=", 1)
        args[key.strip()] = _parse_value(value)
    return args


def parse_placeholder_calls(template: str) -> list[PlaceholderCall]:
    calls: list[PlaceholderCall] = []
    for match in PLACEHOLDER_PATTERN.finditer(template or ""):
        calls.append(PlaceholderCall(raw=match.group(0), name=match.group(1), args=_parse_args(match.group(2))))
    return calls


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str, indent=2)


def _symbol_from_tick(workflow: AlertWorkflowOut, tick: dict[str, Any]) -> str:
    symbol = str(tick.get("symbol") or workflow.symbol or "").strip().upper()
    return symbol


def _date_params(args: dict[str, Any]) -> dict[str, str]:
    params: dict[str, str] = {}
    if args.get("from"):
        params["from"] = str(args["from"])
    if args.get("to"):
        params["to"] = str(args["to"])
    if "from" not in params:
        days = int(args.get("days") or 2)
        since = datetime.now(tz=UTC) - timedelta(days=max(days, 0))
        params["from"] = since.isoformat().replace("+00:00", "Z")
    return params


def _int_arg(args: dict[str, Any], key: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(args.get(key) or default)
    except (TypeError, ValueError):
        value = default
    return min(max(value, minimum), maximum)


def _list_arg(value: Any) -> str | None:
    if value in (None, "", [], ()):
        return None
    if isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
        return ",".join(items) if items else None
    return str(value)


def _endpoint_for(name: str) -> str:
    return {
        "news": "/v1/news",
        "announcements": "/v1/announcements",
        "earnings": "/v1/earnings",
        "concalls": "/v1/concalls",
    }[name]


def _fetch_alpha_placeholder(
    *,
    api_key: str,
    symbol: str,
    name: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    max_items = _int_arg(args, "max_items", 5, 1, 50)
    max_pages = _int_arg(args, "max_pages", 1, 1, 5)
    limit_default = min(max_items, 20 if name == "news" else 50)
    limit_max = 100 if name == "news" else 200 if name == "concalls" else 500
    limit = _int_arg(args, "limit", limit_default, 1, limit_max)
    settings = get_settings()
    params: dict[str, Any] = {"symbols": symbol, "page": 1, "limit": limit, **_date_params(args)}
    if name == "news" and args.get("sentiment"):
        params["sentiment"] = args["sentiment"]
    if name in {"announcements", "earnings"}:
        categories = _list_arg(args.get("categories"))
        if categories:
            params["categories"] = categories
        if args.get("detailed") is not None:
            params["detailed"] = bool(args.get("detailed"))
    items: list[dict[str, Any]] = []
    pages_fetched = 0
    has_next = False
    with MarketStackClient(api_key=api_key, base_url=settings.alpha_api_base_url.rstrip("/"), timeout=15) as client:
        for page in range(1, max_pages + 1):
            params["page"] = page
            payload = client.get(_endpoint_for(name), params=params)
            page_items = payload.get("data") if isinstance(payload, dict) else []
            if isinstance(page_items, list):
                items.extend([item for item in page_items if isinstance(item, dict)])
            pages_fetched = page
            has_next = bool(payload.get("has_next")) if isinstance(payload, dict) else False
            if not has_next or len(items) >= max_items:
                break
    return {
        "items": items[:max_items],
        "count": min(len(items), max_items),
        "has_next": has_next,
        "pages_fetched": pages_fetched,
        "params": {key: value for key, value in params.items() if key != "api_key"},
    }


def _workflow_summary(workflow: AlertWorkflowOut) -> dict[str, Any]:
    return workflow.workflow_dsl.compiled_summary or workflow.compiled_summary or {}


def resolve_llm_context(
    db: Session,
    *,
    workflow: AlertWorkflowOut,
    tick: dict[str, Any],
    previous_tick: dict[str, Any] | None = None,
    reason: str = "",
    evaluation_details: dict[str, Any] | None = None,
    prompt_template: str | None = None,
) -> dict[str, Any]:
    config = workflow.workflow_dsl.llm_analysis
    template = prompt_template if prompt_template is not None else (config.prompt_template or DEFAULT_PROMPT_TEMPLATE)
    symbol = _symbol_from_tick(workflow, tick)
    placeholders: dict[str, Any] = {}
    context_errors: list[dict[str, Any]] = []
    api_key: str | None = None

    calls = parse_placeholder_calls(template)
    for call in calls:
        key = call.raw
        try:
            if call.name == "price.full":
                placeholders[key] = tick
            elif call.name == "trigger.reason":
                placeholders[key] = reason
            elif call.name == "trigger.summary":
                placeholders[key] = _workflow_summary(workflow)
            elif call.name == "trigger.details":
                placeholders[key] = {
                    "reason": reason,
                    "evaluation_details": evaluation_details or {},
                    "current_tick": tick,
                    "previous_tick": previous_tick or {},
                    "workflow_id": workflow.id,
                    "workflow_name": workflow.name,
                    "symbol": symbol,
                }
            elif call.name in DATA_PLACEHOLDERS:
                if api_key is None:
                    api_key = alpha_config.get_alpha_api_key(db, workflow.user_id)
                placeholders[key] = _fetch_alpha_placeholder(
                    api_key=api_key,
                    symbol=symbol,
                    name=call.name,
                    args=call.args,
                )
            else:
                placeholders[key] = {"unsupported_placeholder": call.name}
        except Exception as exc:
            error = {"placeholder": key, "message": str(exc)}
            context_errors.append(error)
            placeholders[key] = {"error": error["message"]}

    rendered_prompt = template
    for raw, value in placeholders.items():
        replacement = value if isinstance(value, str) else _json_text(value)
        rendered_prompt = rendered_prompt.replace(raw, replacement)
    rendered_prompt = rendered_prompt.replace("{symbol}", symbol)
    return {
        "symbol": symbol,
        "rendered_prompt": rendered_prompt,
        "placeholders": placeholders,
        "context_errors": context_errors,
        "metadata": {
            "placeholder_count": len(calls),
            "resolved_at": datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
        },
    }


def prompt_placeholders_from_config(config: AlertLlmAnalysisConfig) -> list[dict[str, Any]]:
    return [
        {"raw": call.raw, "name": call.name, "args": call.args}
        for call in parse_placeholder_calls(config.prompt_template or DEFAULT_PROMPT_TEMPLATE)
    ]
