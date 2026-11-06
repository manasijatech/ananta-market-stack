"""Run-scoped read API and stdlib-only guest stubs. No host code evaluation."""
from __future__ import annotations

import asyncio
from contextvars import ContextVar
import hashlib
import json
import keyword
import re
import time
from uuid import uuid4

# Inner calls cannot re-enter the bridge-held workspace lock. Context is copied
# into read offloads by their copied context, and reset per invocation.
CODE_API_ACTIVE = ContextVar('ananta_code_api_active', default=False)

CODE_MODE_API_TOOLS = frozenset({
    'broker_list_accounts', 'broker_list_watchlists', 'broker_get_watchlist_symbols',
    'broker_get_watchlist_quotes', 'broker_get_session_status', 'broker_get_data_capabilities',
    'broker_search_instruments', 'broker_get_cached_quotes', 'broker_get_quotes', 'broker_get_ohlc',
    'broker_get_historical', 'broker_get_option_chain', 'broker_get_greeks', 'broker_get_portfolio',
    'broker_get_profile', 'broker_get_stream_status', 'deriv_calc_greeks', 'deriv_calc_payoff',
    'deriv_calc_scenario', 'deriv_get_chain_snapshot', 'deriv_get_chain_metrics',
    'deriv_get_expiry_calendar', 'deriv_get_book_risk', 'deriv_get_position_greeks',
    'intel_get_feed', 'intel_list_alert_workflows', 'intel_list_alert_notifications',
    'web_search', 'web_fetch', 'resolve_symbols',
})
# Gated Drishti protocol tools stay on the host.
MCP_GATE_TOOLS = frozenset({'describe_tools', 'describe_tool', 'execute_tool', 'execute'})
# Known Drishti protocol reads shipped with OSS.
DRISHTI_READ_OPS = frozenset({
    'read_me', 'search_tools', 'get_daily_summary', 'get_news', 'get_top_movers',
    'get_price_and_volume', 'get_events', 'get_research', 'get_filings',
    'get_morning_report', 'get_evening_report',
})
# Declared Drishti data operations (OSS stand-in for the enterprise MCP_DATA_TOOL_NAMES
# set). A get_/list_/search_ prefix is not evidence of a read.
MCP_DATA_TOOL_NAMES = DRISHTI_READ_OPS | frozenset({
    'search_news', 'get_announcements', 'search_announcements', 'get_announcement_categories',
    'get_top_traded', 'get_price_and_volume_since', 'get_52w_data', 'get_symbols',
    'resolve_symbols', 'list_earnings', 'get_earnings_filing', 'get_upcoming_earnings',
    'get_concalls', 'search_concalls', 'get_upcoming_concalls', 'get_block_deals',
    'get_sectoral_data', 'get_sector_wise_companies', 'get_doc', 'search_docs',
    'get_workflow_prompt',
})
_NSE_PUBLIC_PREFIXES = ('nse_cm__', 'nse_bhavcopy__')
_NEVER_PREFIXES = ('workspace_', 'alert_', 'ask_', 'browser_', 'sandbox_', 'present_')
_RESERVED = {'list', 'search', 'describe', 'parallel', 'peek', 'ApiError'}

CODE_MODE_INSTRUCTIONS = (
    "Code Mode is active for data reads. Market, news, filings, quotes, historical prices, "
    "portfolio, watchlists, instruments, derivatives, and web search are NOT direct tools in this "
    "run. Read them by calling code_run with Python: `from ananta import api`, then call the typed "
    "functions listed in code_run's description, for example `api.get_news(symbol='RELIANCE')`. "
    "Batch independent reads with `api.parallel([...])`, filter, join and compute in the script, and "
    "print only the compact facts you need, including each source, URL and as_of/date, so you can "
    "cite them. Use `api.describe(name)` to read a full schema before calling an unfamiliar function. "
    "If a call raises ApiError, read the message and fix the arguments. "
    "Do the whole data task in ONE script where possible: fetch, filter, join, compute and format "
    "the final table in Python, then print it. Do not print raw API results; if you are unsure of a "
    "result's structure, print api.peek(result) first, which shows keys and types only. Keep results "
    "in variables and do the work in one script: Drishti calls always read live data, and repeated "
    "identical calls may be refused. Compute inside "
    "code_run. Workspace, canvas, skills, alerts, and approvals remain direct tools."
)


