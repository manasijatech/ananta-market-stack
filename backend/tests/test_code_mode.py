import asyncio
import json
from types import SimpleNamespace

import pytest

from app.agent_harness.code_mode import (
    CODE_MODE_INSTRUCTIONS,
    CodeRegistry,
    api_tools,
    bootstrap,
    catalog_inventory,
    generate_api,
    normalize_result,
    select_strategy,
    signature,
)
from app.config import get_settings
from app.services.broker_chat_code_mode import (
    build_code_tool_event,
    prepare_broker_chat_tools,
    requested_tool_mode,
)


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _code_mode_shapes_do_not_touch_redis(monkeypatch):
    """Shape memory uses Redis when it is up. Tests must not write to a shared server."""

    def unavailable():
        raise RuntimeError("redis disabled in code mode tests")

    monkeypatch.setattr("app.services.broker_chat_queue.redis_connection", unavailable)


def tool(name="broker_get_quotes", schema=None, invoke=None, description="Read quotes."):
    async def default(ctx, args):
        return json.dumps({"ok": True, "data": json.loads(args)})

    return SimpleNamespace(
        name=name,
        description=description,
        params_json_schema=schema or {"type": "object", "properties": {"symbol": {"type": "string"}}, "required": ["symbol"]},
        on_invoke_tool=invoke or default,
        needs_approval=False,
    )


def test_stubs_varied_schemas():
    schema = {
        "properties": {
            "symbol": {"type": "string"},
            "count": {"type": "integer"},
            "items": {"type": "array", "items": {"type": "number"}},
            "choice": {"anyOf": [{"type": "boolean"}, {"type": "null"}]},
            "obj": {"$ref": "#/$defs/Thing"},
            "required_after_optional": {"type": "object"},
        },
        "required": ["required_after_optional"],
    }
    source = generate_api([tool(schema=schema), tool("weird", {"properties": {"from": {"type": "string"}}})])
    ns = {}
    exec(compile(source, "api.py", "exec"), ns)
    assert ns["list"]() == ["broker_get_quotes", "weird"]
    assert ns["describe"]("broker_get_quotes")["parameters"] == schema
    assert "broker_get_quotes" in ns["search"]("quotes")
    compile(bootstrap("from ananta import api", source), "<guest>", "exec")
    with pytest.raises(TypeError):
        ns["broker_get_quotes"]()


@pytest.mark.asyncio
async def test_wrappers_parallel_events_and_denial():
    barrier = asyncio.Event()
    active = []

    async def wrapped(ctx, args):
        assert ctx == "context"
        active.append(args)
        if len(active) == 2:
            barrier.set()
        await asyncio.wait_for(barrier.wait(), 1)
        return '{"ok": true, "source": "wrapped"}'

    events = []

    async def emit(kind, payload):
        events.append((kind, payload))

    registry = CodeRegistry([tool(invoke=wrapped)], emit)
    ledger = []
    result = await registry.dispatch(
        "context",
        {"id": 1, "calls": [{"name": "broker_get_quotes", "args": {}}] * 2},
        ledger,
        "parent",
    )
    assert all(item["ok"] for item in result["results"]) and len(ledger) == 2
    assert [event[0] for event in events].count("tool_call_completed") == 2
    assert all(event[1]["parent_tool"] == "code_run" for event in events)
    denied = await registry.dispatch(
        "context",
        {"id": 2, "calls": [{"name": "delete_all", "args": {}}]},
        ledger,
        "parent",
    )
    assert not denied["results"][0]["ok"]
    with pytest.raises(ValueError):
        await registry.dispatch(None, {"id": 3, "calls": [{}] * 9}, ledger, "parent")


def test_allowlist_keeps_reads_and_drops_mutations():
    from app.agent_tools.alert_studio_tools import ALERT_STUDIO_TOOLS
    from app.agent_tools.broker_tools import BROKER_DATA_TOOLS
    from app.agent_tools.web_tools import WEB_TOOLS
    from app.agent_tools.workspace_tools import WORKSPACE_TOOLS

    names = {
        item.name
        for item in api_tools([*BROKER_DATA_TOOLS, *WEB_TOOLS, *WORKSPACE_TOOLS, *ALERT_STUDIO_TOOLS])
    }
    assert "broker_get_quotes" in names
    assert "broker_get_historical" in names
    assert "broker_list_accounts" in names
    assert "web_search" in names
    assert "web_fetch" in names
    assert "broker_delete_watchlist" not in names
    assert "broker_sync_instruments" not in names
    assert "workspace_publish_html_artifact" not in names
    assert "alert_create_draft" not in names
    assert "compose_surface" not in names
    news = tool("get_news", description="News")
    execute = tool("execute_tool", description="Run")
    assert [item.name for item in api_tools([news, execute])] == ["get_news"]
    assert [item.name for item in api_tools([news, execute], mcp_names={"get_news", "execute_tool"})] == ["get_news"]


def test_strategy_and_catalog():
    assert select_strategy("code_mode", SimpleNamespace(available=False, capabilities=["python.bridge"])) == "direct"
    assert select_strategy("code_mode", SimpleNamespace(available=True, capabilities=[])) == "direct"
    assert select_strategy("code_mode", SimpleNamespace(available=True, capabilities=["python.bridge"])) == "code_mode"
    assert select_strategy("hybrid", SimpleNamespace(available=False, capabilities=["python.bridge"])) == "direct"
    assert select_strategy("hybrid", SimpleNamespace(available=True, capabilities=["python.bridge"])) == "hybrid"
    read, control, executor = tool(), tool("ask_user"), tool("code_run")
    attached = [read, control]
    inventory = catalog_inventory([read, control], attached, executor, [read])
    assert [item.name for item in attached] == ["ask_user", "code_run"]
    assert [item.name for item in inventory] == ["ask_user", "code_run"]


def test_metadata_override_requires_server_flag(monkeypatch):
    monkeypatch.setenv("CHAT_TOOL_MODE", "direct")
    monkeypatch.setenv("CHAT_TOOL_MODE_ALLOW_METADATA_OVERRIDE", "false")
    get_settings.cache_clear()
    assert requested_tool_mode({"chat_tool_mode": "code_mode"}) == "direct"
    monkeypatch.setenv("CHAT_TOOL_MODE_ALLOW_METADATA_OVERRIDE", "true")
    get_settings.cache_clear()
    assert requested_tool_mode({"chat_tool_mode": "code_mode"}) == "code_mode"
    assert requested_tool_mode({"chat_tool_mode": "nope"}) == "direct"
    monkeypatch.setenv("CHAT_TOOL_MODE", "code_mode")
    monkeypatch.setenv("CHAT_TOOL_MODE_ALLOW_METADATA_OVERRIDE", "false")
    get_settings.cache_clear()
    assert requested_tool_mode({}) == "code_mode"
    assert requested_tool_mode({"chat_tool_mode": "direct"}) == "code_mode"
    monkeypatch.setenv("CHAT_TOOL_MODE", "hybrid")
    get_settings.cache_clear()
    assert requested_tool_mode({"chat_tool_mode": "direct"}) == "hybrid"
    monkeypatch.setenv("CHAT_TOOL_MODE_ALLOW_METADATA_OVERRIDE", "true")
    get_settings.cache_clear()
    assert requested_tool_mode({"chat_tool_mode": "hybrid"}) == "hybrid"
    assert requested_tool_mode({"chat_tool_mode": "code_mode"}) == "code_mode"


