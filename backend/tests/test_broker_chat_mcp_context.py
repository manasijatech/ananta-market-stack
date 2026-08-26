from app.services.broker_chat_mcp import _inventory_tool_names, mcp_context_instructions
from app.services.broker_chat_mcp import BrokerChatMcpHandle


def test_mcp_context_lists_tool_names_first():
    handle = BrokerChatMcpHandle(
        manager=None,
        active_servers=[object()],
        enabled=True,
        inventory={
            "servers": [{"id": "1", "name": "Drishti"}],
            "tools": [{"name": "get_daily_summary"}, {"name": "get_news"}, {"name": "get_events"}],
        },
    )
    text = mcp_context_instructions(handle)
    assert "get_daily_summary" in text
    assert "You MUST use advertised MCP tools" in text
    assert _inventory_tool_names(handle.inventory or {}) == ["get_daily_summary", "get_news", "get_events"]