def strategy_instructions(hybrid):
    """Code Mode text for this run. Hybrid replaces the "not direct tools" rule."""
    if not hybrid:
        return CODE_MODE_INSTRUCTIONS
    base = CODE_MODE_INSTRUCTIONS.split("Read them by calling code_run", 1)[1]
    return HYBRID_INSTRUCTIONS + "\nWhen you use code_run: call code_run" + base


HYBRID_INSTRUCTIONS = (
    "Hybrid tool mode is active. Two ways to read data are available:\n"
    "1. code_run with `from ananta import api` for numeric and list reads across several symbols "
    "(quotes, 52-week levels, movers, price history, sector data, news for many symbols), joins, "
    "rankings and any calculation. Batch with api.parallel and print only the final compact table.\n"
    "2. The directly attached tools (earnings lists and filings, concall transcripts, announcements, "
    "news search) for reading documents and one or two items; read their text yourself.\n"
    "Other read tools stay inside code_run and are not attached directly. If a code_run fails or "
    "returns data you cannot parse, do not rewrite the same script repeatedly: call the matching "
    "direct tool when it is already attached. Prefer the direct tool for a single document lookup."
)


def select_strategy(requested, status):
    """A bridge must advertise python.bridge. OSS has no schema strategies, so the fallback is direct."""
    bridge_ready = getattr(status, 'available', False) and 'python.bridge' in getattr(status, 'capabilities', ())
    if requested in {'code_mode', 'hybrid'} and not bridge_ready:
        return 'direct'
    if requested not in {'direct', 'code_mode', 'hybrid'}:
        return 'direct'
    return requested


# Heavy, rarely needed direct tools stay off the attached list. code_run already
# covers in-sandbox computation. OSS ships no browser or sandbox tools; the
# prefixes still apply if one is attached.
DEFERRED_PREFIXES = ('browser_', 'sandbox_')

# Hybrid strategy: document and text reads stay direct tools (the model reads filings,
# transcripts and announcements well as prose, and their payloads are awkward to parse in
# code), while numeric/list reads and fan-out go through code_run. OSS has no
# capability_load, so every other read tool stays inside code_run only.
HYBRID_DIRECT_TOOLS = frozenset({
    'list_earnings', 'get_earnings_filing', 'get_concalls', 'search_concalls',
    'get_announcements', 'search_announcements', 'search_news',
})


def catalog_inventory(authorized, attached, executor, read_tools, *, hybrid=False):
    names = {t.name for t in read_tools}
    direct = HYBRID_DIRECT_TOOLS & names if hybrid else set()
    attached[:] = [t for t in attached if (t.name not in names or t.name in direct) and t.name != 'code_run'
                   and not t.name.startswith(DEFERRED_PREFIXES)]
    present = {t.name for t in attached}
    attached.extend(t for t in read_tools if t.name in direct and t.name not in present)
    attached.append(executor)
    # No capability_load: hybrid does not put the other read tools back in the catalog.
    return [t for t in authorized if (t.name not in names or t.name in direct) and t.name != 'code_run'] + [executor]