def test_guest_rpc_partial_stdout_and_api_error(monkeypatch):
    import io
    import sys

    ns = {}
    exec(generate_api([tool()]), ns)
    output = io.StringIO()
    output.write("partial output")
    monkeypatch.setattr(sys, "stdout", output)
    monkeypatch.setattr(sys, "stdin", io.StringIO('{"id":1,"results":[{"ok":true,"value":{"price":10}}]}\n'))
    assert ns["broker_get_quotes"](symbol="TCS") == {"price": 10}
    frame = json.loads(output.getvalue().split("@@ANANTA_RPC ")[1])
    assert frame["calls"][0]["args"] == {"symbol": "TCS"}
    assert "\n@@ANANTA_RPC" in output.getvalue()
    monkeypatch.setattr(sys, "stdin", io.StringIO('{"id":2,"results":[{"ok":false,"error":"source blocked"}]}\n'))
    with pytest.raises(ns["ApiError"], match="source blocked"):
        ns["broker_get_quotes"](symbol="TCS")


def test_event_payload_uses_parent_tool():
    public, full = build_code_tool_event(
        "tool_call_completed",
        {
            "tool_name": "broker_get_quotes",
            "tool_call_id": "inner",
            "parent_tool": "code_run",
            "parent_tool_call_id": "parent",
            "ok": True,
            "output": {"price": 10},
        },
    )
    assert public["parent_tool"] == "code_run"
    assert public["display_name"] == "Live quotes"
    assert full["output"]["price"] == 10
    assert public["output_metadata"]["preview"]


@pytest.mark.asyncio
async def test_code_run_returns_only_printed_output_and_ledger(monkeypatch):
    from app.agent_tools import code_mode_tools

    events = []

    async def emit(kind, payload):
        events.append((kind, payload))

    async def bridge(**kwargs):
        assert kwargs["timeout_seconds"] == 120
        assert "def broker_get_quotes" in kwargs["api_source"]
        assert kwargs["user_id"] == "u"
        reply = await kwargs["rpc"]({"id": 1, "calls": [{"name": "broker_get_quotes", "args": {"symbol": "TCS"}}]})
        assert reply["results"][0]["value"]["data"] == {"symbol": "TCS"}
        return {"stdout": "x" * 9000, "stderr": "", "exit_code": 0}

    monkeypatch.setattr(code_mode_tools, "run_bridge", bridge)
    executor = code_mode_tools.make_code_run([tool()], user_id="u", session_key="s", emit=emit)
    result = json.loads(
        await executor.on_invoke_tool(
            SimpleNamespace(tool_call_id="parent"),
            json.dumps({"code": "print(42)", "timeout_seconds": 999}),
        )
    )
    assert len(result["stdout"]) == code_mode_tools.STDOUT_CHARS and result["calls"][0]["ok"]
    assert result["ok"] is True
    assert result["stdout_truncated"] is True
    assert "Aggregate" in result["note"]
    assert "compact table" in result["note"]
    assert "data" not in result
    assert all(event[1]["parent_tool_call_id"] == "parent" for event in events)

    async def failed_bridge(**kwargs):
        return {"stdout": "short", "stderr": "nope", "exit_code": 1}

    monkeypatch.setattr(code_mode_tools, "run_bridge", failed_bridge)
    failed = json.loads(
        await executor.on_invoke_tool(SimpleNamespace(tool_call_id="parent"), json.dumps({"code": "print(1)"}))
    )
    assert failed["ok"] is False
    assert "stdout_truncated" not in failed

    async def marked_truncated(**kwargs):
        return {"stdout": "short", "stderr": "", "exit_code": 0, "truncated": True}

    monkeypatch.setattr(code_mode_tools, "run_bridge", marked_truncated)
    cut = json.loads(
        await executor.on_invoke_tool(SimpleNamespace(tool_call_id="parent"), json.dumps({"code": "print(1)"}))
    )
    assert cut["ok"] is True and cut["stdout"] == "short" and cut["stdout_truncated"] is True


@pytest.mark.asyncio
async def test_fallback_when_socket_missing(monkeypatch):
    monkeypatch.setenv("CHAT_TOOL_MODE", "code_mode")
    get_settings.cache_clear()

    async def missing():
        return False, "socket_missing"

    monkeypatch.setattr("app.services.broker_chat_code_mode.sandbox_status", missing)
    quote = tool()
    mutation = tool("broker_delete_watchlist")
    handle = SimpleNamespace(active_servers=[], extra_tools=[], flattened_tool_names=[], enabled=False)
    plan = await prepare_broker_chat_tools(
        metadata={},
        local_tools=[quote, mutation],
        mcp_handle=handle,
        user_id="u",
        session_key="s",
        emit=None,
    )
    assert plan.mode == "direct"
    assert plan.event["reason"] == "socket_missing"
    assert plan.event["fallback"] == "direct"
    assert [item.name for item in plan.tools] == ["broker_get_quotes", "broker_delete_watchlist"]


@pytest.mark.asyncio
async def test_code_mode_strips_reads_and_mcp_servers(monkeypatch):
    monkeypatch.setenv("CHAT_TOOL_MODE", "direct")
    monkeypatch.setenv("CHAT_TOOL_MODE_ALLOW_METADATA_OVERRIDE", "true")
    get_settings.cache_clear()

    async def ready():
        return True, ""

    monkeypatch.setattr("app.services.broker_chat_code_mode.sandbox_status", ready)
    quote = tool()
    mutation = tool("broker_delete_watchlist")
    news = tool("get_news", description="Headlines")
    gate = tool("execute_tool", description="Do not expose")
    server = object()
    handle = SimpleNamespace(
        active_servers=[server],
        extra_tools=[news, gate],
        flattened_tool_names=["get_news"],
        enabled=True,
    )

    async def convert(servers):
        assert servers == [server]
        return [tool("search_filings", description="Filings"), tool("describe_tools")], []

    monkeypatch.setattr("app.services.broker_chat_code_mode.function_tools_from_mcp_servers", convert)
    plan = await prepare_broker_chat_tools(
        metadata={"chat_tool_mode": "code_mode"},
        local_tools=[quote, mutation],
        mcp_handle=handle,
        user_id="u",
        session_key="s",
        emit=lambda *args: None,
    )
    names = [item.name for item in plan.tools]
    assert plan.mode == "code_mode"
    assert plan.mcp_servers == []
    assert "broker_get_quotes" not in names
    assert "get_news" not in names
    assert "search_filings" in names
    assert "execute_tool" not in names
    assert "describe_tools" not in names
    assert "broker_delete_watchlist" in names
    assert names[-1] == "code_run"
    assert set(plan.api_names) == {"broker_get_quotes", "get_news"}


