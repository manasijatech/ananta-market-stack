from pydantic import ValidationError

from app.schemas.adaptive_workspace import (
    TOOL_COMPONENT_MAP,
    component_type_for_tool,
    parse_workspace_spec,
    workspace_authoring_docs,
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
    assert component_type_for_tool("broker_get_watchlist_symbols") == "watchlist"
    assert component_type_for_tool("intel_get_feed") == "intel-feed"
    assert component_type_for_tool("intel_list_alert_workflows") == "alert-rule-draft"
    assert "broker_place_order" not in TOOL_COMPONENT_MAP


def test_authoring_docs_list_catalog_and_example_spec():
    docs = workspace_authoring_docs()
    assert "holdings-table" in docs["component_types"]
    assert "broker-health" in docs["preferred_component_types"]
    assert docs["example_spec"]["components"][0]["type"] == "holdings-table"
    assert "broker_get_portfolio" in docs["data_tools"]
    assert "intel_get_feed" in docs["data_tools"]
    assert "watchlist" in docs["preferred_component_types"]
    assert "quote-chart" in docs["component_types"]
    assert "quote-chart" in docs["preferred_component_types"]


def test_evaluate_request_covers_watchlist_news_quotes_and_alerts():
    from app.services.adaptive_workspace import evaluate_request

    query = "Compose a desk with my last watchlist, add its news, as well as live price movements of them, along with their alerts."
    planned = evaluate_request(query)
    assert planned["intents"] == ["watchlist", "quotes", "news", "alerts"]
    assert "broker_get_watchlist_symbols" in planned["recommended_tools"]
    assert "broker_get_quotes" in planned["recommended_tools"]
    assert "intel_get_feed" in planned["recommended_tools"]
    assert "intel_list_alert_workflows" in planned["recommended_tools"]
    assert planned["recommended_types"] == ["watchlist", "quote-ticker", "intel-feed", "alert-rule-draft"]
    assert planned["complements_query"] is False
    assert planned["missing_from_spec"] == planned["recommended_types"]

    spec = {
        "version": "1",
        "title": "Watchlist desk",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "watchlist",
                "type": "watchlist",
                "position": {"x": 0, "y": 0, "w": 4, "h": 4},
                "data": {"tool": "broker_get_watchlist_symbols", "params": {}},
            },
            {
                "id": "quotes",
                "type": "quote-ticker",
                "position": {"x": 4, "y": 0, "w": 8, "h": 3},
                "data": {"tool": "broker_get_quotes", "params": {}},
            },
            {
                "id": "news",
                "type": "intel-feed",
                "position": {"x": 0, "y": 4, "w": 6, "h": 5},
                "data": {"tool": "intel_get_feed", "params": {"product": "news"}},
            },
            {
                "id": "alerts",
                "type": "alert-rule-draft",
                "position": {"x": 6, "y": 4, "w": 6, "h": 4},
                "data": {"tool": "intel_list_alert_workflows", "params": {}},
            },
        ],
    }
    covered = evaluate_request(
        query,
        spec=spec,
        observations={
            "watchlist_symbol_count": 3,
            "quote_count": 3,
            "quotes_with_change_pct": 3,
            "news_item_count": 4,
            "alert_workflow_count": 1,
            "alert_notification_count": 2,
        },
    )
    assert covered["missing_from_spec"] == []
    assert covered["complements_query"] is True
    assert covered["backtest_lite"]["session_move_ok"] is True
    assert covered["backtest_lite"]["needs_historical"] is False


def test_evaluate_request_prefers_combined_quote_chart_for_quotes_and_chart():
    from app.services.adaptive_workspace import evaluate_request

    planned = evaluate_request("Show live quotes and a price chart for RELIANCE and TCS")
    assert "quotes" in planned["intents"]
    assert "chart" in planned["intents"]
    assert "quote-chart" in planned["recommended_types"]
    assert "quote-ticker" not in planned["recommended_types"]
    assert "price-chart" not in planned["recommended_types"]

    combined = evaluate_request(
        "Show live quotes and a price chart for RELIANCE and TCS",
        spec={
            "version": "1",
            "title": "Combined",
            "layout": {"mode": "grid", "columns": 12},
            "components": [
                {
                    "id": "market",
                    "type": "quote-chart",
                    "position": {"x": 0, "y": 0, "w": 12, "h": 7},
                    "data": {"tool": "broker_get_quotes", "params": {}},
                    "props": {"scope": "symbol", "symbols": ["RELIANCE", "TCS"]},
                }
            ],
        },
        observations={"quote_count": 2, "quotes_with_change_pct": 2},
    )
    assert combined["missing_from_spec"] == []
    assert combined["complements_query"] is True


def test_quote_chart_and_combined_intel_products_are_valid():
    spec = parse_workspace_spec(
        {
            "version": "1",
            "title": "Research desk",
            "layout": {"mode": "grid", "columns": 12},
            "components": [
                {
                    "id": "market",
                    "type": "quote-chart",
                    "position": {"x": 0, "y": 0, "w": 12, "h": 7},
                    "data": {"tool": "broker_get_quotes", "params": {}},
                    "props": {
                        "scope": "symbol",
                        "symbols": ["RELIANCE", "TCS"],
                        "hiddenSymbols": ["TCS"],
                        "showChart": True,
                        "showQuotes": True,
                        "historyDays": 90,
                    },
                },
                {
                    "id": "intel",
                    "type": "intel-feed",
                    "position": {"x": 0, "y": 7, "w": 12, "h": 5},
                    "data": {"tool": "intel_get_feed", "params": {"products": ["news", "concalls"]}},
                    "props": {"products": ["news", "announcements", "concalls"]},
                },
            ],
        }
    )
    assert spec.components[0].type == "quote-chart"
    assert spec.components[0].props["hiddenSymbols"] == ["TCS"]
    assert spec.components[1].props["products"] == ["news", "announcements", "concalls"]


def test_workspace_universe_is_desk_private():
    spec = parse_workspace_spec(
        {
            "version": "1",
            "title": "Named names",
            "layout": {"mode": "grid", "columns": 12},
            "universe": {"symbols": ["reliance", "TCS", "reliance"]},
            "components": [
                {
                    "id": "market",
                    "type": "quote-chart",
                    "position": {"x": 0, "y": 0, "w": 12, "h": 7},
                    "props": {"scope": "desk"},
                }
            ],
        }
    )
    assert spec.universe.symbols == ["RELIANCE", "TCS"]


def test_evaluate_request_flags_empty_quotes_as_not_complementing():
    from app.services.adaptive_workspace import evaluate_request

    result = evaluate_request(
        "live price movements for my watchlist",
        spec={
            "version": "1",
            "title": "Quotes only",
            "layout": {"mode": "grid", "columns": 12},
            "components": [
                {
                    "id": "quotes",
                    "type": "quote-ticker",
                    "position": {"x": 0, "y": 0, "w": 6, "h": 3},
                    "data": {"tool": "broker_get_quotes", "params": {}},
                },
                {
                    "id": "watchlist",
                    "type": "watchlist",
                    "position": {"x": 6, "y": 0, "w": 6, "h": 3},
                    "data": {"tool": "broker_get_watchlist_symbols", "params": {}},
                },
            ],
        },
        observations={"quote_count": 0, "watchlist_symbol_count": 4},
    )
    assert result["complements_query"] is False
    assert any("Quotes intent is unmet" in note for note in result["notes"])
