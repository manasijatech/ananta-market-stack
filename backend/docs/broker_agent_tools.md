# Broker Agent Tools

`app.agent_tools.broker_tools` exposes OpenAI Agents SDK `function_tool` wrappers around the existing Market-Stack broker services. These tools are intended for a future chat runner; they are not wired into an agent yet.

## Context

Pass `BrokerAgentContext` as the agent context:

```python
from agents import Agent
from app.agent_tools import BROKER_DATA_TOOLS, BrokerAgentContext

agent = Agent[BrokerAgentContext](
    name="Broker data assistant",
    instructions="Use broker tools only for the current user's connected accounts.",
    tools=BROKER_DATA_TOOLS,
)
```

The context fields are:

- `user_id`: Market-Stack user id. Defaults to `local-dev-user` to match the current API dependency.
- `default_account_id`: Optional preferred account for live market data and portfolio tools.
- `search_account_id`: Optional preferred account for instrument-search tools.

## Safety and Credential Handling

The tools never accept API keys, tokens, PINs, passwords, or TOTP secrets as parameters. They resolve the current user's persisted `broker_accounts` rows, then call the existing helpers that decrypt credentials only at the broker-client boundary.

If a broker session is inactive and stored automation is enabled, data tools can run the existing session maintenance helper before fetching. If the session still cannot be refreshed, the tool returns `ok=false`, `code=action_required`, and broker-specific guidance from the session service.

Order placement, modification, cancellation, smart orders, and close-all-position actions are intentionally not exposed here. The current tool set is read-only apart from cache/session/instrument maintenance.

## Tool Inventory

- `broker_list_accounts`: connected account metadata, default/search preferences, and session fields without secrets.
- `broker_get_session_status`: session status, login URL where applicable, automation status, and user guidance.
- `broker_verify_connection`: verify selected account connectivity through the existing account service.
- `broker_run_session_maintenance`: run the existing session maintenance flow for all active accounts owned by the current user.
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

All tool outputs use a consistent envelope:

```json
{"ok": true, "...": "..."}
```

or:

```json
{"ok": false, "code": "action_required", "message": "...", "...": "..."}
```
