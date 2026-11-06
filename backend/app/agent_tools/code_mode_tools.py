"""Factory: code_run captures only this run's final authorized tool wrappers."""
from uuid import uuid4
from agents import FunctionTool
from app.agent_harness.code_mode import CodeRegistry, generate_api, is_control_flow, signature, learned_shapes
from app.execution_planes.code_sandbox_client import run_bridge


def make_code_run(tools, *, user_id, session_key, emit, direct_fallback=False):
    registry = CodeRegistry(tools, emit)
    library = generate_api(tools)
    shapes = learned_shapes(t.name for t in tools)
    index = '\n'.join(signature(t, shapes.get(t.name)) for t in tools)

    async def invoke(ctx, arguments):
        import json

        def _fail(message, calls=None):
            return json.dumps({'ok': False, 'stdout': '', 'stderr': str(message)[:8000],
                               'exit_code': 1, 'calls': calls or []})

        try:
            try:
                args = json.loads(arguments) if isinstance(arguments, str) else arguments
            except (TypeError, ValueError):
                args = {}
            if not isinstance(args, dict):
                args = {}
            raw_timeout = args.get('timeout_seconds', 60)
            if raw_timeout is None:
                raw_timeout = 60
            try:
                timeout = int(raw_timeout)
            except (TypeError, ValueError):
                timeout = 60
            timeout = max(1, min(120, timeout))
            code = args.get('code')
            if not isinstance(code, str):
                return _fail('code is required')
            ledger = []
            parent_id = getattr(ctx, 'tool_call_id', None) or uuid4().hex

            async def rpc(frame):
                return await registry.dispatch(ctx, frame, ledger, parent_id)

            try:
                result = await run_bridge(user_id=user_id, session_key=session_key,
                    code=code, api_source=library, timeout_seconds=timeout, rpc=rpc)
            except Exception as exc:
                if is_control_flow(exc):
                    raise
                result = {'stdout': '', 'stderr': str(exc)[:8000], 'exit_code': 1}
            if not isinstance(result, dict):
                result = {'stdout': '', 'stderr': 'sandbox returned an invalid result', 'exit_code': 1}
            exit_code = result.get('exit_code', 1)
            try:
                exit_code = int(exit_code)
            except (TypeError, ValueError):
                exit_code = 1
            stdout = result.get('stdout', '') or ''
            if not isinstance(stdout, str):
                stdout = str(stdout)
            stderr = result.get('stderr', '') or ''
            if not isinstance(stderr, str):
                stderr = str(stderr)
            payload = {'ok': exit_code == 0, 'stdout': stdout[:8000],
                'stderr': stderr[:8000], 'exit_code': exit_code, 'calls': ledger}
            failed = sorted({c.get('name') for c in ledger if c.get('ok') is False and c.get('name')})
            if direct_fallback and (exit_code != 0 or failed):
                payload['fallback'] = (
                    'These API functions are also available as direct tools when this run attached them. '
                    'If this script keeps failing, call those attached tools directly instead of rewriting the script: '
                    + (', '.join(failed) if failed else 'the functions this script used') + '.'
                )
            if len(stdout) > 8000 or result.get('truncated'):
                payload['stdout_truncated'] = True
                payload['note'] = ('Output was cut at 8000 characters. Aggregate or select fields in the script '
                                   'and print a compact table instead of raw results.')
            return json.dumps(payload)
        except Exception as exc:
            if is_control_flow(exc):
                raise
            return _fail(exc)

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
    return executor
