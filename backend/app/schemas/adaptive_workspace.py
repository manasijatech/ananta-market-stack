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
]

ALLOWED_COMPONENT_TYPES: frozenset[str] = frozenset(WorkspaceComponentType.__args__)

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


def next_grid_position(components: list[WorkspaceComponent], w: int = 6, h: int = 3) -> WorkspacePosition:
    width = max(1, min(w, GRID_COLUMNS))
    height = max(1, min(h, 24))
    bottom = 0
    for item in components:
        bottom = max(bottom, item.position.y + item.position.h)
    return WorkspacePosition(x=0, y=bottom, w=width, h=height)