def api_tools(tools, *, mcp_names=()):
    """Read-only tools safe to call from the guest. Mutations and UI stay direct.

    Only declared Drishti data operations and the read-only NSE public sources
    (nse_cm__ / nse_bhavcopy__) join the API. Other MCP tools stay direct.
    """
    mcp = set(mcp_names)
    declared = CODE_MODE_API_TOOLS | set(MCP_DATA_TOOL_NAMES)
    selected = []
    for tool in tools:
        name = getattr(tool, 'name', '')
        if not isinstance(name, str):
            continue
        if (name in _RESERVED or name in MCP_GATE_TOOLS or name.startswith(_NEVER_PREFIXES)
                or not name.isidentifier() or keyword.iskeyword(name)
                or getattr(tool, 'needs_approval', False)
                or getattr(tool, 'tool_input_guardrails', None)
                or getattr(tool, 'tool_output_guardrails', None)):
            continue
        nse_public = name in mcp and name.startswith(_NSE_PUBLIC_PREFIXES)
        if name in declared or name.startswith('research_compare_') or nse_public:
            selected.append(tool)
    return selected


def _hint(schema):
    if not isinstance(schema, dict):
        return 'Any'
    if '$ref' in schema:
        return 'Any'
    if schema.get('enum'):
        return 'Literal[' + ', '.join(repr(v) for v in schema['enum']) + ']'
    variants = schema.get('anyOf', schema.get('oneOf'))
    if variants:
        return 'Union[' + ', '.join(_hint(s) for s in variants) + ']'
    kind = schema.get('type')
    if isinstance(kind, list):
        return 'Union[' + ', '.join(_hint({'type': t}) for t in kind) + ']'
    if kind == 'array':
        return 'List[' + _hint(schema.get('items', {})) + ']'
    return {'string': 'str', 'integer': 'int', 'number': 'float', 'boolean': 'bool',
            'object': 'Dict[str, Any]', 'null': 'None'}.get(kind, 'Any')


_GUEST = '''from __future__ import annotations
import json as _json
import sys as _sys
from typing import Any, Union, List, Dict, Literal
_counter = 0
_missing = object()
class ApiError(RuntimeError): pass
def _rpc(calls, return_exceptions=False):
    global _counter
    _counter += 1
    _sys.stdout.write('\\n' + globals().get('_RPC_PREFIX', '@@ANANTA_RPC ') + _json.dumps({'id': _counter, 'calls': calls}, allow_nan=False) + '\\n')
    _sys.stdout.flush()
    line = _sys.stdin.readline()
    if not line: raise ApiError('RPC bridge closed')
    reply = _json.loads(line)
    if reply.get('id') != _counter or len(reply.get('results', [])) != len(calls):
        raise ApiError('Invalid RPC reply')
    values = []
    for index, result in enumerate(reply['results']):
        if not result.get('ok'):
            error = ApiError(calls[index]['name'] + ': ' + str(result.get('error', 'Tool failed')))
            if not return_exceptions: raise error
            values.append(error)
        else:
            values.append(result.get('value'))
    return values
def parallel(calls, return_exceptions=False):
    """Run up to 8 independent reads at once. With return_exceptions=True a failed call
    yields its ApiError in place instead of discarding the other results."""
    return _rpc([{'name': name, 'args': _builders[name](args) if name in _builders else args} for name, args in calls],
                return_exceptions=return_exceptions)
def list(): return sorted(_schemas)
def describe(name): return _schemas.get(name, {'error': 'Unknown API function'})
def search(text):
    return {n: s for n, s in _schemas.items() if text.lower() in (n + ' ' + str(s)).lower()}
def peek(value, depth=3, _indent=''):
    """Return the structure of a result (keys, types, lengths) without its data."""
    if depth < 0:
        return '...'
    if isinstance(value, dict):
        inner = ', '.join(repr(k) + ': ' + peek(v, depth - 1) for k, v in [*value.items()][:25])
        return '{' + inner + (', ...' if len(value) > 25 else '') + '}'
    if isinstance(value, (tuple, type([]))):
        return '[' + str(len(value)) + ' x ' + (peek(value[0], depth - 1) if value else 'empty') + ']'
    if isinstance(value, str):
        return 'str'
    return type(value).__name__
'''


_SHAPE_KEY = 'ananta:code_mode:shape:'
_SHAPE_TTL = 14 * 86400
_ERROR_KEYS = frozenset({'ok', 'error', 'code', 'message', 'retry', 'user_message', 'reason', 'detail',
                         'details', 'status', 'status_code', 'unavailable', 'blocked_requirements', 'isError',
                         'hint', 'empty', 'workspace_saved', 'workspace_dir', 'workspace_paths', 'guidance',
                         'next_step', 'suggestions', 'tool', 'tool_name', 'arguments', 'note'})
