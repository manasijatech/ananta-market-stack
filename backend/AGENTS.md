# AGENTS.md — project tracking

This file is the handoff surface for humans and coding agents: architecture, conventions, roadmap alignment, and safe extension points.

## Product context

Modular trading/data platform: self-hosted core plus future managed offerings. This repository implements the **core API layer** for **multi-broker account management** (many accounts per user, many brokers per user), with SQLite for configuration and Redis for short-lived market-data snapshots.

See `idea.md` for product narrative and roadmap.
See `docs/broker_auth_flows.md` for broker session/auth behavior and `docs/migrations.md` for the Alembic workflow.
See `docs/windows_runtime_compat.md` for Python 3.10 / Windows-safe runtime conventions.
See `docs/broker_agent_tools.md` for the OpenAI Agents SDK broker-data tool surface.
See `docs/broker_chat.md` for the asynchronous broker chat API, RQ worker, and SSE stream behavior.

## Current phase (roadmap)

**Broker connections** — in progress in this repo:

- Persist multiple broker accounts per user with **per-broker credential tables** (normalized, FK to a shared `broker_accounts` row).
- Unified HTTP API for CRUD, verification, session refresh, quotes, portfolio, orders, margin (where supported).
- Unified **read-only broker data** layer for instrument sync/search, quotes, OHLC, historical data, option-chain, greeks, and websocket inspection.
- Optional Redis write-through for last quote payloads (TTL configurable).

**Convention:** every broker and every major feature area should live in a **dedicated package** (subdirectory) with a small public surface. Do not add monolithic `*_adapter.py` files at the root of `broker/`.

Also implemented now:

- Separate **alerts workspace** domain for user-owned trading alerts and workflows.
- Redis-backed **live data workers** for symbol subscription polling/fanout, workflow evaluation, and outbound alert delivery.
- Dedicated **alert notifications** domain and channel settings for in-app, Discord webhook, and Telegram bot delivery.
- Read-only OpenAI Agents SDK broker-data tools under `app/agent_tools/` for future chat integrations.
- Asynchronous broker chat runs backed by RQ, SQLite history, and resumable Redis/SSE event streams.

Next roadmap items (not implemented here): production-grade native broker websocket adapters for every broker, richer workflow graph primitives, billing, MCP tools, RBAC.

## Tech stack

| Area | Choice |
|------|--------|
| API | FastAPI |
| Config / broker registry DB | SQLite + SQLAlchemy 2.x |
| Credential storage | Fernet-encrypted columns per broker table |
| Realtime quote cache | Redis (`redis` PyPI package) |
| HTTP to brokers | `httpx` (sync) inside broker clients |

MongoDB is listed in `idea.md` for workflows later; it is **not** required for the broker module today.

## Cross-platform runtime conventions

- Import UTC only from `common.datetime_compat`. Do not use `from datetime import UTC`; that breaks Python 3.10 Windows environments at import time.
- For asyncio worker loops and websocket polling, catch `asyncio.TimeoutError`, not a bare `TimeoutError`.
- Keep platform-marked runtime dependencies in `requirements.txt`: `uvloop` only outside Windows, `winloop` only on Windows, and `tzdata` on Windows.
- When persisting SQLite datetimes, keep the existing convention of storing naive UTC values deliberately and normalize aware-vs-naive comparisons explicitly before comparing timestamps.

## Repository layout

