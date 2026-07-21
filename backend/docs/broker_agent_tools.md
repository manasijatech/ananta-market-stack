# Broker Agent Tools

`app.agent_tools.broker_tools` exposes OpenAI Agents SDK `function_tool` wrappers around the existing Ananta Market Stack broker services. These tools are used by the broker chat runner and are also reusable for future broker-aware agents.

The chat runner is now implemented separately in `docs/broker_chat.md`; this file documents the reusable tool surface.

## Context

Pass `BrokerAgentContext` as the agent context:

```python
from agents import Agent
from app.agent_tools import BROKER_DATA_TOOLS, BrokerAgentContext

agent = Agent[BrokerAgentContext](
    name="Broker data assistant",
    instructions="Use broker tools only for the current user's connected accounts. Include current-day context for relative date ranges.",
    tools=BROKER_DATA_TOOLS,
)
```

The context fields are:

- `user_id`: Ananta Market Stack user id. Defaults to `local-dev-user` to match the current API dependency.
- `default_account_id`: Optional preferred account for live market data and portfolio tools.
- `search_account_id`: Optional preferred account for instrument-search tools.

## Safety and Credential Handling

The tools never accept API keys, tokens, PINs, passwords, or TOTP secrets as parameters. They resolve broker accounts through the same workspace and account-level RBAC rules as the HTTP API, then call the existing helpers that decrypt credentials only at the broker-client boundary. Shared accounts are returned only when the chat user has the permission required by that tool.

If a broker session is inactive and stored automation is enabled, data tools can run the existing session maintenance helper before fetching. If the session still cannot be refreshed, the tool returns `ok=false`, `code=action_required`, and broker-specific guidance from the session service.

Order placement, modification, cancellation, smart orders, and close-all-position actions are intentionally not exposed here. The current tool set is read-only apart from cache/session/instrument maintenance.

## Tool Inventory

- `broker_list_accounts`: workspace-accessible account metadata, access permissions, shared-account state, default/search preferences, and session fields without secrets.
- `broker_get_session_status`: session status, login URL where applicable, automation status, and user guidance.
- `broker_verify_connection`: verify selected account connectivity through the existing account service.
- `broker_run_session_maintenance`: run the existing session maintenance flow for active accessible accounts where the user has session-management permission.
- `broker_get_data_capabilities`: broker support matrix for instruments, quotes, OHLC, historical data, option chain, greeks, and stream inspection.
- `broker_search_instruments`: cached instrument search using preferred search account fallback rules.
- `broker_sync_instruments`: refresh broker instruments to CSV or SQLite cache.
- `broker_get_cached_quotes`: read recent Redis quote snapshots.
- `broker_get_quotes`: fetch live quotes through the uniform broker layer and optionally write through to Redis.
- `broker_get_ohlc`: fetch latest OHLC snapshots.
- `broker_get_historical`: fetch broker-native historical candles for one instrument.
- `broker_get_option_chain`: fetch broker-native option chain where supported.
- `broker_get_greeks`: fetch or calculate greeks where supported.
- `broker_get_portfolio`: fetch orders, trades, positions, holdings, and funds.
- `broker_get_profile`: fetch broker-side profile/account metadata.
- `broker_calculate_margin`: read-only margin estimate for hypothetical order legs.
- `broker_get_stream_status`: inspect stream/websocket capability without opening a websocket.

## Typical Agent Flow

1. Call `broker_list_accounts` to inspect available accounts and preferences.
2. Call `broker_get_session_status` if the selected account may need refresh.
3. Call `broker_run_session_maintenance` or `broker_verify_connection` if the account state is stale.
4. Call `broker_search_instruments` to resolve broker-native identifiers.
5. Call `broker_get_cached_quotes` for a low-latency snapshot, then `broker_get_quotes` if fresh live data is required.
6. Call `broker_get_data_capabilities` before optional features such as historical candles, option chain, or greeks.

## Agent Usage Rules

- Include the current date and timezone in agent instructions so relative ranges such as `last 1 month`, `last 6 months`, `today`, `YTD`, and `last year` become concrete ISO dates before tool calls.
- When a user asks for holdings, call `broker_get_portfolio` with `sections: ["holdings"]`.
- When a user asks for performance of a holding, first fetch holdings, then resolve the instrument with `broker_search_instruments`, then call `broker_get_historical` with `interval: "day"` for the requested window.
- If both 6-month and 1-month performance are requested, either fetch the larger date range and compute both windows from the returned candles, or make separate historical calls. Do not ask for the interval when daily analysis is implied.
- For Indian equities and ETFs with both NSE and BSE rows, prefer NSE unless the user asks for BSE or only BSE is available.
- `broker_get_historical` accepts one instrument, one interval, and one date range per call. Never concatenate multiple JSON objects in one tool call; make multiple tool calls instead.
- If historical candles return a broker/subscription error such as 403, explain that limitation and use `broker_get_quotes` or `broker_get_ohlc` for the best available current snapshot.
- Use `broker_get_quotes` for LTP/current-price/day-change style questions and `broker_get_ohlc` for latest OHLC snapshots. These are not substitutes for month-level candle history.

All tool outputs use a consistent envelope:

```json
{"ok": true, "...": "..."}
```

or:

```json
{"ok": false, "code": "action_required", "message": "...", "...": "..."}
```
