"""Named desks, display preferences, templates, skills, and suggestions."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.adaptive_workspace import workspace_spec_dump
from app.services.adaptive_workspace import json_dumps, json_loads, parse_spec_or_error
from common.datetime_compat import UTC
from db.models import AdaptiveWorkspacePreference, AdaptiveWorkspaceSavedDesk

ALLOWED_PREFERENCE_KEYS = frozenset(
    {
        "density",
        "default_watchlist_id",
        "intel_product",
        "default_account_id",
        "default_workflow_id",
        "canvas_locked",
        "inject_holdings",
    }
)
INTERNAL_INTENT_COUNTS_KEY = "request_intent_counts"
SUGGESTION_THRESHOLD = 3

_PREF_VALUE_LIMITS = {
    "density": frozenset({"comfortable", "compact"}),
    "intel_product": frozenset({"news", "announcements", "earnings", "concalls", "alerts"}),
    "canvas_locked": frozenset({"locked", "unlocked"}),
    "inject_holdings": frozenset({True, False}),
}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _component(
    component_id: str,
    component_type: str,
    *,
    x: int,
    y: int,
    w: int,
    h: int,
    tool: str | None = None,
    params: dict[str, Any] | None = None,
    props: dict[str, Any] | None = None,
    actions: list[str] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": component_id,
        "type": component_type,
        "position": {"x": x, "y": y, "w": w, "h": h},
        "actions": actions or ["select", "refresh", "remove", "duplicate"],
    }
    if tool:
        item["data"] = {"tool": tool, "params": params or {}}
    if props:
        item["props"] = props
    return item


def _spec(title: str, components: list[dict[str, Any]]) -> dict[str, Any]:
    parsed, validation = parse_spec_or_error(
        {
            "version": "1",
            "title": title,
            "layout": {"mode": "grid", "columns": 12},
            "components": components,
        }
    )
    if parsed is None:
        raise RuntimeError(json_dumps(validation))
    return workspace_spec_dump(parsed)


DESK_TEMPLATES: dict[str, dict[str, Any]] = {
    "investor": {
        "id": "investor",
        "label": "Investor",
        "description": "Holdings and broker health for a portfolio review.",
        "spec": _spec(
            "Investor desk",
            [
                _component(
                    "holdings",
                    "holdings-table",
                    x=0,
                    y=0,
                    w=8,
                    h=5,
                    tool="broker_get_portfolio",
                    params={"sections": ["holdings", "funds"]},
                ),
                _component("broker-health", "broker-health", x=8, y=0, w=4, h=3, tool="broker_get_session_status"),
            ],
        ),
    },
    "trader": {
        "id": "trader",
        "label": "Trader",
        "description": "Live quotes, a chart, and the latest watchlist.",
        "spec": _spec(
            "Trader desk",
            [
                _component("quotes", "quote-ticker", x=0, y=0, w=6, h=4, tool="broker_get_quotes"),
                _component("watchlist", "watchlist", x=6, y=0, w=6, h=4, tool="broker_list_watchlists"),
                _component("chart", "price-chart", x=0, y=4, w=12, h=4, tool="broker_get_historical"),
            ],
        ),
    },
    "researcher": {
        "id": "researcher",
        "label": "Researcher",
        "description": "Watchlist, news, and a chart for symbol research.",
        "spec": _spec(
            "Researcher desk",
            [
                _component("watchlist", "watchlist", x=0, y=0, w=4, h=5, tool="broker_list_watchlists"),
                _component(
                    "news",
                    "intel-feed",
                    x=4,
                    y=0,
                    w=8,
                    h=5,
                    tool="intel_get_feed",
                    params={"product": "news"},
                    props={"product": "news"},
                ),
                _component("chart", "price-chart", x=0, y=5, w=12, h=4, tool="broker_get_historical"),
            ],
        ),
    },
    "operations": {
        "id": "operations",
        "label": "Operations",
        "description": "Broker session health and alert inbox.",
        "spec": _spec(
            "Operations desk",
            [
                _component("broker-health", "broker-health", x=0, y=0, w=4, h=4, tool="broker_get_session_status"),
                _component("alerts", "alert-rule-draft", x=4, y=0, w=8, h=4, tool="intel_list_alert_notifications"),
            ],
        ),
    },
}

DESK_SKILLS: dict[str, dict[str, Any]] = {
    "morning-brief": {
        "id": "morning-brief",
        "label": "Morning brief",
        "description": "Holdings, health, news, and live quotes for the open.",
        "spec": _spec(
            "Morning brief",
            [
                _component(
                    "holdings",
                    "holdings-table",
                    x=0,
                    y=0,
                    w=8,
                    h=4,
                    tool="broker_get_portfolio",
                    params={"sections": ["holdings", "funds"]},
                ),
                _component("broker-health", "broker-health", x=8, y=0, w=4, h=4, tool="broker_get_session_status"),
                _component("quotes", "quote-ticker", x=0, y=4, w=6, h=4, tool="broker_get_quotes"),
                _component(
                    "news",
                    "intel-feed",
                    x=6,
                    y=4,
                    w=6,
                    h=4,
                    tool="intel_get_feed",
                    params={"product": "news"},
                    props={"product": "news"},
                ),
            ],
        ),
    },
    "fno-desk": {
        "id": "fno-desk",
        "label": "F&O desk",
        "description": "Quotes, watchlist, chart, and alerts for a derivatives session.",
        "spec": _spec(
            "F&O desk",
            [
                _component("quotes", "quote-ticker", x=0, y=0, w=6, h=4, tool="broker_get_quotes"),
                _component("watchlist", "watchlist", x=6, y=0, w=6, h=4, tool="broker_list_watchlists"),
                _component("chart", "price-chart", x=0, y=4, w=8, h=4, tool="broker_get_historical"),
                _component("alerts", "alert-rule-draft", x=8, y=4, w=4, h=4, tool="intel_list_alert_workflows"),
            ],
        ),
    },
    "earnings-week": {
        "id": "earnings-week",
        "label": "Earnings week",
        "description": "Earnings feed, watchlist, quotes, and alerts.",
        "spec": _spec(
            "Earnings week",
            [
                _component(
                    "earnings",
                    "intel-feed",
                    x=0,
                    y=0,
                    w=8,
                    h=5,
                    tool="intel_get_feed",
                    params={"product": "earnings"},
                    props={"product": "earnings"},
                ),
                _component("watchlist", "watchlist", x=8, y=0, w=4, h=5, tool="broker_list_watchlists"),
                _component("quotes", "quote-ticker", x=0, y=5, w=6, h=4, tool="broker_get_quotes"),
                _component("alerts", "alert-rule-draft", x=6, y=5, w=6, h=4, tool="intel_list_alert_notifications"),
            ],
        ),
    },
    "alert-studio": {
        "id": "alert-studio",
        "label": "Alert studio",
        "description": "Draft, graph, simulation, and confirm-to-deploy for an alert workflow.",
        "spec": _spec(
            "Alert studio",
            [
                _component("draft", "alert-rule-draft", x=0, y=0, w=6, h=5, tool="alert_get_studio"),
                _component("graph", "workflow-graph", x=6, y=0, w=6, h=5, tool="alert_get_studio"),
                _component("simulation", "workflow-simulation", x=0, y=5, w=6, h=4, tool="alert_get_studio"),
                _component(
                    "approval",
                    "approval-card",
                    x=6,
                    y=5,
                    w=6,
                    h=4,
                    tool="alert_get_studio",
                    actions=["select", "refresh", "remove", "duplicate", "deploy-alert"],
                ),
            ],
        ),
    },
    "research-sandbox": {
        "id": "research-sandbox",
        "label": "Research sandbox",
        "description": "Sandboxed payoff toy and notes.",
        "spec": _spec(
            "Research sandbox",
            [
                _component(
                    "payoff",
                    "micro-app",
                    x=0,
                    y=0,
                    w=7,
                    h=5,
                    tool="workspace_get_micro_app",
                    params={"app_id": "payoff-diagram"},
                    props={
                        "appId": "payoff-diagram",
                        "kind": "straddle",
                        "spot": 25000,
                        "strike": 25000,
                        "premium": 180,
                        "width_pct": 8,
                    },
                ),
                _component(
                    "notes",
                    "notes-block",
                    x=7,
                    y=0,
                    w=5,
                    h=5,
                    props={"text": "Sandboxed payoff toy. Numbers only; no orders or credentials."},
                ),
            ],
        ),
    },
}

_SUGGESTION_RECIPES: tuple[tuple[frozenset[str], str, str, str], ...] = (
    (
        frozenset({"holdings", "health"}),
        "template",
        "investor",
        "You keep asking for holdings and broker health. Apply the Investor template?",
    ),
    (
        frozenset({"quotes", "watchlist", "chart"}),
        "template",
        "trader",
        "You keep asking for quotes, a watchlist, and a chart. Apply the Trader template?",
    ),
    (
        frozenset({"watchlist", "news"}),
        "template",
        "researcher",
        "You keep asking for watchlist news. Apply the Researcher template?",
    ),
    (
        frozenset({"health", "alerts"}),
        "template",
        "operations",
        "You keep asking for broker health and alerts. Apply the Operations template?",
    ),
    (
        frozenset({"holdings", "news", "quotes"}),
        "skill",
        "morning-brief",
        "You keep asking for a morning overview. Apply the Morning brief skill?",
    ),
    (
        frozenset({"quotes", "watchlist", "alerts"}),
        "skill",
        "fno-desk",
        "You keep asking for quotes, a watchlist, and alerts. Apply the F&O desk skill?",
    ),
    (
        frozenset({"earnings"}),
        "skill",
        "earnings-week",
        "You keep asking about earnings. Apply the Earnings week skill?",
    ),
    (
        frozenset({"alert_studio"}),
        "skill",
        "alert-studio",
        "You keep opening the alert workflow studio. Apply the Alert studio skill?",
    ),
    (
        frozenset({"sandbox"}),
        "skill",
        "research-sandbox",
        "You keep opening a sandboxed research toy. Apply the Research sandbox skill?",
    ),
)


def list_templates() -> list[dict[str, Any]]:
    return [dict(item) for item in DESK_TEMPLATES.values()]


def list_skills() -> list[dict[str, Any]]:
    return [dict(item) for item in DESK_SKILLS.values()]


def get_template(template_id: str) -> dict[str, Any]:
    item = DESK_TEMPLATES.get(template_id)
    if item is None:
        raise ValueError("template not found")
    return dict(item)


def get_skill(skill_id: str) -> dict[str, Any]:
    item = DESK_SKILLS.get(skill_id)
    if item is None:
        raise ValueError("skill not found")
    return dict(item)


def catalog_summaries() -> dict[str, Any]:
    return {
        "templates": [
            {"id": item["id"], "label": item["label"], "description": item["description"]}
            for item in DESK_TEMPLATES.values()
        ],
        "skills": [
            {"id": item["id"], "label": item["label"], "description": item["description"]}
            for item in DESK_SKILLS.values()
        ],
        "apply_rule": "User must confirm. Do not rearrange the desk unless the user asked to apply a template or skill.",
    }


def _desk_to_out(row: AdaptiveWorkspaceSavedDesk) -> dict[str, Any]:
    spec, validation = parse_spec_or_error(json_loads(row.workspace_payload_json, {}))
    return {
        "id": row.id,
        "user_id": row.user_id,
        "name": row.name,
        "workspace_payload": workspace_spec_dump(spec) if spec is not None else json_loads(row.workspace_payload_json, {}),
        "valid": spec is not None,
        "validation": validation,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def list_saved_desks(db: Session, user_id: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(AdaptiveWorkspaceSavedDesk)
        .where(AdaptiveWorkspaceSavedDesk.user_id == user_id)
        .order_by(AdaptiveWorkspaceSavedDesk.updated_at.desc())
    ).all()
    return [_desk_to_out(row) for row in rows]


def get_saved_desk(db: Session, user_id: str, desk_id: str) -> dict[str, Any]:
    row = db.get(AdaptiveWorkspaceSavedDesk, desk_id)
    if row is None or row.user_id != user_id:
        raise ValueError("saved desk not found")
    return _desk_to_out(row)


def save_desk(db: Session, user_id: str, name: str, payload: Any, *, desk_id: str | None = None) -> dict[str, Any]:
    cleaned = (name or "").strip()[:120]
    if not cleaned:
        raise ValueError("desk name is required")
    spec, validation = parse_spec_or_error(payload)
    if spec is None:
        raise ValueError(json_dumps(validation))
    dumped = json_dumps(workspace_spec_dump(spec))
    now = _now()
    row: AdaptiveWorkspaceSavedDesk | None = None
    if desk_id:
        row = db.get(AdaptiveWorkspaceSavedDesk, desk_id)
        if row is None or row.user_id != user_id:
            raise ValueError("saved desk not found")
    else:
        existing = db.scalar(
            select(AdaptiveWorkspaceSavedDesk).where(
                AdaptiveWorkspaceSavedDesk.user_id == user_id,
                AdaptiveWorkspaceSavedDesk.name == cleaned,
            )
        )
        row = existing
    if row is None:
        row = AdaptiveWorkspaceSavedDesk(
            id=str(uuid.uuid4()),
            user_id=user_id,
            name=cleaned,
            workspace_payload_json=dumped,
            created_at=now,
            updated_at=now,
        )
    else:
        clash = db.scalar(
            select(AdaptiveWorkspaceSavedDesk).where(
                AdaptiveWorkspaceSavedDesk.user_id == user_id,
                AdaptiveWorkspaceSavedDesk.name == cleaned,
                AdaptiveWorkspaceSavedDesk.id != row.id,
            )
        )
        if clash is not None:
            raise ValueError("a saved desk with that name already exists")
        row.name = cleaned
        row.workspace_payload_json = dumped
        row.updated_at = now
    db.add(row)
    db.commit()
    db.refresh(row)
    return _desk_to_out(row)


def rename_saved_desk(db: Session, user_id: str, desk_id: str, name: str) -> dict[str, Any]:
    cleaned = (name or "").strip()[:120]
    if not cleaned:
        raise ValueError("desk name is required")
    row = db.get(AdaptiveWorkspaceSavedDesk, desk_id)
    if row is None or row.user_id != user_id:
        raise ValueError("saved desk not found")
    clash = db.scalar(
        select(AdaptiveWorkspaceSavedDesk).where(
            AdaptiveWorkspaceSavedDesk.user_id == user_id,
            AdaptiveWorkspaceSavedDesk.name == cleaned,
            AdaptiveWorkspaceSavedDesk.id != desk_id,
        )
    )
    if clash is not None:
        raise ValueError("a saved desk with that name already exists")
    row.name = cleaned
    row.updated_at = _now()
    db.add(row)
    db.commit()
    db.refresh(row)
    return _desk_to_out(row)


def delete_saved_desk(db: Session, user_id: str, desk_id: str) -> None:
    row = db.get(AdaptiveWorkspaceSavedDesk, desk_id)
    if row is None or row.user_id != user_id:
        raise ValueError("saved desk not found")
    db.delete(row)
    db.commit()


def _pref_out(row: AdaptiveWorkspacePreference) -> dict[str, Any]:
    return {
        "key": row.pref_key,
        "value": json_loads(row.value_json, None),
        "updated_at": row.updated_at,
        "deletable": True,
    }


def list_preferences(db: Session, user_id: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(AdaptiveWorkspacePreference)
        .where(AdaptiveWorkspacePreference.user_id == user_id)
        .order_by(AdaptiveWorkspacePreference.pref_key.asc())
    ).all()
    return [_pref_out(row) for row in rows if row.pref_key != INTERNAL_INTENT_COUNTS_KEY]


def upsert_preference(db: Session, user_id: str, key: str, value: Any) -> dict[str, Any]:
    pref_key = (key or "").strip()
    if pref_key == INTERNAL_INTENT_COUNTS_KEY:
        raise ValueError("request history is recorded automatically; delete it to reset suggestions")
    if pref_key not in ALLOWED_PREFERENCE_KEYS:
        raise ValueError(f"preference {pref_key!r} is not allowlisted")
    allowed = _PREF_VALUE_LIMITS.get(pref_key)
    if allowed is not None and value not in allowed and value is not None:
        raise ValueError(f"preference {pref_key} must be one of {sorted(allowed)}")
    if pref_key in {"default_watchlist_id", "default_account_id", "default_workflow_id"} and value is not None:
        text = str(value).strip()
        if not text:
            value = None
        elif len(text) > 64:
            raise ValueError(f"preference {pref_key} is too long")
        else:
            value = text
    row = db.scalar(
        select(AdaptiveWorkspacePreference).where(
            AdaptiveWorkspacePreference.user_id == user_id,
            AdaptiveWorkspacePreference.pref_key == pref_key,
        )
    )
    now = _now()
    if row is None:
        row = AdaptiveWorkspacePreference(
            id=str(uuid.uuid4()),
            user_id=user_id,
            pref_key=pref_key,
            value_json=json.dumps(value, default=str),
            updated_at=now,
        )
    else:
        row.value_json = json.dumps(value, default=str)
        row.updated_at = now
    db.add(row)
    db.commit()
    db.refresh(row)
    return _pref_out(row)


def delete_preference(db: Session, user_id: str, key: str) -> None:
    pref_key = (key or "").strip()
    row = db.scalar(
        select(AdaptiveWorkspacePreference).where(
            AdaptiveWorkspacePreference.user_id == user_id,
            AdaptiveWorkspacePreference.pref_key == pref_key,
        )
    )
    if row is None:
        raise ValueError("preference not found")
    db.delete(row)
    db.commit()


def _intent_counts(db: Session, user_id: str) -> dict[str, int]:
    row = db.scalar(
        select(AdaptiveWorkspacePreference).where(
            AdaptiveWorkspacePreference.user_id == user_id,
            AdaptiveWorkspacePreference.pref_key == INTERNAL_INTENT_COUNTS_KEY,
        )
    )
    raw = json_loads(row.value_json, {}) if row is not None else {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, int] = {}
    for key, value in raw.items():
        if isinstance(value, int) and value > 0:
            out[str(key)] = value
    return out


def _catalog_label(kind: str, target_id: str) -> str:
    catalog = DESK_SKILLS if kind == "skill" else DESK_TEMPLATES
    item = catalog.get(target_id) or {}
    return str(item.get("label") or target_id)


def suggestions_from_counts(counts: dict[str, int]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    matched: list[tuple[int, tuple[frozenset[str], str, str, str]]] = []
    for recipe in _SUGGESTION_RECIPES:
        required, kind, target_id, _message = recipe
        if all(counts.get(intent, 0) >= SUGGESTION_THRESHOLD for intent in required):
            matched.append((len(required), recipe))
    matched.sort(key=lambda item: (-item[0], item[1][2]))
    for _specificity, (required, kind, target_id, message) in matched:
        key = f"{kind}:{target_id}"
        if key in seen:
            continue
        seen.add(key)
        items.append(
            {
                "id": key,
                "kind": kind,
                "target_id": target_id,
                "label": _catalog_label(kind, target_id),
                "message": message,
                "auto_apply": False,
            }
        )
    return items


def list_suggestions(db: Session, user_id: str) -> list[dict[str, Any]]:
    return suggestions_from_counts(_intent_counts(db, user_id))


def record_request_intents(db: Session, user_id: str, intents: list[str]) -> list[dict[str, Any]]:
    counts = _intent_counts(db, user_id)
    for intent in intents:
        if not intent:
            continue
        counts[intent] = int(counts.get(intent, 0)) + 1
    row = db.scalar(
        select(AdaptiveWorkspacePreference).where(
            AdaptiveWorkspacePreference.user_id == user_id,
            AdaptiveWorkspacePreference.pref_key == INTERNAL_INTENT_COUNTS_KEY,
        )
    )
    now = _now()
    payload = json.dumps(counts)
    if row is None:
        row = AdaptiveWorkspacePreference(
            id=str(uuid.uuid4()),
            user_id=user_id,
            pref_key=INTERNAL_INTENT_COUNTS_KEY,
            value_json=payload,
            updated_at=now,
        )
    else:
        row.value_json = payload
        row.updated_at = now
    db.add(row)
    db.commit()
    return suggestions_from_counts(counts)