```
app/                    # FastAPI app, settings, deps, routers, Pydantic schemas, services
  api/v1/
    broker_accounts.py  # CRUD, verify, quotes, broker-specific session routes
    broker_ops.py       # Unified portfolio + orders + margin (one router per account)
    alert_*.py         # Separate alert templates, workflows, notifications, channels, live stream control
  workers/             # Long-running worker entrypoints for live data, evaluation, delivery
broker/
  core/                 # Shared broker infrastructure (no single-broker logic here)
    types.py            # BrokerCode enum
    interface.py        # UnifiedBrokerClient protocol (contract for all clients)
    registry.py         # get_client_for_account, BROKER_CODES
    http.py             # shared httpx client factory
    instruments.py      # InstrumentResolver, DefaultInstrumentResolver, token merge helpers
    redis_cache.py      # quote cache helpers
    logging_util.py
  crypto.py             # Fernet encrypt/decrypt for credential columns
  <broker>/             # One package per broker — all code for that broker stays here
    client.py           # Composes modules; implements UnifiedBrokerClient
    http_api.py         # Low-level REST calls (paths, headers)
    auth.py             # Session / token refresh (if applicable)
    orders.py, funds.py, margin.py, market_data.py, mapping.py, … as needed
    streaming.py        # Placeholder: raises NotImplementedError until a worker exists
db/                     # SQLAlchemy Base, engine/session, ORM models
data/                   # Runtime SQLite default path (gitignored if you add it)
```

Run from repo root with `PYTHONPATH=.` so `app`, `broker`, and `db` resolve.

### Per-broker package rule

When you touch broker behavior:

1. Edit only `broker/<name>/…` (and `broker/core/…` if the change is truly cross-cutting).
2. Register construction in `broker/core/registry.py` (`get_client_for_account`).
3. If you add a **new** broker, also extend `BrokerCode`, ORM, schemas, and `create_broker_account` (see checklist below).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | SQLAlchemy URL (default `sqlite:///./data/app.db`) |
| `REDIS_*` | Host, port, password, db index, quote TTL |
| `CREDENTIAL_ENCRYPTION_KEY` | Fernet key (44-char urlsafe base64) for all encrypted columns |
| `ALLOW_INSECURE_DEV_CREDENTIALS` | If `true`, uses a **derived dev-only** Fernet key (never in production) |
| `APP_DEBUG` | App debug flag (avoids clashing with generic `DEBUG`) |
| `ENABLE_ORDER_MUTATIONS` | Defaults to `false`. When `false`, order placement/modification/cancel endpoints return `403` and stay hidden from OpenAPI. |
| `REDIS_*` | Required for production alert fanout, live tick cache, and workflow evaluation coordination. |

See `.env.example`.

## Authentication (intentionally absent for now)

There is **no** auth middleware yet. The API uses an optional header:

- `X-User-Id` — string user id; if omitted, defaults to `local-dev-user` and auto-creates the row.

**Extension point:** replace `get_current_user` in `app/deps.py` with JWT/API-key resolution, map identity to `users.id`, and keep the rest of the API unchanged.

## Unified broker client (`broker/core/interface.py`)

Every broker’s `client.py` should implement **`UnifiedBrokerClient`**: `verify_connection`, `user_profile`, `order_book`, `trade_book`, `positions`, `holdings`, `funds`, `place_order`, `modify_order`, `cancel_order`, `cancel_all_open_orders`, `smart_order`, `close_all_positions`, `calculate_margin`, `fetch_quotes`, `sync_instruments`, `fetch_ohlc`, `fetch_historical`, `option_chain`, `greeks`, and `stream_capabilities`.

Return values are **broker-native JSON** shapes (dict/list) unless documented otherwise. The API layer does not normalize responses across brokers.

**Instrument resolution:** clients accept `resolver: InstrumentResolver`. The default identity resolver still exists, but broker-account operations should now prefer the SQLite-backed resolver so symbol-first requests can be hydrated from the `broker_instruments` cache.

## HTTP API (v1)

Base prefix: `/api/v1`.

### Meta, users, health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness |
| GET | `/health/redis` | Redis ping |
| GET | `/brokers/supported` | Supported broker codes |
| GET | `/users/me` | Current user (from `X-User-Id`) |
| POST | `/users` | Create user (explicit UUID id) |
| GET | `/users/{user_id}` | Fetch user |

Root `GET /health` duplicates a minimal liveness check (for load balancers).

