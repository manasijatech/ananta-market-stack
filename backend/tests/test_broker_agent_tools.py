import asyncio
import json

from agents.tool_context import ToolContext
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.agent_tools import BROKER_DATA_TOOLS, BrokerAgentContext
from app.agent_tools import broker_tools
from db.models import BrokerAccount, BrokerAccountGrant, User, Workspace, WorkspaceMember
from db.session import Base


def test_broker_agent_tools_are_registered_with_descriptions():
    names = {tool.name for tool in BROKER_DATA_TOOLS}

    assert names == {
        "broker_list_accounts",
        "broker_list_watchlists",
        "broker_get_watchlist_symbols",
        "broker_create_watchlist",
        "broker_rename_watchlist",
        "broker_delete_watchlist",
        "broker_add_watchlist_symbols",
        "broker_replace_watchlist_symbols",
        "broker_remove_watchlist_symbols",
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


def test_broker_chat_lists_and_resolves_workspace_dhan_account(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    db.add_all(
        [
            User(id="chat-user", display_name="Chat User"),
            User(id="account-owner", display_name="Account Owner"),
        ]
    )
    db.commit()
    db.add(Workspace(id="workspace-1", name="Workspace"))
    db.commit()
    db.add_all(
        [
            WorkspaceMember(
                id="member-chat",
                workspace_id="workspace-1",
                user_id="chat-user",
                role="viewer",
                status="active",
            ),
            WorkspaceMember(
                id="member-owner",
                workspace_id="workspace-1",
                user_id="account-owner",
                role="admin",
                status="active",
            ),
        ]
    )
    db.commit()
    db.add(
        BrokerAccount(
            id="dhan-account",
            workspace_id="workspace-1",
            user_id="account-owner",
            broker_code="dhan",
            label="Primary Dhan",
            is_active=True,
        )
    )
    db.commit()
    db.add(
        BrokerAccountGrant(
            id="grant-chat-dhan",
            workspace_id="workspace-1",
            account_id="dhan-account",
            subject_type="user",
            subject_id="chat-user",
            permissions_json=json.dumps(["broker.view", "broker.use_data"]),
        )
    )
    db.commit()
    db.close()
    monkeypatch.setattr(broker_tools, "SessionLocal", session_factory)

    context = BrokerAgentContext(user_id="chat-user")
    tool_context = ToolContext(
        context=context,
        tool_name="broker_list_accounts",
        tool_call_id="call-1",
        tool_arguments="{}",
    )
    result = asyncio.run(broker_tools.broker_list_accounts.on_invoke_tool(tool_context, "{}"))

    assert result["ok"] is True
    assert result["workspace_id"] == "workspace-1"
    assert [account["broker_code"] for account in result["accounts"]] == ["dhan"]
    assert result["accounts"][0]["account_id"] == "dhan-account"
    assert result["accounts"][0]["is_shared"] is True
    assert result["accounts"][0]["access_permissions"] == ["broker.use_data", "broker.view"]
    assert result["default_config"]["accounts"][0]["broker_code"] == "dhan"
    assert result["search_config"]["accounts"][0]["broker_code"] == "dhan"

    capability_context = ToolContext(
        context=context,
        tool_name="broker_get_data_capabilities",
        tool_call_id="call-2",
        tool_arguments='{"account_id":"dhan-account"}',
    )
    capabilities = asyncio.run(
        broker_tools.broker_get_data_capabilities.on_invoke_tool(
            capability_context,
            '{"account_id":"dhan-account"}',
        )
    )
    assert capabilities["ok"] is True
    assert capabilities["account"]["broker_code"] == "dhan"
    assert capabilities["capabilities"]["quotes"]["supported"] is True
    assert capabilities["capabilities"]["historical"]["supported"] is True
    assert capabilities["capabilities"]["option_chain"]["supported"] is True
    assert capabilities["capabilities"]["greeks"]["supported"] is True

    db = session_factory()
    try:
        resolved = broker_tools._resolve_account(
            db,
            tool_context,
            account_id="dhan-account",
            require_session=False,
        )
        assert resolved.id == "dhan-account"
        assert resolved.broker_code == "dhan"
    finally:
        db.close()
