"""Factory: code_run captures only this run's final authorized tool wrappers."""
from uuid import uuid4
from agents import FunctionTool
from app.agent_harness.code_mode import CodeRegistry, generate_api, signature, learned_shapes
from app.execution_planes.code_sandbox_client import run_bridge


def make_code_run(tools, *, user_id, session_key, emit):
    registry = CodeRegistry(tools, emit)
    library = generate_api(tools)
    shapes = learned_shapes(t.name for t in tools)
    index = '\n'.join(signature(t, shapes.get(t.name)) for t in tools)

    async def invoke(ctx, arguments):
        import json
        args = json.loads(arguments)
        timeout = max(1, min(120, int(args.get('timeout_seconds', 60))))
        ledger = []
        parent_id = getattr(ctx, 'tool_call_id', None) or uuid4().hex
        async def rpc(frame):
            return await registry.dispatch(ctx, frame, ledger, parent_id)
        try:
            result = await run_bridge(user_id=user_id, session_key=session_key,
                code=args['code'], api_source=library, timeout_seconds=timeout, rpc=rpc)
        except Exception as exc:
            result = {'stdout': '', 'stderr': str(exc)[:8000], 'exit_code': 1}
        stdout = result.get('stdout', '') or ''
        payload = {'ok': result['exit_code'] == 0, 'stdout': stdout[:8000],
            'stderr': (result.get('stderr', '') or '')[:8000], 'exit_code': result['exit_code'], 'calls': ledger}
        if len(stdout) > 8000 or result.get('truncated'):
            payload['stdout_truncated'] = True
            payload['note'] = ('Output was cut at 8000 characters. Aggregate or select fields in the script '
                               'and print a compact table instead of raw results.')
        return json.dumps(payload)

    executor = FunctionTool(name='code_run', description=(
        'Run Python (stdlib) in the no-network sandbox with `from ananta import api`. The API below reads '
        'market, news, filings, quotes, portfolio, watchlists, instruments and web data. Calls return '
        'parsed JSON (dict/list). api.parallel([(name, kwargs), ...]) runs up to 8 independent reads at once '
        '(40 calls per script; pass return_exceptions=True to keep partial results). api.peek(value) shows a result\'s structure, api.describe(name) its full schema. '
        'Only printed output returns to you: compute in the script and print compact results with source, '
        'URL and date fields for citation. Failed calls raise api.ApiError. "-> {...}" shows a result shape '
        'seen earlier; keys may vary.\n\nExample:\n'
        'from ananta import api\n'
        'news, movers = api.parallel([("search_news", {"queries": ["TCS results"], "days": 7}),\n'
        '                             ("get_top_movers", {"top_n": 5})])\n'
        'for n in news[:3]: print(n.get("title"), n.get("published_at"), n.get("url"))\n'
        'print(api.peek(movers))\n\nAPI:\n' + index),
        params_json_schema={'type': 'object', 'properties': {'code': {'type': 'string'},
            'timeout_seconds': {'type': 'integer', 'default': 60}}, 'required': ['code'],
            'additionalProperties': False}, strict_json_schema=False, on_invoke_tool=invoke)
    # The runner calls registry.invalidate() whenever another tool completes.
    executor._ananta_code_registry = registry
    return executor