_IDENTIFIER_KEY = re.compile(r'^[a-z_][a-z0-9_]{0,39}$')
# Shapes are shared across users through the tool description, so they are learned
# only from public market-data tools. Account, portfolio, watchlist, book and profile
# results can carry private names as keys and are never learned.
SHAPE_PUBLIC_TOOLS = frozenset({
    'broker_get_quotes', 'broker_get_cached_quotes', 'broker_get_ohlc', 'broker_get_historical',
    'broker_get_option_chain', 'broker_search_instruments', 'deriv_get_chain_snapshot',
    'deriv_get_chain_metrics', 'deriv_get_expiry_calendar', 'web_search', 'web_fetch', 'resolve_symbols',
})


def _shape_learnable(name):
    if not isinstance(name, str):
        return False
    if name in SHAPE_PUBLIC_TOOLS or name.startswith(('nse_cm__', 'nse_bhavcopy__')):
        return True
    return name in MCP_DATA_TOOL_NAMES


def shape(value, depth=3):
    """Host-side twin of the guest api.peek(): structure only, never data."""
    if depth < 0:
        return '...'
    if isinstance(value, dict):
        # Dynamic keys (symbols, ids, names) are data, not schema: never copy them into
        # a prompt shared with other users. Collapse such dicts to str -> value shape.
        if value and not all(isinstance(k, str) and _IDENTIFIER_KEY.match(k) for k in value):
            first = next(iter(value.values()))
            return '{str: ' + shape(first, depth - 1) + ', ...}'
        items = list(value.items())[:20]
        return '{' + ', '.join(repr(k) + ': ' + shape(v, depth - 1) for k, v in items) + (', ...' if len(value) > 20 else '') + '}'
    if isinstance(value, list):
        return '[' + (shape(value[0], depth - 1) if value else '') + ', ...]'
    if isinstance(value, bool):
        return 'bool'
    if isinstance(value, (int, float)):
        return type(value).__name__
    if value is None:
        return 'None'
    return 'str'


def _redis():
    try:
        from app.services.broker_chat_queue import redis_connection
        return redis_connection()
    except Exception:
        return None


def learned_shapes(names):
    """Result shapes recorded from earlier successful calls (shared across workers)."""
    client = _redis()
    if client is None or not names:
        return {}
    try:
        names = list(names)
        values = client.mget([_SHAPE_KEY + n for n in names])
    except Exception:
        return {}
    return {n: (v.decode() if isinstance(v, bytes) else v) for n, v in zip(names, values) if v}


def remember_shape(name, value):
    if value in ([], {}) or (isinstance(value, dict) and value.get('empty') is True):
        return  # an empty first result would pin a useless shape for every later run
    # An ok:false envelope is warned data or an error. Neither publishes a shared shape.
    if is_error_result(value) or (isinstance(value, dict) and value.get('ok') is False) or not _shape_learnable(name):
        return
    text = shape(value)
    if len(text) > 600:
        text = text[:600] + '...'
    client = _redis()
    if client is None:
        return
    try:
        # First shape wins, so the code_run description (part of the cached prompt
        # prefix) stays byte-identical across runs once a function has been seen.
        client.set(_SHAPE_KEY + name, text, ex=_SHAPE_TTL, nx=True)
    except Exception:
        pass