@pytest.mark.asyncio
async def test_mcp_tool_converts_into_api():
    from app.services.broker_chat_code_mode import function_tools_from_mcp_servers

    class FakeServer:
        name = "drishti"
        tool_input_guardrails = None
        tool_output_guardrails = None

        def _get_failure_error_function(self, fn):
            return fn

        def _get_needs_approval_for_tool(self, mcp_tool, agent):
            return False

        async def list_tools(self, run_context=None, agent=None):
            schema = {"type": "object", "properties": {"symbol": {"type": "string"}}, "required": ["symbol"]}
            return [
                SimpleNamespace(
                    name="get_news",
                    description="Headlines for a symbol",
                    inputSchema=schema,
                    input_schema=schema,
                    annotations=None,
                ),
                SimpleNamespace(
                    name="execute_tool",
                    description="gated",
                    inputSchema={"type": "object", "properties": {}},
                    input_schema={"type": "object", "properties": {}},
                    annotations=None,
                ),
            ]

    tools, failed = await function_tools_from_mcp_servers([FakeServer()])
    assert failed == []
    names = [item.name for item in tools]
    assert "get_news" in names
    assert "execute_tool" in names
    selected = api_tools(tools, mcp_names=set(names))
    assert [item.name for item in selected] == ["get_news"]
    source = generate_api(selected)
    assert "def get_news" in source
    assert "symbol" in source


@pytest.mark.asyncio
async def test_repeat_calls_always_go_through_the_wrapped_tool_and_envelopes_unwrap():
    calls = []

    async def invoke(ctx, args):
        calls.append(args)
        if len(calls) == 1:
            return json.dumps([{"symbol": "TCS"}])
        return json.dumps(
            {"ok": True, "data": [{"symbol": "TCS"}], "count": 1, "original_result_type": "list"}
        )

    events = []

    async def emit(kind, payload):
        events.append((kind, payload))

    registry = CodeRegistry([tool(invoke=invoke)], emit)
    ledger = []
    first = await registry.dispatch(
        None,
        {"id": 1, "calls": [{"name": "broker_get_quotes", "args": {"symbol": "TCS", "exchange": "NSE"}}]},
        ledger,
        "p",
    )
    second = await registry.dispatch(
        None,
        {"id": 2, "calls": [{"name": "broker_get_quotes", "args": {"exchange": "NSE", "symbol": "TCS"}}]},
        ledger,
        "p",
    )
    assert first["results"][0]["value"] == second["results"][0]["value"] == [{"symbol": "TCS"}]
    assert len(calls) == 2 and not any(entry.get("cached") for entry in ledger)
    assert [event[0] for event in events].count("tool_call_started") == 2
    assert [event[0] for event in events].count("tool_call_completed") == 2
    assert normalize_result({"ok": True, "data": [1], "count": 1, "original_result_type": "list"}) == [1]
    assert normalize_result({"ok": True, "data": [1]}) == {"ok": True, "data": [1]}

    async def envelope(ctx, args):
        calls.append(args)
        return json.dumps({"ok": True, "data": [{"symbol": "INFY"}], "count": 1, "original_result_type": "list"})

    wrapped = CodeRegistry([tool(invoke=envelope)], emit)
    opened = await wrapped.dispatch(
        None, {"id": 3, "calls": [{"name": "broker_get_quotes", "args": {"symbol": "INFY"}}]}, [], "p"
    )
    assert opened["results"][0]["value"] == [{"symbol": "INFY"}]


def test_signature_peek_and_reserved_name():
    schema = {
        "properties": {
            "symbols": {"type": "array", "items": {"type": "string"}},
            "limit": {"type": "integer", "default": 5},
        },
        "required": ["symbols"],
    }
    line = signature(tool("get_news", schema, description="Headlines for a symbol. Include the source."))
    assert line.startswith("api.get_news(symbols: List[str], limit: int = 5)")
    assert line.endswith("# Headlines for a symbol")
    source = generate_api([tool()])
    peek_src = source.split("def peek", 1)[1].split("\n_schemas", 1)[0]
    assert "list(" not in peek_src
    ns = {}
    exec(source, ns)
    assert ns["peek"]({"a": [{"b": 1}], "c": "x"}) == "{'a': [1 x {'b': int}], 'c': str}"
    assert ns["list"]() == ["broker_get_quotes"]
    assert [item.name for item in api_tools([tool("peek", description="must stay a helper")])] == []


def test_code_run_description_lists_signatures(monkeypatch):
    from app.agent_tools import code_mode_tools

    schema = {
        "type": "object",
        "properties": {"symbol": {"type": "string"}, "limit": {"type": "integer", "default": 5}},
        "required": ["symbol"],
    }
    executor = code_mode_tools.make_code_run(
        [tool(schema=schema, description="Read quotes for one symbol.")],
        user_id="u",
        session_key="s",
        emit=lambda *args: None,
    )
    assert "api.broker_get_quotes(symbol: str, limit: int = 5)  # Read quotes for one symbol" in executor.description
    assert "return_exceptions=True" in executor.description
    assert not hasattr(executor, "_ananta_code_registry")
    assert "api.peek(value)" in executor.description
    assert "Never print a whole result" in executor.description
    assert "api.earnings_rows(result)" in executor.description
    assert "value_cr" in executor.description
    assert "receipt_id" in executor.description
    assert '"-> {...}" shows a result shape' in executor.description
    assert 'news, movers = api.parallel([("search_news", {"queries": ["TCS results"], "days": 7}),' in executor.description
    assert 'for n in news[:3]: print(n.get("title"), n.get("published_at"), n.get("url"))' in executor.description
    assert "print(api.peek(movers))" in executor.description

    monkeypatch.setattr(code_mode_tools, "learned_shapes", lambda names: {"broker_get_quotes": "{'price': float}"})
    shaped = code_mode_tools.make_code_run(
        [tool(schema=schema, description="Read quotes for one symbol.")],
        user_id="u",
        session_key="s",
        emit=lambda *args: None,
    )
    assert "api.broker_get_quotes(symbol: str, limit: int = 5) -> {'price': float}  # Read quotes for one symbol" in shaped.description


def test_code_mode_instructions_require_one_script_and_peek():
    assert "code_run" in CODE_MODE_INSTRUCTIONS
    assert "ONE script" in CODE_MODE_INSTRUCTIONS
    assert "api.peek(result)" in CODE_MODE_INSTRUCTIONS
    assert "source" in CODE_MODE_INSTRUCTIONS
    assert "NOT direct tools" in CODE_MODE_INSTRUCTIONS
    assert "capability_load" not in CODE_MODE_INSTRUCTIONS
    assert "Drishti calls always read live data" in CODE_MODE_INSTRUCTIONS
    assert "repeated identical calls may be refused" in CODE_MODE_INSTRUCTIONS
    assert "Keep results in variables" in CODE_MODE_INSTRUCTIONS


def test_code_mode_defers_browser_and_sandbox_tools_but_keeps_them_in_inventory():
    read, control, browser, sandbox, executor = (
        tool(),
        tool("ask_user"),
        tool("browser_snapshot"),
        tool("sandbox_read_file"),
        tool("code_run"),
    )
    attached = [read, control, browser, sandbox]
    inventory = catalog_inventory([read, control, browser, sandbox], attached, executor, [read])
    assert [item.name for item in attached] == ["ask_user", "code_run"]
    assert {item.name for item in inventory} == {"ask_user", "browser_snapshot", "sandbox_read_file", "code_run"}