### Broker accounts (`/broker-accounts`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/broker-accounts` | Create account (discriminated JSON by `broker`) |
| GET | `/broker-accounts` | List current user’s accounts |
| GET | `/broker-accounts/{id}` | Metadata only (no secrets) |
| DELETE | `/broker-accounts/{id}` | Remove account + credential row |
| POST | `/broker-accounts/maintenance/run` | Run token/session maintenance now for current user |
| POST | `/broker-accounts/{id}/verify` | Light connectivity check |
| POST | `/broker-accounts/{id}/quotes` | Fetch quotes; optional Redis cache |
| GET | `/broker-accounts/{id}/sessions/zerodha` | Session status + login URL + expiry guidance |
| POST | `/broker-accounts/{id}/sessions/zerodha` | Exchange `request_token` → access token |
| POST | `/broker-accounts/{id}/sessions/zerodha/refresh` | Experimental Zerodha web-login automation using stored user id + password + TOTP secret |
| GET | `/broker-accounts/{id}/sessions/upstox` | Session status + OAuth login URL |
| POST | `/broker-accounts/{id}/sessions/upstox` | Exchange OAuth `authorization_code` |
| POST | `/broker-accounts/{id}/sessions/upstox/request-token` | Official Upstox semi-automated token request (user approves in Upstox; token comes to notifier webhook) |
| POST | `/broker-accounts/sessions/upstox/notifier` | Public webhook receiver for Upstox semi-automated token delivery |
| GET | `/broker-accounts/{id}/sessions/angel` | Session status / automation readiness |
| POST | `/broker-accounts/{id}/sessions/angel` | TOTP login → JWT + feed token |
| POST | `/broker-accounts/{id}/sessions/angel/refresh` | Automated Angel refresh using stored pin + TOTP secret |
| GET | `/broker-accounts/{id}/sessions/dhan` | Session status / automation readiness |
| POST | `/broker-accounts/{id}/sessions/dhan` | Consume consent `token_id` |
| POST | `/broker-accounts/{id}/sessions/dhan/start` | Generate Dhan consent login URL |
| POST | `/broker-accounts/{id}/sessions/dhan/refresh` | Official Dhan refresh / TOTP automation |
| GET | `/broker-accounts/{id}/sessions/kotak` | Session status / automation readiness |
| POST | `/broker-accounts/{id}/sessions/kotak` | TOTP + MPIN → session bundle |
| POST | `/broker-accounts/{id}/sessions/kotak/refresh` | Automated Kotak refresh using stored mobile + MPIN + TOTP secret |
| GET | `/broker-accounts/{id}/sessions/groww` | Session status / automation readiness |
| POST | `/broker-accounts/{id}/sessions/groww` | Refresh Groww token via approval flow, TOTP flow, or manual token submit |
| GET | `/broker-accounts/{id}/sessions/indmoney` | Session status / manual token guidance |
| POST | `/broker-accounts/{id}/sessions/indmoney` | Store refreshed INDmoney access token |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notifications` | List current user broker/session alerts |
| POST | `/notifications/{id}/read` | Mark a notification as read |

### Alert notifications and workflows

| Method | Path | Description |
|--------|------|-------------|
| GET | `/alert-templates` | List immutable built-in workflow templates |
| GET | `/alert-templates/{id}` | Fetch one template |
| POST | `/alert-templates/{id}/instantiate` | Create a user-owned workflow from a template |
| GET | `/alert-workflows` | List user workflows |
| POST | `/alert-workflows` | Create workflow |
| GET | `/alert-workflows/{id}` | Fetch workflow |
| PUT | `/alert-workflows/{id}` | Update workflow |
| DELETE | `/alert-workflows/{id}` | Delete workflow |
| POST | `/alert-workflows/{id}/enable` | Enable workflow |
| POST | `/alert-workflows/{id}/disable` | Disable workflow |
| POST | `/alert-workflows/{id}/duplicate` | Duplicate workflow |
| POST | `/alert-workflows/{id}/test` | Evaluate a workflow against a sample tick |
| GET | `/alert-workflows/{id}/runs` | Workflow run history |
| GET | `/alert-workflows/history/all` | Recent alert workflow run history |
| GET | `/alert-notifications` | List user trading alerts |
| GET | `/alert-notifications/unread-count` | Unread user alert count |
| POST | `/alert-notifications/{id}/read` | Mark one user alert as read |
| POST | `/alert-notifications/read-all` | Mark all user alerts as read |
| GET | `/alert-notifications/stream` | SSE stream for live user alert delivery |
| POST | `/alert-notifications/test` | Generate a test user alert |
| GET | `/alert-channels` | List user alert channel settings |
| PUT | `/alert-channels/{channel_type}` | Create/update channel credentials or defaults |
| POST | `/alert-channels/{channel_type}/test` | Send a test alert to one channel |
| GET | `/live-streams/status` | Worker health and active sessions |
| GET | `/live-streams/subscriptions` | Desired symbol subscriptions |
| POST | `/live-streams/subscriptions` | Add symbol subscription |
| PUT | `/live-streams/subscriptions/replace` | Replace desired subscriptions |
| DELETE | `/live-streams/subscriptions/{id}` | Remove one subscription |
| POST | `/live-streams/subscriptions/reconcile` | Trigger a reconciliation check |

### Unified operations (`/broker-accounts/{account_id}/…` from `broker_ops`)

Same URL prefix as above; `broker_ops` router adds nested paths on `account_id`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../profile` | Broker profile / user info |
| GET | `.../portfolio/orders` | Order book |
| GET | `.../portfolio/trades` | Trade book |
| GET | `.../portfolio/positions` | Positions |
| GET | `.../portfolio/holdings` | Holdings |
| GET | `.../portfolio/funds` | Funds / margins (broker shape) |
| POST | `.../margin/calculate` | Margin estimate from leg list |
| GET | `.../data/capabilities` | Feature matrix for the broker data layer |
| POST | `.../data/instruments/sync` | Refresh instrument cache into SQLite |
| GET | `.../data/instruments/search` | Query cached broker instruments |
| POST | `.../data/quotes` | Read-only quote batch |
| POST | `.../data/ohlc` | Read-only OHLC batch |
| POST | `.../data/historical` | Historical candle request |
| POST | `.../data/option-chain` | Option chain where supported |
| POST | `.../data/greeks` | Greeks where supported |
| GET | `.../data/stream/status` | Websocket inspection status |
| WS | `.../data/stream/ws` | On-demand quote inspection stream |

