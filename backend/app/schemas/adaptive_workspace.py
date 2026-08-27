"""Declarative Adaptive Workspace specification.

The agent may emit this document. The frontend maps component types to the
Ananta registry. Arbitrary React, HTML, CSS, or script is rejected.
"""

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.adaptive_canvas_kit import normalize_kind, prepare_canvas_html

WORKSPACE_SPEC_VERSION = "1"
GRID_COLUMNS = 12

WorkspaceComponentType = Literal[
    "portfolio-summary",
    "holdings-table",
    "holdings-vs-index",
    "pnl-exposure-strip",
    "price-chart",
    "quote-ticker",
    "quote-chart",
    "watchlist",
    "market-heatmap",
    "option-chain",
    "greeks-panel",
    "margin-scenario",
    "broker-health",
    "intel-feed",
    "alert-rule-draft",
    "workflow-graph",
    "workflow-simulation",
    "agent-timeline",
    "approval-card",
    "notes-block",
    "micro-app",
    "html-artifact",
]

ALLOWED_COMPONENT_TYPES: frozenset[str] = frozenset(WorkspaceComponentType.__args__)

MICRO_APP_IDS: frozenset[str] = frozenset({"payoff-diagram"})
MICRO_APP_KINDS: frozenset[str] = frozenset({"call", "put", "straddle"})
NOTES_BLOCK_TEXT_MAX = 16000
HTML_ARTIFACT_DOCUMENT_MAX = 60000
HTML_ARTIFACT_TITLE_MAX = 120

_HTML_ARTIFACT_IFRAME_RE = re.compile(r"<iframe\b[^>]*>.*?</iframe>|<iframe\b[^>]*/?>", re.I | re.S)
_HTML_ARTIFACT_JS_URL_RE = re.compile(r"javascript\s*:", re.I)
_HTML_ARTIFACT_META_HTTP_EQUIV_RE = re.compile(r"<meta\b[^>]*\bhttp-equiv\b[^>]*/?>", re.I | re.S)
_HTML_ARTIFACT_REMOTE_SCRIPT_RE = re.compile(
    r"<script\b[^>]*\bsrc\s*=\s*['\"]?\s*https?://",
    re.I | re.S,
)
_HTML_ARTIFACT_REMOTE_LINK_RE = re.compile(
    r"<link\b[^>]*\bhref\s*=\s*['\"]?\s*https?://",
    re.I | re.S,
)
_HTML_ARTIFACT_REMOTE_IMG_RE = re.compile(
    r"<img\b[^>]*\bsrc\s*=\s*['\"]?\s*https?://",
    re.I | re.S,
)
INTEL_FEED_PRODUCTS: frozenset[str] = frozenset({"news", "announcements", "earnings", "concalls", "alerts"})
A2UI_VERSION = "v0.9"
A2UI_CATALOG_ID = "ananta-workspace-v1"

ALLOWED_DATA_TOOLS: frozenset[str] = frozenset(
    {
        "broker_get_quotes",
        "broker_get_cached_quotes",
        "broker_get_ohlc",
        "broker_get_historical",
        "broker_get_portfolio",
        "broker_get_session_status",
        "broker_verify_connection",
        "broker_get_option_chain",
        "broker_get_greeks",
        "broker_calculate_margin",
        "broker_list_watchlists",
        "broker_get_watchlist_symbols",
        "broker_get_data_capabilities",
        "broker_list_accounts",
        "intel_get_feed",
        "intel_list_alert_workflows",
        "intel_list_alert_notifications",
        "alert_get_studio",
        "workspace_get_micro_app",
        "workspace_publish_html_artifact",
    }
)

ALLOWED_ACTIONS: frozenset[str] = frozenset(
    {
        "pin",
        "unpin",
        "refresh",
        "create-alert",
        "open-broker",
        "select",
        "remove",
        "duplicate",
        "deploy-alert",
    }
)

FORBIDDEN_PROP_KEYS: frozenset[str] = frozenset(
    {
        "class",
        "classname",
        "className",
        "style",
        "css",
        "dangerouslysetinnerhtml",
        "innerhtml",
        "jsx",
        "children",
        "href",
        "src",
        "onclick",
        "onClick",
    }
)

