from pydantic import ValidationError

from app.schemas.adaptive_workspace import (
    TOOL_COMPONENT_MAP,
    component_type_for_tool,
    parse_workspace_spec,
)


def _valid_spec(**overrides):
    payload = {
        "version": "1",
        "title": "Morning portfolio review",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "risk-summary",
                "type": "holdings-table",
                "position": {"x": 0, "y": 0, "w": 8, "h": 4},
                "data": {
                    "tool": "broker_get_portfolio",
                    "params": {"sections": ["holdings", "positions"]},
                },
                "props": {"account": "default", "showFreshness": True},
                "actions": ["pin", "refresh", "create-alert"],
            }
        ],
    }
    payload.update(overrides)
    return payload


def test_parses_valid_workspace_spec():
    spec = parse_workspace_spec(_valid_spec())

    assert spec.version == "1"
    assert spec.layout.columns == 12
    assert spec.components[0].type == "holdings-table"
    assert spec.components[0].data.tool == "broker_get_portfolio"


def test_rejects_unknown_component_type():
    payload = _valid_spec()
    payload["components"][0]["type"] = "made-up-widget"
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "not in the catalog" in str(exc)
    else:
        raise AssertionError("expected ValidationError")


def test_rejects_react_and_style_props():
    payload = _valid_spec()
    payload["components"][0]["props"] = {"className": "text-red-500", "style": {"color": "red"}}
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "not allowed" in str(exc)
    else:
        raise AssertionError("expected ValidationError")


def test_rejects_credential_params_and_unknown_tools():
    payload = _valid_spec()
    payload["components"][0]["data"] = {"tool": "broker_get_quotes", "params": {"api_key": "secret"}}
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "api_key" in str(exc)
    else:
        raise AssertionError("expected ValidationError")

    payload["components"][0]["data"] = {"tool": "os_system", "params": {}}
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "not allowlisted" in str(exc)
    else:
        raise AssertionError("expected ValidationError")


def test_rejects_overflowing_grid_and_duplicate_ids():
    payload = _valid_spec()
    payload["components"][0]["position"] = {"x": 10, "y": 0, "w": 4, "h": 2}
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "12-column grid" in str(exc)
    else:
        raise AssertionError("expected ValidationError")

    payload = _valid_spec()
    payload["components"].append(
        {
            "id": "risk-summary",
            "type": "quote-ticker",
            "position": {"x": 0, "y": 4, "w": 4, "h": 2},
        }
    )
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "unique" in str(exc)
    else:
        raise AssertionError("expected ValidationError")


def test_maps_existing_broker_tools_to_catalog_types():
    assert component_type_for_tool("broker_get_quotes") == "quote-ticker"
    assert component_type_for_tool("broker_get_historical") == "price-chart"
    assert component_type_for_tool("broker_get_portfolio") == "holdings-table"
    assert component_type_for_tool("broker_get_session_status") == "broker-health"
    assert "broker_place_order" not in TOOL_COMPONENT_MAP