def is_error_result(value):
    """True only for a pure error envelope. A payload with non-empty data plus an
    ok/code warning (for example a source-freshness caveat) is a result, not an error."""
    if not isinstance(value, dict):
        return False
    if value.get('isError') is True or value.get('error') is True or value.get('stopped') is True:
        return True
    # "No rows" is an answer, not a failure: {"ok": true, "empty": true, "data": []} reaches
    # the script as data, exactly as direct mode shows it to the model. Only an empty
    # result that also says ok:false is an error (handled by the ok:false rule below).
    if value.get('empty') is True and value.get('ok') is not False:
        return False
    payload_keys = set(value) - _ERROR_KEYS
    # A non-empty string or dict error, or a detail with no data keys, is an error
    # even when the envelope omits ok:false.
    if value.get('ok') is not False and (
            (isinstance(value.get('error'), (str, dict)) and value['error'])
            or (value.get('detail') and not payload_keys)):
        return True
    if value.get('ok') is not False:
        return False
    # ok=false counts as warned data only when some payload value is non-empty.
    # A blank, empty container, or short status string does not.
    payload_keys = set(value) - _ERROR_KEYS
    return not any(bool(value[k]) and not (isinstance(value[k], str) and len(value[k]) < 400) for k in payload_keys)


def is_control_flow(exc):
    """Signals the runner must see, so code_run cannot turn them into a tool error.

    OSS cancellation is asyncio.CancelledError and BrokerChatCancelled. There is
    no steer signal, no ownership-loss error, and no MCP session-lost exception
    the runner uses to reconnect: MCP failures are returned as recoverable text.
    """
    if isinstance(exc, asyncio.CancelledError):
        return True
    from app.services.broker_chat_runner import BrokerChatCancelled
    return isinstance(exc, BrokerChatCancelled)


def signature(tool, returns=None):
    """One Python-style declaration line, like the article's TypeScript API."""
    props, required, _wrapper = _call_params(tool)
    required_params, optional_params = [], []
    for name, spec in props.items():
        hint = _hint(spec)
        if name in required:
            required_params.append(f'{_py_name(name)}: {hint}')
        else:
            default = spec.get('default', None) if isinstance(spec, dict) else None
            optional_params.append(f'{_py_name(name)}: {hint} = {default!r}')
    params = required_params + optional_params
    summary = ' '.join((tool.description or '').split())
    summary = summary.split('. ')[0][:160]
    arrow = f' -> {returns}' if returns else ''
    return f'api.{tool.name}({", ".join(params)}){arrow}  # {summary}'


def _py_name(name):
    return name + '_' if keyword.iskeyword(name) else name


def flattened_params(schema):
    """(wrapper, properties, required) for a schema whose only parameter is a nested object.

    Operations that take one object (directly, or via anyOf/$ref into $defs) are called
    with the inner fields as keywords. The builder wraps them back into {wrapper: {...}}
    before the call. Returns None when the schema is not a single object parameter.
    """
    props = (schema or {}).get('properties', {})
    if len(props) != 1:
        return None
    (wrapper, spec), = props.items()
    defs = (schema or {}).get('$defs') or (schema or {}).get('definitions') or {}
    candidates = [spec] + [v for v in (spec.get('anyOf') or spec.get('oneOf') or []) if isinstance(v, dict)]
    for candidate in candidates:
        ref = candidate.get('$ref', '')
        target = defs.get(ref.rsplit('/', 1)[-1]) if ref else candidate
        if isinstance(target, dict) and target.get('type', 'object') == 'object' and target.get('properties'):
            inner = target['properties']
            if all(isinstance(n, str) and _py_name(n).isidentifier() and not n.startswith('_') for n in inner):
                return wrapper, inner, set(target.get('required', []))
    return None


def _call_params(tool):
    """(properties, required, wrapper) as the guest API exposes them."""
    schema = tool.params_json_schema or {}
    flat = flattened_params(schema)
    if flat:
        wrapper, props, required = flat
        return props, required, wrapper
    return schema.get('properties', {}), set(schema.get('required', [])), None