Order mutation routes still exist in code for future phases, but they are intentionally hidden from OpenAPI and gated by `ENABLE_ORDER_MUTATIONS=false` by default.

`OrderBody` in `broker_ops.py`: canonical fields plus **`extra`** (merged into the dict passed to `place_order` / `modify_order`). Use `extra` for instrument tokens, native flags, etc.

## Supported brokers

`angel`, `dhan`, `groww`, `indmoney`, `kotak`, `upstox`, `zerodha`.

Each has a dedicated table `broker_<name>_credentials` with a 1:1 FK to `broker_accounts.id` (`ON DELETE CASCADE`).

## Broker-specific notes (maintain as you implement)

| Broker | Quotes / instruments | Orders / margin / streaming |
|--------|----------------------|-----------------------------|
| Zerodha | `zerodha_instrument_token` | Create with `api_key` + `api_secret`; `access_token` is optional. Official flow is login redirect → `request_token` → `/sessions/zerodha`. An additional **experimental** automation path is available when the user opts to store Zerodha `user_id`, password, and TOTP secret; this mimics the web login and is intentionally documented as non-official because it relies on web endpoints rather than Kite Connect APIs. |
| Upstox | `upstox_instrument_key` | OAuth 2.0 remains the default flow. Create with app credentials; use the session status endpoint to get the login URL and exchange the returned `authorization_code`. Upstox also has an official **semi-automated token request** flow where the user approves in the Upstox app/WhatsApp and the token is delivered to a notifier webhook. |
| Angel | `angel_exchange` + `angel_token` | SmartAPI session can be created manually with `client_code` + `pin` + `totp`, or refreshed automatically when a TOTP secret is stored. Watch SmartAPI policy changes because auth requirements have been evolving. |
| Dhan | `dhan_exchange_segment` + `dhan_security_id` | Supports three official modes: manual web token, official consent/tokenId flow, and official TOTP-based token generation. Stored Dhan pin + TOTP secret enable automated refresh. |
| Groww | `groww_exchange`, `groww_segment`, `groww_trading_symbol` | Supports official API approval flow (`api_key` + `api_secret`) and official TOTP flow (`totp_token` + `totp_secret`). TOTP mode can be automated by generating OTPs server-side. |
| Indmoney | `indmoney_scrip_code` | Manual portal token flow plus IP allowlisting. The backend stores token status and raises notifications when renewal is needed; there is no broker-supported automated login flow in this repo. |
| Kotak | `kotak_query` or `kotak_segment` + `kotak_psymbol` (needs `session_bundle`) | Use portal consumer token plus TOTP + MPIN to build a trade session. If `mobile_number`, `mpin`, and `totp_secret` are stored, the backend can rebuild the session automatically. |