@pytest.mark.asyncio
async def test_code_mode_plan_drops_deferred_tools(monkeypatch):
    monkeypatch.setenv("CHAT_TOOL_MODE", "code_mode")
    get_settings.cache_clear()

    async def ready():
        return True, ""

    monkeypatch.setattr("app.services.broker_chat_code_mode.sandbox_status", ready)
    quote = tool()
    browser = tool("browser_snapshot", description="Page")
    sandbox = tool("sandbox_read_file", description="File")
    mutation = tool("broker_delete_watchlist")
    handle = SimpleNamespace(active_servers=[], extra_tools=[], flattened_tool_names=[], enabled=False)
    plan = await prepare_broker_chat_tools(
        metadata={},
        local_tools=[quote, browser, sandbox, mutation],
        mcp_handle=handle,
        user_id="u",
        session_key="s",
        emit=lambda *args: None,
    )
    names = [item.name for item in plan.tools]
    assert names == ["broker_delete_watchlist", "code_run"]
    assert "api.peek" in plan.instruction


def test_error_envelopes_vs_results_with_warnings():
    from app.agent_harness.code_mode import is_error_result, shape

    assert is_error_result({"ok": False, "code": "repeated_tool", "message": "stop", "retry": False})
    assert is_error_result({"error": True, "status_code": 404, "message": "none"})
    assert is_error_result({"isError": True, "content": []})
    warned = {"ok": False, "code": "source_timestamp_in_future", "message": "not verified", "summary": {"a": "b"}}
    assert not is_error_result(warned)
    assert not is_error_result({"ok": False, "error": "boom", "data": [1]})
    assert is_error_result({"ok": False, "empty": True, "retry": False, "hint": "try TMCV"})
    assert is_error_result({"error": True, "message": "bad args", "workspace_saved": True})
    assert is_error_result({"ok": False, "code": "x", "message": "m", "symbol": "TATAMOTORS"})
    assert not is_error_result(
        {"ok": False, "code": "source_timestamp_in_future", "summary": {"text": "x"}, "date": "2026-11-05"}
    )
    assert not is_error_result([1, 2])
    assert shape({"a": [{"b": 1.5}], "c": None, "d": True}) == "{'a': [{'b': float}, ...], 'c': None, 'd': bool}"


@pytest.mark.asyncio
async def test_warning_payload_reaches_guest_and_shapes_are_recorded(monkeypatch):
    from app.agent_harness import code_mode

    recorded = {}
    monkeypatch.setattr(code_mode, "remember_shape", lambda name, value: recorded.setdefault(name, value))
    payload = {"ok": False, "code": "source_timestamp_in_future", "summary": {"text": "x"}}

    async def invoke(ctx, args):
        return json.dumps(payload)

    async def emit(kind, data):
        return None

    reply = await CodeRegistry([tool("get_daily_summary", invoke=invoke)], emit).dispatch(
        None, {"id": 1, "calls": [{"name": "get_daily_summary", "args": {}}]}, [], "p"
    )
    assert reply["results"][0] == {"ok": True, "value": payload}
    assert recorded["get_daily_summary"] == payload


def test_signature_shows_learned_return_shape():
    line = signature(tool("get_news"), "{'data': [...]}")
    assert "-> {'data': [...]}" in line


@pytest.mark.asyncio
async def test_list_results_are_recorded_as_evidence_envelopes():
    async def invoke(ctx, args):
        return json.dumps([{"title": "a"}])

    events = []

    async def emit(kind, data):
        events.append((kind, data))

    reply = await CodeRegistry([tool("search_news", invoke=invoke)], emit).dispatch(
        None, {"id": 1, "calls": [{"name": "search_news", "args": {}}]}, [], "p"
    )
    assert reply["results"][0]["value"] == [{"title": "a"}]
    completed = [data for kind, data in events if kind == "tool_call_completed"][0]
    assert completed["output"] == {
        "ok": True,
        "data": [{"title": "a"}],
        "count": 1,
        "original_result_type": "list",
    }


class _FakeRedis:
    def __init__(self):
        self.values = {}
        self.calls = []

    def set(self, key, value, ex=None, nx=False):
        self.calls.append(("set", key, value, ex, nx))
        if nx and key in self.values:
            return None
        self.values[key] = value.encode() if isinstance(value, str) else value
        return True

    def mget(self, keys):
        self.calls.append(("mget", list(keys)))
        return [self.values.get(key) for key in keys]


def test_remember_shape_set_nx_ttl_and_learned_shapes_mget(monkeypatch):
    from app.agent_harness import code_mode

    fake = _FakeRedis()
    monkeypatch.setattr(code_mode, "_redis", lambda: fake)
    first = {"a": [1], "b": "secret-value"}
    code_mode.remember_shape("get_news", first)
    code_mode.remember_shape("get_news", {"changed": True})
    code_mode.remember_shape("bad", {"ok": False, "code": "repeated_tool", "message": "stop"})
    key = "ananta:code_mode:shape:get_news"
    assert fake.calls[0] == ("set", key, code_mode.shape(first), 14 * 86400, True)
    assert fake.calls[1][1:] == (key, code_mode.shape({"changed": True}), 14 * 86400, True)
    assert key in fake.values and "ananta:code_mode:shape:bad" not in fake.values
    assert b"secret-value" not in fake.values[key]
    shapes = code_mode.learned_shapes(["get_news", "missing"])
    assert shapes == {"get_news": code_mode.shape(first)}
    assert fake.calls[-1] == ("mget", ["ananta:code_mode:shape:get_news", "ananta:code_mode:shape:missing"])

    wide = {f"key{i:03d}": {f"nested{j:03d}": j for j in range(15)} for i in range(20)}
    assert len(code_mode.shape(wide)) > 600
    code_mode.remember_shape("broker_get_historical", wide)
    code_mode.remember_shape("client_connector_positions", {"RELIANCE": {"qty": 1}})
    stored = fake.values["ananta:code_mode:shape:broker_get_historical"]
    assert "ananta:code_mode:shape:client_connector_positions" not in fake.values
    assert stored.endswith(b"...") and len(stored) == 603


def test_shape_memory_degrades_without_redis(monkeypatch):
    from app.agent_harness import code_mode
    from app.agent_harness.code_mode import learned_shapes, remember_shape

    remember_shape("get_news", {"a": 1})
    assert learned_shapes(["get_news"]) == {}

    class Boom:
        def mget(self, keys):
            raise RuntimeError("down")

        def set(self, *args, **kwargs):
            raise RuntimeError("down")

    monkeypatch.setattr(code_mode, "_redis", lambda: Boom())
    remember_shape("get_news", {"a": 1})
    assert learned_shapes(["get_news"]) == {}
    monkeypatch.setattr(code_mode, "_redis", lambda: None)
    remember_shape("get_news", {"a": 1})
    assert learned_shapes([]) == {}


def _capture_api(tools):
    sent = []
    source = generate_api(tools).replace(
        "def _rpc(calls, return_exceptions=False):",
        "def _rpc(calls, return_exceptions=False):\n    _sent.append(calls); return [None]*len(calls)\ndef _unused(calls, return_exceptions=False):",
        1,
    )
    namespace = {"_sent": sent}
    exec(source, namespace)
    return namespace, sent


