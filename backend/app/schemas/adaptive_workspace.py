"""Declarative Adaptive Workspace specification.

The agent may emit this document. The frontend maps component types to the
Ananta registry. Arbitrary React, HTML, CSS, or script is rejected.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

WORKSPACE_SPEC_VERSION = "1"
GRID_COLUMNS = 12

WorkspaceComponentType = Literal[
    "portfolio-summary",
    "holdings-table",
    "pnl-exposure-strip",
    "price-chart",
    "quote-ticker",
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
]

ALLOWED_COMPONENT_TYPES: frozenset[str] = frozenset(WorkspaceComponentType.__args__)

MICRO_APP_IDS: frozenset[str] = frozenset({"payoff-diagram", "notes-scratch"})
MICRO_APP_KINDS: frozenset[str] = frozenset({"call", "put", "straddle"})
NOTES_TEXT_MAX = 4000
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
}


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
            text = props.get("text")
            if text is not None and (not isinstance(text, str) or len(text) > NOTES_TEXT_MAX):
                raise ValueError("micro-app text must be a short string")
        if self.type == "notes-block":
            text = props.get("text")
            if text is not None and (not isinstance(text, str) or len(text) > NOTES_TEXT_MAX):
                raise ValueError("notes-block text must be a short string")
        return self


class WorkspaceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal["1"] = "1"
    title: str = Field(min_length=1, max_length=120)
    layout: WorkspaceLayout = Field(default_factory=WorkspaceLayout)
    components: list[WorkspaceComponent] = Field(default_factory=list)

    @model_validator(mode="after")
    def unique_component_ids(self):
        ids = [item.id for item in self.components]
        if len(ids) != len(set(ids)):
            raise ValueError("component ids must be unique")
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
            "position_rule": "x >= 0, y >= 0, w >= 1, h >= 1, x + w <= 12",
            "preferred_sizes": {
                "quote-ticker": {"w": 6, "h": 3},
                "holdings-table": {"w": 12, "h": 5},
                "price-chart": {"w": 8, "h": 4},
                "broker-health": {"w": 4, "h": 3},
                "watchlist": {"w": 4, "h": 4},
                "intel-feed": {"w": 6, "h": 5},
                "alert-rule-draft": {"w": 6, "h": 4},
                "workflow-graph": {"w": 6, "h": 5},
                "workflow-simulation": {"w": 6, "h": 4},
                "approval-card": {"w": 6, "h": 4},
                "micro-app": {"w": 6, "h": 5},
                "agent-timeline": {"w": 12, "h": 4},
                "notes-block": {"w": 4, "h": 4},
            },
        },
        "component_types": sorted(ALLOWED_COMPONENT_TYPES),
        "preferred_component_types": list(preferred) + ["watchlist", "intel-feed", "alert-rule-draft"],
        "data_tools": sorted(ALLOWED_DATA_TOOLS),
        "actions": sorted(ALLOWED_ACTIONS),
        "forbidden_prop_keys": sorted(FORBIDDEN_PROP_KEYS),
        "tool_component_map": dict(TOOL_COMPONENT_MAP),
        "micro_apps": sorted(MICRO_APP_IDS),
        "a2ui": {"version": A2UI_VERSION, "catalog_id": A2UI_CATALOG_ID, "internal": True},
        "common_mistakes": {
            "holdings": "holdings-table",
            "portfolio": "holdings-table",
            "quotes": "quote-ticker",
            "quote": "quote-ticker",
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
            "data.tool must be an allowlisted data tool (broker_*, intel_*, alert_get_studio, or workspace_get_micro_app). Never include secrets.",
            "Never emit React, HTML, CSS, className, style, href, src, or script.",
            "Component ids must be unique and match ^[a-z][a-z0-9-]*$.",
            "Do not add extra keys on spec, component, position, layout, or data.",
            "Templates: investor, trader, researcher, operations. Skills: morning-brief, fno-desk, earnings-week, alert-studio, research-sandbox.",
            "Repeated requests may be suggested as a template/skill. Never auto-apply.",
            "Alert studio: alert_get_studio feeds alert-rule-draft, workflow-graph, workflow-simulation, and approval-card. Reuse alert_workflow_chat_snapshots. Never deploy without confirm=true.",
            "micro-app requires props.appId from the curated registry (payoff-diagram, notes-scratch). Never emit src, href, or script.",
            "notes-block is plain text only.",
            "Symbol desks: set props.scope=symbol and props.symbol on quote-ticker, price-chart, intel-feed, and alerts. Watchlist desks: props.scope=watchlist and props.watchlistId.",
        ],
    }


def next_grid_position(components: list[WorkspaceComponent], w: int = 6, h: int = 3) -> WorkspacePosition:
    width = max(1, min(w, GRID_COLUMNS))
    height = max(1, min(h, 24))
    bottom = 0
    for item in components:
        bottom = max(bottom, item.position.y + item.position.h)
    return WorkspacePosition(x=0, y=bottom, w=width, h=height)