def generate_api(tools):
    schemas = {t.name: {'description': t.description, 'parameters': t.params_json_schema} for t in tools}
    parts = [_GUEST, '_schemas = ' + repr(schemas), '_builders = {}']
    for tool in tools:
        props, required, wrapper = _call_params(tool)
        renames = {_py_name(n): n for n in props}
        valid = all(n.isidentifier() and not n.startswith('_') for n in renames)
        doc = tool.description + '\n' + '\n'.join(n + ': ' + str((s or {}).get('description', '')) for n, s in props.items())
        if wrapper:
            doc += f'\n(Keywords are sent as {wrapper}={{...}}; passing {wrapper}= directly also works.)'
        # One argument builder per function, shared by the typed function and api.parallel().
        builder = (f'def _b_{tool.name}(kw):\n'
                   f'    kw = dict(kw)\n'
                   f'    names = {renames!r}\n')
        if wrapper:
            required_py = sorted(_py_name(n) for n in required)
            builder += (f'    if {wrapper!r} in kw:\n        return kw\n'
                        f'    missing = [n for n in {required_py!r} if n not in kw]\n'
                        f'    if missing:\n'
                        f'        raise TypeError({tool.name!r} + "() missing required keyword(s): " + ", ".join(missing))\n'
                        f'    inner = {{names.get(k, k): v for k, v in kw.items()}}\n'
                        f'    return {{{wrapper!r}: inner}} if inner else {{}}\n')
        else:
            builder += '    return {names.get(k, k): v for k, v in kw.items()}\n'
        builder += f'_builders[{tool.name!r}] = _b_{tool.name}'
        parts.append(builder)
        if valid:
            # With a wrapper, every flattened field is optional in Python so `wrapper=`
            # alone works; the builder enforces required fields when it is not given.
            params = [f'{py}: {_hint(props[orig])}' + ('' if orig in required and not wrapper else ' = _missing')
                      for py, orig in renames.items()]
            if wrapper:
                params.append(f'{wrapper}: Any = _missing')
            params.sort(key=lambda p: '= _missing' in p)
            names = list(renames) + ([wrapper] if wrapper else [])
            body = ('    _kw = {' + ', '.join(repr(n) + ': ' + n for n in names) + '}\n'
                    f"    return _rpc([{{'name': {tool.name!r}, 'args': _builders[{tool.name!r}]({{k: v for k, v in _kw.items() if v is not _missing}})}}])[0]")
            parts.append(f'def {tool.name}({"*, " if params else ""}{", ".join(params)}):\n    {doc!r}\n{body}')
        else:
            parts.append(f'def {tool.name}(**kwargs):\n    {doc!r}\n'
                         f'    return _rpc([{{"name": {tool.name!r}, "args": _builders[{tool.name!r}](kwargs)}}])[0]')
    return '\n\n'.join(parts)


def normalize_result(value):
    """Undo cache envelopes so a repeated call returns the same shape as the first."""
    if isinstance(value, dict) and value.get('original_result_type') == 'list' and isinstance(value.get('data'), list):
        return value['data']
    return value


def bootstrap(code, library, rpc_prefix="@@ANANTA_RPC "):
    """Guest entry script. User code is registered with linecache so a traceback
    shows that code, not this bootstrap's string literals."""
    return ("import linecache, sys, traceback, types\n"
            "_p = types.ModuleType('ananta'); _p.__path__ = []\n"
            "_a = types.ModuleType('ananta.api'); _p.api = _a\n"
            "sys.modules['ananta'] = _p; sys.modules['ananta.api'] = _a\n"
            f"_a.__dict__['_RPC_PREFIX'] = {rpc_prefix!r}\n"
            f"_api_source = {library!r}\n"
            "exec(compile(_api_source, 'ananta/api.py', 'exec'), _a.__dict__)\n"
            f"_code = {code!r}\n"
            "linecache.cache['<code_run>'] = (len(_code), None, _code.splitlines(True), '<code_run>')\n"
            "try:\n"
            "    exec(compile(_code, '<code_run>', 'exec'), {'__name__': '__main__'})\n"
            "except SystemExit:\n"
            "    raise\n"
            "except BaseException as _exc:\n"
            "    _frames = [f for f in traceback.extract_tb(_exc.__traceback__) if f.filename == '<code_run>']\n"
            "    sys.stderr.write('Traceback (your code):\\n' + ''.join(traceback.format_list(_frames))\n"
            "                     + ''.join(traceback.format_exception_only(type(_exc), _exc)))\n"
            "    sys.exit(1)\n")