Redis keys (quotes, best-effort): `quote:{user_id}:{account_id}:{broker_code}:{symbol}` with JSON payload and TTL `REDIS_QUOTE_TTL_SECONDS`.

SQLite instrument cache tables:

- `broker_instruments`
- `broker_instrument_sync_runs`

## Operational notes

- **SQLite file**: ensure the process can create `data/` (see `db/session.py`).
- **Migrations**: Alembic is now scaffolded in `alembic/`. Existing databases should be stamped to the baseline revision first, then future schema changes should use generated revisions instead of only runtime patching.
- **Token maintenance**: a lightweight in-process maintenance loop checks broker sessions daily after **06:30 IST**, attempts broker-supported refresh paths, and emits notifications for manual re-auth flows. Use `/broker-accounts/maintenance/run` to trigger the same logic on demand.
- **Instrument maintenance**: a separate daily sync pass runs after **08:30 IST** and refreshes instrument metadata into SQLite once per broker per day.
- **Broker chat worker**: start `PYTHONPATH=. ./venv/bin/python -m app.workers.broker_chat` to process `/broker-chat/runs` jobs from RQ.
- **Alert workers**: start these separately when you need live alerting:
  - `PYTHONPATH=. ./venv/bin/python -m app.workers.live_market_data`
  - `PYTHONPATH=. ./venv/bin/python -m app.workers.alert_evaluator`
  - `PYTHONPATH=. ./venv/bin/python -m app.workers.alert_delivery`
- **Live data mode**: the current worker implementation uses Redis-backed polling through the unified quote layer. Native broker websocket adapters remain a per-broker next step rather than an implied guarantee.
- **Tests**: use `TestClient` as a context manager so lifespan runs and tables exist: `with TestClient(app) as c:`.
- **Compliance**: secrets are encrypted at rest with Fernet; protect `CREDENTIAL_ENCRYPTION_KEY` like any master key. SQLite file permissions and disk encryption are deployment concerns.

## Agent maintenance checklist

### Adding a new broker

1. Add enum value in `broker/core/types.py` (`BrokerCode`).
2. Add ORM model `broker_<x>_credentials` + relationship on `BrokerAccount` in `db/models.py`.
3. Create package `broker/<x>/` with `client.py` implementing **`UnifiedBrokerClient`**, split helpers into focused modules (`http_api`, `orders`, …).
4. Wire `get_client_for_account` in `broker/core/registry.py`.
5. Export from `broker/__init__.py` only if there is a stable public symbol (usually unnecessary beyond registry).
6. Add Pydantic `...Create` model and union member in `app/schemas/broker.py`.
7. Extend `create_broker_account` (and verification/session helpers) in `app/services/broker_accounts.py`.
8. Add session route(s) under `broker_accounts` if the broker needs token refresh.
9. Update this file and OpenAPI descriptions.

### Adding a cross-cutting feature (e.g. new order type)

1. Extend **`UnifiedBrokerClient`** in `broker/core/interface.py` if the capability is universal.
2. Implement in each `broker/<name>/client.py` (delegate to `orders.py` or similar).
3. Add a route in `app/api/v1/broker_ops.py` (or broker-specific route only if it cannot be unified).
4. Document broker gaps (native payload, NotImplemented) in this file.

---

*Last updated: 2026-04-02*