def test_nested_query_object_is_flattened_to_keywords():
    schema = {
        "$defs": {
            "Q": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}],
                        "default": None,
                    },
                    "from": {"type": "string"},
                },
            }
        },
        "properties": {"query": {"anyOf": [{"$ref": "#/$defs/Q"}, {"type": "null"}], "default": None}},
    }
    news = tool("get_news", schema)
    assert signature(news).startswith("api.get_news(symbols: Union[List[str], None] = None, from_: str = None)")
    namespace, sent = _capture_api([news])
    namespace["get_news"](symbols=["TCS"], from_="2026-11-01")
    namespace["get_news"](query={"symbols": "INFY"})
    namespace["parallel"]([("get_news", {"symbols": ["A"]})])
    assert sent[0][0]["args"] == {"query": {"symbols": ["TCS"], "from": "2026-11-01"}}
    assert sent[1][0]["args"] == {"query": {"symbols": "INFY"}}
    assert sent[2][0]["args"] == {"query": {"symbols": ["A"]}}
    assert "_builders" in namespace and "get_news" in namespace["_builders"]

    direct = tool(
        "get_body",
        {
            "properties": {
                "body": {
                    "type": "object",
                    "properties": {"symbol": {"type": "string"}},
                    "required": ["symbol"],
                }
            },
            "required": ["body"],
        },
    )
    assert signature(direct).startswith("api.get_body(symbol: str)")
    direct_ns, direct_sent = _capture_api([direct])
    direct_ns["get_body"](symbol="TCS")
    direct_ns["get_body"](body={"symbol": "INFY"})
    direct_ns["parallel"]([("get_body", {"symbol": "A"})])
    assert direct_sent[0][0]["args"] == {"body": {"symbol": "TCS"}}
    assert direct_sent[1][0]["args"] == {"body": {"symbol": "INFY"}}
    assert direct_sent[2][0]["args"] == {"body": {"symbol": "A"}}
    with pytest.raises(TypeError, match="symbol"):
        direct_ns["get_body"]()

    optional = tool(
        "get_optional",
        {"properties": {"body": {"type": "object", "properties": {"symbol": {"type": "string"}}}}},
    )
    optional_ns, optional_sent = _capture_api([optional])
    optional_ns["get_optional"](body={"symbol": "INFY"})
    optional_ns["parallel"]([("get_optional", {"body": {"symbol": "A"}})])
    assert optional_sent[0][0]["args"] == {"body": {"symbol": "INFY"}}
    assert optional_sent[1][0]["args"] == {"body": {"symbol": "A"}}


def test_flat_tools_and_keyword_params_keep_their_names():
    quotes = tool(
        "broker_get_quotes",
        {"properties": {"symbol": {"type": "string"}, "from": {"type": "string"}}},
    )
    assert "from_" in signature(quotes)
    namespace, sent = _capture_api([quotes])
    namespace["broker_get_quotes"](symbol="TCS", from_="x")
    namespace["parallel"]([("broker_get_quotes", {"symbol": "INFY", "from_": "y"})])
    assert sent[0][0]["args"] == {"symbol": "TCS", "from": "x"}
    assert sent[1][0]["args"] == {"symbol": "INFY", "from": "y"}


def test_shapes_never_copy_dynamic_keys():
    from app.agent_harness.code_mode import shape

    assert shape({"customer-private-identifier": {"qty": 1}}) == "{str: {'qty': int}, ...}"
    assert shape({"RELIANCE": [1.0], "TCS": [2.0]}) == "{str: [float, ...], ...}"
    assert shape({"symbol": "TCS", "ltp": 1.0}) == "{'symbol': str, 'ltp': float}"


def test_unknown_mcp_tools_with_read_like_names_stay_direct():
    picked = api_tools(
        [tool("get_secret_admin_reset"), tool("list_earnings"), tool("nse_cm__quote"), tool("nse_bhavcopy__quote")],
        mcp_names=["get_secret_admin_reset", "nse_cm__quote", "nse_bhavcopy__quote"],
    )
    names = {item.name for item in picked}
    assert "get_secret_admin_reset" not in names
    assert "nse_bhavcopy__other" not in names
    assert {"list_earnings", "nse_cm__quote", "nse_bhavcopy__quote"} <= names
    assert [item.name for item in api_tools([tool("nse_cm__quote")], mcp_names=[])] == []


@pytest.mark.asyncio
async def test_unauthorized_names_are_not_served_from_anywhere():
    calls = []

    async def invoke(ctx, args):
        calls.append(args)
        return json.dumps({"ok": True, "v": len(calls)})

    async def emit(kind, data):
        return None

    registry = CodeRegistry([tool(invoke=invoke)], emit)
    frame = {"id": 1, "calls": [{"name": "broker_get_quotes", "args": {"symbol": "A"}}]}
    await registry.dispatch(None, frame, [], "p")
    await registry.dispatch(None, frame, [], "p")
    assert len(calls) == 2
    denied = await registry.dispatch(None, {"id": 2, "calls": [{"name": "delete_all", "args": {}}]}, [], "p")
    assert denied["results"][0]["ok"] is False
    assert "secret" not in denied["results"][0]["error"]


def test_parallel_can_keep_partial_results(monkeypatch, capsys):
    import io
    import sys

    namespace = {}
    exec(generate_api([tool("get_news"), tool("get_events")]), namespace)
    reply = json.dumps({"id": 1, "results": [{"ok": True, "value": [1]}, {"ok": False, "error": "boom"}]}) + "\n"
    monkeypatch.setattr(sys, "stdin", io.StringIO(reply))
    out = namespace["parallel"]([("get_news", {}), ("get_events", {})], return_exceptions=True)
    assert out[0] == [1] and isinstance(out[1], namespace["ApiError"]) and "get_events" in str(out[1])
    monkeypatch.setattr(sys, "stdin", io.StringIO(reply.replace('"id": 1', '"id": 2')))
    with pytest.raises(namespace["ApiError"], match="get_events: boom"):
        namespace["parallel"]([("get_news", {}), ("get_events", {})])
    assert "@@ANANTA_RPC " in capsys.readouterr().out


def test_budget_stops_are_errors():
    from app.agent_harness.code_mode import is_error_result

    assert is_error_result({"ok": True, "stopped": True, "reason": "budget_exhausted", "used": 6, "limit": 6})


def test_shapes_are_learned_only_for_public_market_tools(monkeypatch):
    from app.agent_harness import code_mode

    stored = {}

    class FakeRedis:
        def set(self, key, value, ex=None, nx=False):
            stored.setdefault(key, value)

    monkeypatch.setattr(code_mode, "_redis", lambda: FakeRedis())
    private = {"accounts": {"acme_private_fund": {"quantity": 1}}}
    code_mode.remember_shape("broker_get_portfolio", private)
    code_mode.remember_shape("broker_list_accounts", {"rahul_sharma": {"id": 1}})
    code_mode.remember_shape("broker_get_watchlist_symbols", {"my_watchlist": ["TCS"]})
    code_mode.remember_shape("deriv_get_book_risk", {"book": {"client_book": 1}})
    code_mode.remember_shape("broker_get_quotes", {"symbol": "TCS", "ltp": 1.0})
    code_mode.remember_shape("get_news", {"title": "results"})
    code_mode.remember_shape("nse_cm__quote", {"symbol": "TCS", "ltp": 1})
    assert "acme_private_fund" in code_mode.shape(private)
    assert list(stored) == [
        "ananta:code_mode:shape:broker_get_quotes",
        "ananta:code_mode:shape:get_news",
        "ananta:code_mode:shape:nse_cm__quote",
    ]