class CodeRegistry:
    """Dispatches guest calls. Every call, including a repeat, goes through the tool's
    final wrapped invoker, so current authorization, source switches, gates and each
    tool's own replay/freshness policy decide what is returned. There is no code-mode cache."""

    def __init__(self, tools, emit):
        self.tools = {t.name: t for t in tools}
        self.emit = emit

    async def dispatch(self, ctx, frame, ledger, parent_id):
        batch = frame.get('calls')
        if (not isinstance(batch, list) or not 1 <= len(batch) <= 8
                or len(ledger) + len(batch) > 40):
            raise ValueError('RPC call budget exceeded')
        # Reserve the budget before yielding to concurrent calls.
        slots = [{} for _ in batch]
        ledger.extend(slots)

        async def invoke(call, slot):
            name, args = call.get('name'), call.get('args')
            started = time.monotonic()
            call_id = uuid4().hex
            payload = {'tool_name': name, 'tool_call_id': call_id, 'arguments': args,
                       'parent_tool': 'code_run', 'parent_tool_call_id': parent_id}
            size = 0
            result = {'ok': False, 'error': 'cancelled'}
            value = {'ok': False, 'error': 'cancelled'}
            emitted = False

            def _fill():
                try:
                    digest_src = json.dumps(args, sort_keys=True, default=str)
                except Exception:
                    digest_src = str(args)
                slot.update(name=name if isinstance(name, str) else '', ok=bool(result.get('ok')),
                            ms=int((time.monotonic() - started) * 1000), bytes=size,
                            arguments_digest=hashlib.sha256(digest_src.encode()).hexdigest()[:16])

            async def _emit_completed():
                nonlocal emitted
                if emitted:
                    return
                emitted = True
                recorded = ({'ok': True, 'data': value, 'count': len(value), 'original_result_type': 'list'}
                            if isinstance(value, list) else value)
                event = {**payload, 'ok': result['ok'], 'output': recorded}
                if not result['ok']:
                    event['error'] = result.get('error')
                await self.emit('tool_call_completed', event)

            try:
                await self.emit('tool_call_started', payload)
                try:
                    if name not in self.tools or not isinstance(args, dict):
                        raise ValueError('API name is not authorized or arguments are invalid')
                    token = CODE_API_ACTIVE.set(True)
                    try:
                        raw = await self.tools[name].on_invoke_tool(ctx, json.dumps(args, allow_nan=False))
                    finally:
                        CODE_API_ACTIVE.reset(token)
                    try:
                        value = json.loads(raw) if isinstance(raw, str) else raw
                    except ValueError:
                        value = raw
                    value = normalize_result(value)
                    encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
                    size = len(encoded.encode())
                    if size > 1048576:
                        raise ValueError('API result exceeds 1 MB; narrow the query')
                    if is_error_result(value):
                        raise ValueError(json.dumps(value, ensure_ascii=False, default=str)[:4000])
                    result = {'ok': True, 'value': value}
                    await asyncio.to_thread(remember_shape, name, value)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    if is_control_flow(exc):
                        raise
                    result = {'ok': False, 'error': str(exc)[:4000]}
                    value = {'ok': False, 'error': result['error']}
                await _emit_completed()
                return result
            except BaseException as exc:
                if not is_control_flow(exc):
                    raise
                result = {'ok': False, 'error': 'cancelled'}
                value = {'ok': False, 'error': 'cancelled'}
                try:
                    await _emit_completed()
                except Exception:
                    pass
                raise
            finally:
                _fill()

        tasks = [asyncio.create_task(invoke(c, s)) for c, s in zip(batch, slots)]
        try:
            return {'id': frame['id'], 'results': await asyncio.gather(*tasks)}
        except asyncio.CancelledError:
            raise
        except Exception:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
