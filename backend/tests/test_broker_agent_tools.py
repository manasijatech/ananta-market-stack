from app.agent_tools import BROKER_DATA_TOOLS, BrokerAgentContext


def test_broker_agent_tools_are_registered_with_descriptions():
    names = {tool.name for tool in BROKER_DATA_TOOLS}

    assert names == {
        "broker_list_accounts",
        "broker_get_session_status",
        "broker_verify_connection",
        "broker_run_session_maintenance",
        "broker_get_data_capabilities",
        "broker_search_instruments",
        "broker_sync_instruments",
        "broker_get_cached_quotes",
        "broker_get_quotes",
        "broker_get_ohlc",
        "broker_get_historical",
        "broker_get_option_chain",
        "broker_get_greeks",
        "broker_get_portfolio",
        "broker_get_profile",
        "broker_calculate_margin",
        "broker_get_stream_status",
    }
    assert all(tool.description for tool in BROKER_DATA_TOOLS)
    assert all(tool.params_json_schema for tool in BROKER_DATA_TOOLS)
    assert all("ctx" not in tool.params_json_schema.get("properties", {}) for tool in BROKER_DATA_TOOLS)


def test_broker_agent_context_keeps_account_overrides_optional():
    context = BrokerAgentContext(user_id="user-1")

    assert context.user_id == "user-1"
    assert context.default_account_id is None
    assert context.search_account_id is None