def test_explicit_wrapper_works_when_nested_fields_are_required():
    schema = {
        "properties": {
            "query": {
                "type": "object",
                "properties": {"symbol": {"type": "string"}},
                "required": ["symbol"],
            }
        }
    }
    namespace, sent = _capture_api([tool("get_news", schema)])
    namespace["get_news"](query={"symbol": "TCS"})
    namespace["get_news"](symbol="INFY")
    assert sent[0][0]["args"] == {"query": {"symbol": "TCS"}}
    assert sent[1][0]["args"] == {"query": {"symbol": "INFY"}}
    with pytest.raises(TypeError, match="symbol"):
        namespace["get_news"]()


@pytest.mark.asyncio
async def test_cancellation_fills_ledger_and_emits_completion():
    started = asyncio.Event()

    async def invoke(ctx, args):
        started.set()
        await asyncio.Event().wait()

    events = []

    async def emit(kind, data):
        events.append((kind, data))

    registry = CodeRegistry([tool(invoke=invoke)], emit)
    ledger = []
    task = asyncio.create_task(
        registry.dispatch(
            None,
            {"id": 1, "calls": [{"name": "broker_get_quotes", "args": {"symbol": "TCS"}}]},
            ledger,
            "p",
        )
    )
    await asyncio.wait_for(started.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert ledger and ledger[0].get("ok") is False and ledger[0].get("name") == "broker_get_quotes"
    completed = [data for kind, data in events if kind == "tool_call_completed"]
    assert completed and completed[0]["ok"] is False
    assert completed[0]["output"]["error"] == "cancelled"


@pytest.mark.asyncio
async def test_budget_stop_dispatch_is_an_error():
    async def invoke(ctx, args):
        return json.dumps({"ok": True, "stopped": True, "reason": "budget_exhausted", "used": 6, "limit": 6})

    async def emit(kind, data):
        return None

    reply = await CodeRegistry([tool("web_fetch", invoke=invoke)], emit).dispatch(
        None, {"id": 1, "calls": [{"name": "web_fetch", "args": {}}]}, [], "p"
    )
    assert reply["results"][0]["ok"] is False
    assert "budget_exhausted" in reply["results"][0]["error"]


@pytest.mark.asyncio
async def test_code_run_bad_timeout_and_missing_exit_code_return_json(monkeypatch):
    from app.agent_tools import code_mode_tools

    seen = {}

    async def fake_bridge(**kwargs):
        seen["timeout"] = kwargs["timeout_seconds"]
        seen["code"] = kwargs["code"]
        return {"stdout": "hi"}

    monkeypatch.setattr(code_mode_tools, "run_bridge", fake_bridge)
    executor = code_mode_tools.make_code_run([tool()], user_id="u", session_key="s", emit=lambda *a: None)
    for raw in ("30s", None, {"bad": 1}):
        payload = json.loads(await executor.on_invoke_tool(SimpleNamespace(tool_call_id="t"), json.dumps({"code": "print(1)", "timeout_seconds": raw})))
        assert seen["timeout"] == 60
        assert payload["exit_code"] == 1
        assert payload["stdout"] == "hi"
        assert payload["ok"] is False

    async def explode(**kwargs):
        raise RuntimeError("bridge down")

    monkeypatch.setattr(code_mode_tools, "run_bridge", explode)
    payload = json.loads(await executor.on_invoke_tool(None, "not-json"))
    assert payload["ok"] is False and payload["exit_code"] == 1 and "bridge down" not in payload["stderr"]
    payload = json.loads(await executor.on_invoke_tool(None, json.dumps({"code": "print(1)"})))
    assert "bridge down" in payload["stderr"] and payload["exit_code"] == 1


@pytest.mark.parametrize(
    "value",
    [
        {"error": "Not found"},
        {"error": {"code": 500}},
        {"detail": "Not Found"},
        {"ok": False, "error": "limited", "data": []},
        {"ok": False, "data": {}},
        {"ok": True, "stopped": True},
    ],
)
def test_error_envelopes_are_not_shapes(monkeypatch, value):
    from app.agent_harness import code_mode

    assert code_mode.is_error_result(value)
    monkeypatch.setattr(code_mode, "_redis", lambda: pytest.fail("must not learn errors"))
    code_mode.remember_shape("broker_get_quotes", value)


def test_warned_data_never_learns_shape(monkeypatch):
    from app.agent_harness import code_mode

    value = {"ok": False, "error": "stale", "data": [{"price": 12}]}
    assert not code_mode.is_error_result(value)
    monkeypatch.setattr(code_mode, "_redis", lambda: pytest.fail("warned data must not publish a shape"))
    code_mode.remember_shape("broker_get_quotes", value)


@pytest.mark.parametrize(
    "code,expected",
    [
        ("print('2026 https://x/123')", False),
        ("print(api.get_news())", False),
        ("x=2; print(x+1)", True),
        ("print(sum(values))", True),
        ("print(len(rows))", True),
        ("print(42)", False),
    ],
)
def test_computation_evidence_requires_ast_and_numeric_output(code, expected):
    from app.agent_harness.evidence import _code_run_computed

    record = {
        "tool_name": "code_run",
        "ok": True,
        "output": {"stdout": "2026"},
        "arguments": {"code": code},
    }
    assert _code_run_computed(record) is expected


@pytest.mark.asyncio
async def test_runner_cancellation_propagates_after_completion():
    from app.services.broker_chat_runner import BrokerChatCancelled

    events = []

    async def invoke(ctx, args):
        raise BrokerChatCancelled()

    async def emit(kind, data):
        events.append((kind, data))

    registry = CodeRegistry([tool(invoke=invoke)], emit)
    ledger = []
    with pytest.raises(BrokerChatCancelled):
        await registry.dispatch(None, {"id": 1, "calls": [{"name": "broker_get_quotes", "args": {}}]}, ledger, "p")
    assert ledger and ledger[0]["ok"] is False
    completed = [data for kind, data in events if kind == "tool_call_completed"]
    assert completed and completed[-1]["ok"] is False
    assert completed[-1]["error"] == "cancelled"


@pytest.mark.asyncio
async def test_code_run_lets_runner_cancellation_propagate(monkeypatch):
    from app.agent_tools import code_mode_tools
    from app.services.broker_chat_runner import BrokerChatCancelled

    async def invoke(ctx, args):
        raise BrokerChatCancelled("stop")

    events = []

    async def emit(kind, data):
        events.append(data)

    async def bridge(**kwargs):
        return await kwargs["rpc"]({"id": 1, "calls": [{"name": "broker_get_quotes", "args": {}}]})

    monkeypatch.setattr(code_mode_tools, "run_bridge", bridge)
    executor = code_mode_tools.make_code_run([tool(invoke=invoke)], user_id="u", session_key="s", emit=emit)
    with pytest.raises(BrokerChatCancelled):
        await executor.on_invoke_tool(None, '{"code":"pass"}')
    assert events[-1]["ok"] is False
    assert events[-1]["error"] == "cancelled"



def test_empty_results_are_data_unless_ok_false():
    from app.agent_harness.code_mode import is_error_result
    assert not is_error_result({'data': [], 'has_next': False, 'ok': True, 'empty': True, 'hint': 'no rows'})
    assert is_error_result({'ok': False, 'empty': True, 'retry': False, 'message': 'empty response', 'hint': 'x'})


def test_hybrid_keeps_document_tools_direct_and_other_reads_inside_code_run():
    from app.agent_harness.code_mode import strategy_instructions

    quotes, filings, concalls, control, executor = (
        tool("broker_get_quotes"),
        tool("get_earnings_filing"),
        tool("get_concalls"),
        tool("ask_user"),
        tool("code_run"),
    )
    reads = [quotes, filings, concalls]
    attached = [quotes, control]
    inventory = catalog_inventory([quotes, filings, concalls, control], attached, executor, reads, hybrid=True)
    assert [item.name for item in attached] == ["ask_user", "get_earnings_filing", "get_concalls", "code_run"]
    # OSS has no capability_load, so a non-document read stays out of the catalog.
    assert {item.name for item in inventory} == {"get_earnings_filing", "get_concalls", "ask_user", "code_run"}
    text = strategy_instructions(True)
    assert "Hybrid tool mode" in text
    assert "NOT direct tools" not in text
    assert "capability_load" not in text
    assert "already attached" in text
    assert "NOT direct tools" in strategy_instructions(False)
    assert "always read live" in strategy_instructions(False)


@pytest.mark.asyncio
async def test_hybrid_code_run_failure_suggests_direct_tools(monkeypatch):
    from app.agent_tools import code_mode_tools

    async def bridge(**kwargs):
        await kwargs["rpc"]({"id": 1, "calls": [{"name": "list_earnings", "args": {}}]})
        return {"stdout": "", "stderr": "Traceback", "exit_code": 1}

    monkeypatch.setattr(code_mode_tools, "run_bridge", bridge)

    async def invoke(ctx, args):
        return json.dumps({"ok": False, "code": "x", "message": "bad"})

    async def emit(kind, data):
        pass

    executor = code_mode_tools.make_code_run(
        [tool("list_earnings", invoke=invoke)],
        user_id="u",
        session_key="s",
        emit=emit,
        direct_fallback=True,
    )
    out = json.loads(await executor.on_invoke_tool(SimpleNamespace(tool_call_id="c1"), json.dumps({"code": "x"})))
    assert "list_earnings" in out["fallback"]
    assert "capability_load" not in out["fallback"]
    plain = code_mode_tools.make_code_run(
        [tool("list_earnings", invoke=invoke)], user_id="u", session_key="s", emit=emit,
    )
    out = json.loads(await plain.on_invoke_tool(SimpleNamespace(tool_call_id="c2"), json.dumps({"code": "x"})))
    assert "fallback" not in out


@pytest.mark.asyncio
async def test_hybrid_plan_keeps_only_document_tools_direct(monkeypatch):
    monkeypatch.setenv("CHAT_TOOL_MODE", "direct")
    monkeypatch.setenv("CHAT_TOOL_MODE_ALLOW_METADATA_OVERRIDE", "true")
    get_settings.cache_clear()

    async def ready():
        return True, ""

    monkeypatch.setattr("app.services.broker_chat_code_mode.sandbox_status", ready)
    quote = tool()
    news = tool("search_news", description="News search")
    filings = tool("get_earnings_filing", description="Filing")
    movers = tool("get_top_movers", description="Movers")
    mutation = tool("broker_delete_watchlist")
    handle = SimpleNamespace(
        active_servers=[],
        extra_tools=[news, filings, movers],
        flattened_tool_names=["search_news", "get_earnings_filing", "get_top_movers"],
        enabled=True,
    )
    plan = await prepare_broker_chat_tools(
        metadata={"chat_tool_mode": "hybrid"},
        local_tools=[quote, mutation],
        mcp_handle=handle,
        user_id="u",
        session_key="s",
        emit=lambda *args: None,
    )
    names = [item.name for item in plan.tools]
    assert plan.mode == "hybrid"
    assert plan.mcp_servers == []
    assert "broker_get_quotes" not in names
    assert "get_top_movers" not in names
    assert "search_news" in names
    assert "get_earnings_filing" in names
    assert "broker_delete_watchlist" in names
    assert names[-1] == "code_run"
    assert set(plan.api_names) >= {"broker_get_quotes", "search_news", "get_earnings_filing", "get_top_movers"}
    assert "Hybrid tool mode" in plan.instruction
    assert "capability_load" not in plan.instruction
    assert "NOT direct tools" not in plan.instruction


@pytest.mark.asyncio
async def test_results_with_datetimes_and_nan_reach_the_guest():
    from datetime import datetime
    from app.agent_harness.code_mode import CodeRegistry
    async def invoke(ctx, args): return {"ok": True, "ltp": float("nan"), "at": datetime(2026, 11, 6, 9, 15)}
    async def emit(kind, data): pass
    tool = SimpleNamespace(name="broker_get_quotes", description="q", params_json_schema={"properties": {}}, on_invoke_tool=invoke)
    reply = await CodeRegistry([tool], emit).dispatch(None, {"id": 1, "calls": [{"name": "broker_get_quotes", "args": {}}]}, [], "p")
    assert reply["results"][0]["value"] == {"ok": True, "ltp": None, "at": "2026-11-06 09:15:00"}


def test_chat_tool_mode_defaults_to_auto(monkeypatch):
    monkeypatch.delenv("CHAT_TOOL_MODE", raising=False)
    get_settings.cache_clear()
    assert get_settings().chat_tool_mode == "auto"
    assert requested_tool_mode({}) == "auto"
    assert requested_tool_mode({"chat_tool_mode": "direct"}) == "auto"


@pytest.mark.parametrize("message,route,expected,reason", [
    ("Compare the latest quarterly results of TCS, Infosys and Wipro.", "market_read", "code_mode", "data_read"),
    ("What is the latest news on Reliance Industries?", "market_read", "code_mode", "data_read"),
    ("What is the current NIFTY option chain put-call ratio and the highest open interest strikes?", "market_read", "direct", "derivatives"),
    ("In two short paragraphs, explain what the put-call ratio means. No market data is needed.", "market_read", "direct", "derivatives"),
    # OSS has no browser_read / workspace_editor / artifact_builder routes, so a route name does not force direct.
    ("hi there", "browser_read", "code_mode", "data_read"),
    ("For Titan, Trent and Page Industries give the 52-week high and low.", "simple_chat", "code_mode", "data_read"),
    ("In two short paragraphs, explain what operating leverage means. No market data is needed.", None, "direct", "conceptual"),
])
def test_auto_strategy_routes_by_request(message, route, expected, reason):
    from app.agent_harness.code_mode import auto_strategy
    assert auto_strategy(message, route) == (expected, reason)


def test_auto_code_mode_instructions_explain_a_repeated_failure():
    from app.agent_harness.code_mode import strategy_instructions
    text = strategy_instructions("auto")
    assert "fails twice" in text and "explain what failed" in text
    assert "capability_load" not in text
    assert "NOT direct tools" in text


def test_earnings_rows_name_is_reserved():
    assert [item.name for item in api_tools([tool("earnings_rows")])] == []


def test_earnings_rows_flattens_real_earnings_structure():
    ns = {}
    exec(generate_api([tool()]), ns)
    result = {"data": [{"id": "e1", "symbol": "LT", "company_name": "Larsen", "quarter": "q2_27", "date": "2026-10-30",
        "earnings_table": {"consolidated": {"current_period_label": "Q2FY27",
            "pat": {"unit": "Crore", "current_period_value": 5949.15, "previous_year_value": 4678.01,
                    "yoy_percent": 27.17, "qoq_percent": 19.27}},
            "standalone": {"current_period_label": "Q2FY27", "revenue": {"unit": "Crore", "current_period_value": 1}},
            "reporting_period_basis": "financial_year"}}]}
    rows = ns["earnings_rows"](result)
    assert rows[0] == {"symbol": "LT", "company": "Larsen", "quarter": "Q2FY27", "date": "2026-10-30", "scope": "consolidated",
                       "metric": "pat", "value": 5949.15, "current_period_value": 5949.15, "unit": "Crore",
                       "previous_year_value": 4678.01, "yoy_percent": 27.17, "qoq_percent": 19.27,
                       "value_cr": 5949.15, "previous_year_value_cr": 4678.01, "source_id": "e1"}
    assert {(r["scope"], r["metric"]) for r in rows} == {("consolidated", "pat"), ("standalone", "revenue")}
    assert ns["earnings_rows"](result["data"][0])[0]["metric"] == "pat"


@pytest.mark.asyncio
async def test_ledger_carries_receipt_ids_for_successful_calls():
    async def invoke(ctx, args):
        return json.dumps({"ok": True})

    async def emit(kind, data):
        return "e" * 36 if kind == "tool_call_completed" else None

    ledger = []
    await CodeRegistry([tool(invoke=invoke)], emit).dispatch(
        None, {"id": 1, "calls": [{"name": "broker_get_quotes", "args": {}}]}, ledger, "p",
    )
    assert ledger[0]["receipt_id"] == "e" * 36


def test_earnings_rows_keeps_latest_filing_and_converts_to_crore():
    ns = {}
    exec(generate_api([tool()]), ns)

    def rec(date, value, unit):
        return {"symbol": "MMFL", "date": date, "earnings_table": {"consolidated": {"current_period_label": "Q",
                "pat": {"unit": unit, "current_period_value": value, "previous_year_value": value / 2}}}}

    rows = ns["earnings_rows"]({"data": [rec("2026-08-01", 1.0, "Rs in Lakhs"), rec("2026-11-05", 4174.56, "Rs. in Lakhs")]})
    assert len(rows) == 1 and rows[0]["value_cr"] == 41.75 and rows[0]["previous_year_value_cr"] == 20.87
    assert ns["earnings_rows"]({"data": [rec("2026-11-05", 517.18, "Rs. in Million")]})[0]["value_cr"] == 51.72
    assert len(ns["earnings_rows"]({"data": [rec("2026-08-01", 1.0, "crore"), rec("2026-11-05", 2.0, "crore")]}, latest=False)) == 2
    eps = {"symbol": "MMFL", "date": "2026-11-05", "earnings_table": {"consolidated": {
        "eps": {"unit": "Rs", "current_period_value": 12.5, "previous_year_value": 10}}}}
    assert ns["earnings_rows"]({"data": [eps]}, metrics=("eps",))[0]["value_cr"] is None
    assert ns["earnings_rows"]({"data": [rec("2026-11-05", 10, "USD million")]})[0]["value_cr"] is None


def test_earnings_rows_call_counts_as_computation():
    from app.agent_harness.code_computation import contains_computation
    assert contains_computation({"code": 'from ananta import api\nfor r in api.earnings_rows(api.list_earnings(symbols="X")):\n    print(r.get("value_cr"))'})
    assert not contains_computation({"code": 'print("hello")'})


@pytest.mark.asyncio
async def test_auto_plan_uses_code_mode_for_data_and_direct_for_derivatives(monkeypatch):
    monkeypatch.setenv("CHAT_TOOL_MODE", "auto")
    monkeypatch.setenv("CHAT_TOOL_MODE_ALLOW_METADATA_OVERRIDE", "false")
    get_settings.cache_clear()

    async def ready():
        return True, ""

    monkeypatch.setattr("app.services.broker_chat_code_mode.sandbox_status", ready)
    quote = tool()
    mutation = tool("broker_delete_watchlist")
    handle = SimpleNamespace(active_servers=[], extra_tools=[], flattened_tool_names=[], enabled=False)
    plan = await prepare_broker_chat_tools(
        metadata={"chat_tool_mode": "direct"},
        local_tools=[quote, mutation],
        mcp_handle=handle,
        user_id="u",
        session_key="s",
        emit=lambda *args: None,
        message="Compare the latest quarterly results of TCS, Infosys and Wipro.",
    )
    names = [item.name for item in plan.tools]
    assert plan.mode == "code_mode"
    assert plan.strategy == {"strategy": "code_mode", "reason": "data_read"}
    assert names[-1] == "code_run"
    assert "broker_get_quotes" not in names
    assert "broker_delete_watchlist" in names
    assert "fails twice" in plan.instruction and "explain what failed" in plan.instruction
    assert "capability_load" not in plan.instruction

    deriv = await prepare_broker_chat_tools(
        metadata={},
        local_tools=[quote, mutation],
        mcp_handle=handle,
        user_id="u",
        session_key="s",
        emit=lambda *args: None,
        message="What is the current NIFTY option chain put-call ratio and the highest open interest strikes?",
    )
    assert deriv.mode == "direct"
    assert deriv.strategy == {"strategy": "direct", "reason": "derivatives"}
    assert deriv.event is None
    assert [item.name for item in deriv.tools] == ["broker_get_quotes", "broker_delete_watchlist"]


@pytest.mark.asyncio
async def test_auto_code_mode_falls_back_when_sandbox_is_missing(monkeypatch):
    monkeypatch.setenv("CHAT_TOOL_MODE", "auto")
    get_settings.cache_clear()

    async def missing():
        return False, "socket_missing"

    monkeypatch.setattr("app.services.broker_chat_code_mode.sandbox_status", missing)
    plan = await prepare_broker_chat_tools(
        metadata={},
        local_tools=[tool(), tool("broker_delete_watchlist")],
        mcp_handle=SimpleNamespace(active_servers=[], extra_tools=[], flattened_tool_names=[], enabled=False),
        user_id="u",
        session_key="s",
        emit=None,
        message="What is the latest news on Reliance Industries?",
    )
    assert plan.mode == "direct"
    assert plan.event == {"fallback": "direct", "reason": "socket_missing"}
    assert plan.strategy == {"strategy": "code_mode", "reason": "data_read"}
    assert [item.name for item in plan.tools] == ["broker_get_quotes", "broker_delete_watchlist"]