TOOL_COMPONENT_MAP: dict[str, str] = {
    "broker_get_quotes": "quote-ticker",
    "broker_get_cached_quotes": "quote-ticker",
    "broker_get_historical": "price-chart",
    "broker_get_ohlc": "quote-ticker",
    "broker_get_portfolio": "holdings-table",
    "broker_get_session_status": "broker-health",
    "broker_verify_connection": "broker-health",
    "broker_get_option_chain": "option-chain",
    "broker_get_greeks": "greeks-panel",
    "broker_calculate_margin": "margin-scenario",
    "broker_list_watchlists": "watchlist",
    "broker_get_watchlist_symbols": "watchlist",
    "intel_get_feed": "intel-feed",
    "intel_list_alert_workflows": "alert-rule-draft",
    "intel_list_alert_notifications": "alert-rule-draft",
    "alert_get_studio": "alert-rule-draft",
    "workspace_get_micro_app": "micro-app",
    "workspace_publish_html_artifact": "html-artifact",
}


def html_artifact_document_errors(document: str) -> list[str]:
    errors: list[str] = []
    if not isinstance(document, str) or not document.strip():
        errors.append("document must be a non-empty string")
        return errors
    if len(document) > HTML_ARTIFACT_DOCUMENT_MAX:
        errors.append(f"document must be at most {HTML_ARTIFACT_DOCUMENT_MAX} characters")
    if _HTML_ARTIFACT_IFRAME_RE.search(document):
        errors.append("document must not include iframe elements")
    if _HTML_ARTIFACT_JS_URL_RE.search(document):
        errors.append("document must not include javascript: URLs")
    if _HTML_ARTIFACT_META_HTTP_EQUIV_RE.search(document):
        errors.append("document must not include meta http-equiv tags")
    if _HTML_ARTIFACT_REMOTE_SCRIPT_RE.search(document):
        errors.append("document must not include remote script src URLs")
    if _HTML_ARTIFACT_REMOTE_LINK_RE.search(document):
        errors.append("document must not include remote link href URLs")
    if _HTML_ARTIFACT_REMOTE_IMG_RE.search(document):
        errors.append("document must not include remote img src URLs")
    return errors


def sanitize_html_artifact_document(document: str) -> str:
    """Strip forbidden patterns, apply the Ananta canvas kit shell, and enforce length."""

    raw = str(document or "").strip()
    errors = html_artifact_document_errors(raw)
    if errors:
        raise ValueError(errors[0])
    cleaned = _HTML_ARTIFACT_IFRAME_RE.sub("", raw)
    cleaned = _HTML_ARTIFACT_META_HTTP_EQUIV_RE.sub("", cleaned)
    cleaned = _HTML_ARTIFACT_REMOTE_SCRIPT_RE.sub("", cleaned)
    cleaned = _HTML_ARTIFACT_REMOTE_LINK_RE.sub("", cleaned)
    cleaned = _HTML_ARTIFACT_REMOTE_IMG_RE.sub("", cleaned)
    cleaned = _HTML_ARTIFACT_JS_URL_RE.sub("", cleaned)
    cleaned = cleaned.strip()
    if not cleaned:
        raise ValueError("Canvas document is empty after sanitization")
    wrapped = prepare_canvas_html(cleaned)
    if len(wrapped) > HTML_ARTIFACT_DOCUMENT_MAX:
        raise ValueError(f"document must be at most {HTML_ARTIFACT_DOCUMENT_MAX} characters after wrapping")
    return wrapped


class WorkspaceLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["grid"] = "grid"
    columns: int = Field(default=12, ge=12, le=12)


class WorkspacePosition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: int = Field(ge=0, lt=GRID_COLUMNS)
    y: int = Field(ge=0)
    w: int = Field(ge=1, le=GRID_COLUMNS)
    h: int = Field(ge=1, le=24)

    @model_validator(mode="after")
    def fit_grid(self):
        if self.x + self.w > GRID_COLUMNS:
            raise ValueError("component position exceeds the 12-column grid")
        return self


class WorkspaceDataRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool: str
    params: dict[str, Any] = Field(default_factory=dict)

    @field_validator("tool")
    @classmethod
    def allowlisted_tool(cls, value: str) -> str:
        if value not in ALLOWED_DATA_TOOLS:
            raise ValueError(f"data tool {value!r} is not allowlisted")
        return value

    @field_validator("params")
    @classmethod
    def reject_secret_params(cls, value: dict[str, Any]) -> dict[str, Any]:
        blocked = {"api_key", "password", "pin", "totp", "secret", "token", "access_token"}
        lowered = {str(key).lower() for key in value}
        hit = lowered & blocked
        if hit:
            raise ValueError(f"data params must not include {sorted(hit)}")
        return value


class WorkspaceComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-z][a-z0-9-]*$")
    type: str
    position: WorkspacePosition
    data: WorkspaceDataRef | None = None
    props: dict[str, Any] = Field(default_factory=dict)
    actions: list[str] = Field(default_factory=list)

    @field_validator("type")
    @classmethod
    def allowlisted_type(cls, value: str) -> str:
        if value not in ALLOWED_COMPONENT_TYPES:
            raise ValueError(f"component type {value!r} is not in the catalog")
        return value

    @field_validator("props")
    @classmethod
    def semantic_props_only(cls, value: dict[str, Any]) -> dict[str, Any]:
        for key in value:
            if key in FORBIDDEN_PROP_KEYS or key.lower() in FORBIDDEN_PROP_KEYS:
                raise ValueError(f"prop {key!r} is not allowed on WorkspaceSpec")
        return value

    @field_validator("actions")
    @classmethod
    def allowlisted_actions(cls, value: list[str]) -> list[str]:
        unknown = [item for item in value if item not in ALLOWED_ACTIONS]
        if unknown:
            raise ValueError(f"unsupported actions: {unknown}")
        return value

    @model_validator(mode="after")
    def catalog_specific_props(self):
        props = self.props
        if self.type == "micro-app":
            app_id = props.get("appId") if isinstance(props.get("appId"), str) else props.get("app_id")
            if not isinstance(app_id, str) or app_id not in MICRO_APP_IDS:
                raise ValueError("micro-app requires props.appId from the curated registry")
            props["appId"] = app_id
            props.pop("app_id", None)
            if self.data is not None and self.data.tool != "workspace_get_micro_app":
                raise ValueError("micro-app data.tool must be workspace_get_micro_app")
            kind = props.get("kind")
            if kind is not None and kind not in MICRO_APP_KINDS:
                raise ValueError("micro-app kind must be call, put, or straddle")
            for key in ("spot", "strike", "premium", "width_pct"):
                if key not in props:
                    continue
                value = props[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ValueError(f"micro-app {key} must be a number")
        if self.type == "html-artifact":
            if self.data is None:
                raise ValueError("Canvas requires data with params.document")
            if self.data.tool != "workspace_publish_html_artifact":
                raise ValueError("Canvas data.tool must be workspace_publish_html_artifact")
            document = self.data.params.get("document")
            if not isinstance(document, str) or not document.strip():
                raise ValueError("Canvas requires data.params.document")
            doc_errors = html_artifact_document_errors(document)
            if doc_errors:
                raise ValueError(doc_errors[0])
            try:
                self.data.params["document"] = sanitize_html_artifact_document(document)
            except ValueError as exc:
                raise ValueError(str(exc)) from exc
            title = props.get("title")
            if title is not None and (not isinstance(title, str) or not title.strip() or len(title) > HTML_ARTIFACT_TITLE_MAX):
                raise ValueError("Canvas title must be a non-empty string up to 120 characters")
            props["kind"] = normalize_kind(str(props.get("kind") or ""))
        if self.type != "html-artifact" and self.data is not None and "document" in self.data.params:
            raise ValueError("data.params.document is only allowed on html-artifact widgets")
        if self.type == "notes-block":
            text = props.get("text")
            if text is not None and (not isinstance(text, str) or len(text) > NOTES_BLOCK_TEXT_MAX):
                raise ValueError("notes-block text must be a string up to 16000 characters")
        if self.type == "intel-feed":
            products = props.get("products")
            if products is not None:
                if not isinstance(products, list) or not products:
                    raise ValueError("intel-feed products must be a non-empty list")
                unknown = [item for item in products if item not in INTEL_FEED_PRODUCTS]
                if unknown:
                    raise ValueError(f"intel-feed products must be news, announcements, earnings, concalls, or alerts: {unknown}")
            product = props.get("product")
            if product is not None and product not in INTEL_FEED_PRODUCTS:
                raise ValueError("intel-feed product must be news, announcements, earnings, concalls, or alerts")
        if self.type in {"quote-ticker", "quote-chart", "price-chart", "intel-feed"}:
            hidden = props.get("hiddenSymbols") or props.get("hidden_symbols")
            if hidden is not None:
                if not isinstance(hidden, list) or any(not isinstance(item, str) for item in hidden):
                    raise ValueError("hiddenSymbols must be a list of symbol strings")
                props["hiddenSymbols"] = [str(item).strip().upper() for item in hidden if str(item).strip()]
                props.pop("hidden_symbols", None)
        if self.type == "quote-chart":
            for key in ("showChart", "showQuotes"):
                value = props.get(key)
                if value is not None and not isinstance(value, bool):
                    raise ValueError(f"quote-chart {key} must be a boolean")
            history_days = props.get("historyDays") or props.get("history_days")
            if history_days is not None:
                if isinstance(history_days, bool) or not isinstance(history_days, (int, float)) or history_days < 1:
                    raise ValueError("quote-chart historyDays must be a positive number")
        return self


class WorkspaceUniverse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbols: list[str] = Field(default_factory=list)

    @field_validator("symbols")
    @classmethod
    def normalize_symbols(cls, value: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for item in value:
            symbol = str(item or "").strip().upper()
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            out.append(symbol)
            if len(out) >= 40:
                break
        return out


def rectangles_overlap(left: WorkspacePosition, right: WorkspacePosition) -> bool:
    return (
        left.x < right.x + right.w
        and left.x + left.w > right.x
        and left.y < right.y + right.h
        and left.y + left.h > right.y
    )


def pack_component_positions(components: list[WorkspaceComponent]) -> list[WorkspaceComponent]:
    """Push colliding widgets down so a compose/restore turn never stacks them."""

    if len(components) < 2:
        return components
    order = sorted(
        range(len(components)),
        key=lambda index: (components[index].position.y, components[index].position.x, index),
    )
    occupied: list[WorkspacePosition] = []
    packed_by_id: dict[str, WorkspacePosition] = {}
    for index in order:
        item = components[index]
        candidate = item.position
        guard = 0
        while any(rectangles_overlap(candidate, other) for other in occupied) and guard < 240:
            candidate = candidate.model_copy(update={"y": candidate.y + 1})
            guard += 1
        occupied.append(candidate)
        packed_by_id[item.id] = candidate
    return [item.model_copy(update={"position": packed_by_id[item.id]}) for item in components]


class WorkspaceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal["1"] = "1"
    title: str = Field(min_length=1, max_length=120)
    layout: WorkspaceLayout = Field(default_factory=WorkspaceLayout)
    universe: WorkspaceUniverse = Field(default_factory=WorkspaceUniverse)
    components: list[WorkspaceComponent] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_component_ids(self):
        ids = [item.id for item in self.components]
        if len(ids) != len(set(ids)):
            raise ValueError("component ids must be unique")
        packed = pack_component_positions(self.components)
        if packed is not self.components:
            self.components = packed
        return self


def parse_workspace_spec(payload: dict[str, Any]) -> WorkspaceSpec:
    return WorkspaceSpec.model_validate(payload)


def component_type_for_tool(tool_name: str) -> str | None:
    return TOOL_COMPONENT_MAP.get(tool_name)


def empty_workspace_spec(title: str = "Untitled desk") -> WorkspaceSpec:
    return WorkspaceSpec(title=title)


def workspace_spec_dump(spec: WorkspaceSpec) -> dict[str, Any]:
    return spec.model_dump(mode="json")


def next_component_id(existing_ids: list[str], prefix: str) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in prefix.lower()).strip("-") or "widget"
    slug = slug[:40]
    if slug[0].isdigit():
        slug = f"c-{slug}"
    candidate = slug
    index = 2
    taken = set(existing_ids)
    while candidate in taken:
        candidate = f"{slug}-{index}"
        index += 1
    return candidate


def workspace_authoring_docs() -> dict[str, Any]:
    """Catalog and fail-closed rules the agent must follow when composing a desk."""

    preferred = (
        "holdings-table",
        "quote-ticker",
        "price-chart",
        "broker-health",
    )
    return {
        "version": WORKSPACE_SPEC_VERSION,
        "grid": {
            "mode": "grid",
            "columns": GRID_COLUMNS,
            "id_pattern": "^[a-z][a-z0-9-]*$",
            "position_rule": "x >= 0, y >= 0, w >= 1, h >= 1, x + w <= 12. Widgets must not overlap; colliding positions are packed downward before the compose turn is stored.",
            "preferred_sizes": {
                "quote-ticker": {"w": 6, "h": 3},
                "holdings-table": {"w": 12, "h": 5},
                "holdings-vs-index": {"w": 12, "h": 6},
                "price-chart": {"w": 8, "h": 4},
                "quote-chart": {"w": 12, "h": 7},
                "broker-health": {"w": 4, "h": 3},
                "watchlist": {"w": 4, "h": 4},
                "intel-feed": {"w": 6, "h": 5},
                "alert-rule-draft": {"w": 6, "h": 4},
                "workflow-graph": {"w": 6, "h": 5},
                "workflow-simulation": {"w": 6, "h": 4},
                "approval-card": {"w": 6, "h": 4},
                "micro-app": {"w": 6, "h": 5},
                "html-artifact": {"w": 12, "h": 8},
                "agent-timeline": {"w": 12, "h": 4},
                "notes-block": {"w": 4, "h": 4},
                "option-chain": {"w": 8, "h": 6},
                "greeks-panel": {"w": 6, "h": 5},
                "margin-scenario": {"w": 6, "h": 4},
                "pnl-exposure-strip": {"w": 6, "h": 4},
                "market-heatmap": {"w": 8, "h": 6},
            },
        },
        "component_types": sorted(ALLOWED_COMPONENT_TYPES),
        "live_component_types": [
            "agent-timeline",
            "alert-rule-draft",
            "approval-card",
            "broker-health",
            "greeks-panel",
            "holdings-table",
            "holdings-vs-index",
            "intel-feed",
            "margin-scenario",
            "market-heatmap",
            "micro-app",
            "html-artifact",
            "notes-block",
            "option-chain",
            "pnl-exposure-strip",
            "portfolio-summary",
            "price-chart",
            "quote-chart",
            "quote-ticker",
            "watchlist",
            "workflow-graph",
            "workflow-simulation",
        ],
        "preferred_component_types": list(preferred)
        + [
            "quote-chart",
            "watchlist",
            "intel-feed",
            "alert-rule-draft",
            "option-chain",
            "greeks-panel",
            "margin-scenario",
            "pnl-exposure-strip",
            "holdings-vs-index",
            "market-heatmap",
            "notes-block",
        ],
        "data_tools": sorted(ALLOWED_DATA_TOOLS),
        "actions": sorted(ALLOWED_ACTIONS),
        "forbidden_prop_keys": sorted(FORBIDDEN_PROP_KEYS),
        "tool_component_map": dict(TOOL_COMPONENT_MAP),
        "micro_apps": sorted(MICRO_APP_IDS),
        "a2ui": {"version": A2UI_VERSION, "catalog_id": A2UI_CATALOG_ID, "internal": True},
        "common_mistakes": {
            "holdings": "holdings-table",
            "portfolio": "holdings-table",
            "vs-index": "holdings-vs-index",
            "vs nifty": "holdings-vs-index",
            "quotes": "quote-ticker",
            "quote": "quote-ticker",
            "quote-chart": "quote-chart",
            "quotes-and-chart": "quote-chart",
            "chart": "price-chart",
            "session-status": "broker-health",
            "broker-status": "broker-health",
            "health": "broker-health",
            "news": "intel-feed",
            "announcements": "intel-feed",
            "watchlist": "watchlist",
            "alerts": "alert-rule-draft",
            "studio": "alert-rule-draft",
            "workflow-studio": "workflow-graph",
            "simulation": "workflow-simulation",
            "deploy": "approval-card",
            "payoff": "micro-app",
            "sandbox": "micro-app",
            "timeline": "agent-timeline",
            "notes": "notes-block",
            "option-chain": "option-chain",
            "greeks": "greeks-panel",
            "margin": "margin-scenario",
            "pnl": "pnl-exposure-strip",
            "heatmap": "market-heatmap",
            "html": "html-artifact",
            "canvas": "html-artifact",
            "artifact": "html-artifact",
            "visualize": "html-artifact",
            "visualization": "html-artifact",
            "custom-table": "html-artifact",
            "custom-chart": "html-artifact",
        },
        "example_spec": {
            "version": "1",
            "title": "Morning portfolio review",
            "layout": {"mode": "grid", "columns": 12},
            "components": [
                {
                    "id": "holdings",
                    "type": "holdings-table",
                    "position": {"x": 0, "y": 0, "w": 8, "h": 5},
                    "data": {"tool": "broker_get_portfolio", "params": {"sections": ["holdings", "funds"]}},
                    "actions": ["select", "refresh", "remove", "duplicate"],
                },
                {
                    "id": "broker-health",
                    "type": "broker-health",
                    "position": {"x": 8, "y": 0, "w": 4, "h": 3},
                    "data": {"tool": "broker_get_session_status", "params": {}},
                    "actions": ["select", "refresh", "open-broker"],
                },
            ],
        },
        "rules": [
            "version must be the string '1'.",
            "layout.mode must be grid and layout.columns must be 12.",
            "Use only catalog component types. Unknown types are rejected.",
            "data.tool must be an allowlisted data tool (broker_*, intel_*, alert_get_studio, workspace_get_micro_app, or workspace_publish_html_artifact). Never include secrets.",
            "Never emit React, HTML, CSS, className, style, href, or src on props. html-artifact stores sanitized HTML only in data.params.document via workspace_publish_html_artifact.",
            "Component ids must be unique and match ^[a-z][a-z0-9-]*$. Positions must not overlap; the server packs colliding widgets downward before the turn is stored.",
            "Do not add extra keys on spec, component, position, layout, or data besides universe.",
            "universe.symbols is this desk's private symbol list (max 40). It is NOT a user Watchlists setting. Prefer it for multi-name research. Only use props.scope=watchlist plus watchlistId when the user named an existing watchlist.",
            "Set universe.symbols from broker_search_instruments / MCP / the names in the query, then bind quote-chart and intel-feed with props.scope=desk.",
            "Templates: investor, trader, researcher, operations. Skills: morning-brief, fno-desk, earnings-week, alert-studio, research-sandbox.",
            "Repeated requests may be suggested as a template/skill. Never auto-apply.",
            "Alert studio: alert_create_draft makes a draft (not live). alert_get_studio feeds alert-rule-draft, workflow-graph, workflow-simulation, and approval-card. Reuse alert_workflow_chat_snapshots. Never deploy without confirm=true.",
            "micro-app requires props.appId from the curated registry (payoff-diagram). Notes use notes-block, not a micro-app. Never emit src, href, or script.",
            "html-artifact (Canvas): after broker/intel/MCP data, call workspace_publish_html_artifact with kit-class HTML only (aw-*). Host injects CSS. Set props.title and props.kind. Use workspace_update_html_artifact(component_id) to evolve an existing canvas. No custom CSS, iframe, javascript: URLs, or remote script/link/img.",
            "notes-block is user-editable plain text (autosaved on the desk). Chat may set or replace props.text; keep it a string, no HTML.",
            "Do not answer by listing catalog types. Fetch data, compose live widgets, and brief in chat. MCP and local broker tools still run on this desk. Broker Chat is not deprecated.",
            "Symbol desks: set props.scope=symbol and props.symbol. Named-company desks: set universe.symbols and props.scope=desk on quote-chart / intel-feed / quote-ticker. User watchlists only when asked: props.scope=watchlist and props.watchlistId.",
            "Do not answer by listing catalog types. Fetch data, compose live widgets, and brief in chat. MCP and local broker tools still run on this desk.",
            "When the user asks about several companies' news/announcements/concalls, prefer one intel-feed with props.products=['news','announcements','concalls'] instead of one widget per product or per company.",
            "quote-chart and price-chart may list multiple symbols. hiddenSymbols hides a series and parks that quotes row at the bottom; it does not delete the binding.",
            "Cash-equity quotes/charts try NSE first, then BSE when NSE has no LTP/candles. Do not ask the user to pick an exchange for that fallback.",
            "option-chain, greeks-panel, margin-scenario, pnl-exposure-strip, and market-heatmap have live broker renderers. Compose those types instead of listing them as reserved.",
            "option-chain / greeks-panel: set props.symbol and props.expiry (YYYY-MM-DD) when the broker needs an F&O expiry. Fetch broker_get_option_chain / broker_get_greeks first. Still compose the widgets if those tools return unsupported — the live renderer shows that state instead of leaving empty catalog tiles.",
            "margin-scenario is a read-only estimate (broker_calculate_margin). Symbol + exchange is enough; the API hydrates broker scrip codes. Never place or mutate orders from this desk.",
            "pnl-exposure-strip reads holdings and positions P&L. market-heatmap uses the live heatmap API; set props.heatmapScope to tracked, watchlist, or portfolio_holdings.",
        ],
    }


def next_grid_position(components: list[WorkspaceComponent], w: int = 6, h: int = 3) -> WorkspacePosition:
    width = max(1, min(w, GRID_COLUMNS))
    height = max(1, min(h, 24))
    bottom = 0
    for item in components:
        bottom = max(bottom, item.position.y + item.position.h)
    return WorkspacePosition(x=0, y=bottom, w=width, h=height)
