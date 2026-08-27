import asyncio
from types import SimpleNamespace

from app.services.broker_chat_mcp import BrokerChatMcpHandle, _inventory_tool_names, mcp_context_instructions
from app.services.broker_chat_mcp_gate import (
    flatten_gated_mcp_servers,
    looks_like_call_token_error,
    parse_described_tools,
)


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
    assert "Cached MCP inventory" not in text
    assert _inventory_tool_names(handle.inventory or {}) == ["get_daily_summary", "get_news", "get_events"]


def test_mcp_context_flattened_names_forbid_describe_execute():
    handle = BrokerChatMcpHandle(
        manager=None,
        active_servers=[object()],
        enabled=True,
        flattened_tool_names=["get_daily_summary", "get_news"],
    )
    text = mcp_context_instructions(handle)
    assert "get_daily_summary" in text
    assert "Do NOT call describe_tools" in text


def test_parse_described_tools_extracts_call_tokens():
    items = parse_described_tools(
        {
            "tools": [
                {
                    "name": "get_daily_summary",
                    "call_token": "CgaPsX-ymZ8k",
                    "description": "Morning/evening market summary",
                    "inputSchema": {"type": "object", "properties": {}},
                },
                {"name": "execute_tool", "call_token": "skip-me"},
            ]
        }
    )
    assert [item["name"] for item in items] == ["get_daily_summary"]
    assert items[0]["call_token"] == "CgaPsX-ymZ8k"


def test_looks_like_call_token_error():
    assert looks_like_call_token_error("Describe the tool first, then pass its returned unexpired call_token")
    assert not looks_like_call_token_error("unknown symbol RELIANCE")


def test_flatten_blocks_gated_pair_when_native_tools_exist():
    class FakeServer:
        name = "drishti"
        tool_filter = None

        async def list_tools(self):
            return [
                SimpleNamespace(name="describe_tools"),
                SimpleNamespace(name="execute_tool"),
                SimpleNamespace(name="get_daily_summary"),
                SimpleNamespace(name="get_news"),
            ]

    server = FakeServer()
    wrappers, names = asyncio.run(flatten_gated_mcp_servers([server]))
    assert wrappers == []
    assert "get_daily_summary" in names
    assert server.tool_filter is not None
    assert "describe_tools" in server.tool_filter["blocked_tool_names"]
def test_flatten_wraps_described_tools_when_only_gated_pair_exists():
    class FakeServer:
        name = "drishti"
        tool_filter = None

        async def list_tools(self):
            return [SimpleNamespace(name="describe_tools"), SimpleNamespace(name="execute_tool")]

        async def call_tool(self, tool_name, arguments):
            assert tool_name == "describe_tools"
            return SimpleNamespace(
                isError=False,
                structuredContent={
                    "tools": [
                        {
                            "name": "get_daily_summary",
                            "call_token": "tok-1",
                            "description": "Daily summary",
                            "inputSchema": {"type": "object", "properties": {}},
                        }
                    ]
                },
                content=[],
            )

    server = FakeServer()
    wrappers, names = asyncio.run(flatten_gated_mcp_servers([server]))
    assert names == ["get_daily_summary"]
    assert len(wrappers) == 1
    assert wrappers[0].name == "get_daily_summary"
    assert server.tool_filter["blocked_tool_names"] == ["describe_tools", "execute_tool"]
