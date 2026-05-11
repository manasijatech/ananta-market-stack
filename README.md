# Market Stack

Market Stack is a self-hosted trading and market-data workspace for connecting multiple broker accounts, managing broker sessions, fetching quotes, viewing portfolio data, and running user-owned alert workflows through one consistent UI and API.

The repository is split into two apps:

- `frontend/` - Next.js app with Better Auth, broker account screens, integration guides, session workflows, quotes, portfolio views, alerts workspace, and alert channel settings.
- `backend/` - FastAPI service with broker account persistence, encrypted credential storage, broker session helpers, unified portfolio/order endpoints, alert workflow APIs, SQLite, Alembic, and Redis-backed live alert workers.

## Current Capabilities

- Email/password authentication in the frontend using Better Auth.
- Multi-broker account CRUD with one account registry and broker-specific encrypted credential tables.
- Broker setup documentation rendered from local markdown guides.
- Broker session flows for Zerodha, Upstox, Angel, Dhan, Groww, INDmoney, and Kotak.
- Unified broker operations for profile, orders, trades, positions, holdings, funds, quotes, smart orders, close-all, and margin calculation where supported by the broker adapter.
- Optional Redis write-through cache for quote snapshots.
- Alembic migration scaffolding for backend schema management.
- Separate user alerting domain with workflow templates, custom workflows, SSE alert notifications, live subscription management, and Discord/Telegram channel settings.

## Supported Brokers

- `angel`
- `dhan`
- `groww`
- `indmoney`
- `kotak`
- `upstox`
- `zerodha`

## Architecture

```text
Market-Stack/
  backend/
    app/              FastAPI app, routers, schemas, services, config
    broker/           Broker clients and shared broker infrastructure
    db/               SQLAlchemy engine, session, and ORM models
    alembic/          Database migrations
    docs/             Backend operational notes
  frontend/
    app/              Next.js App Router pages and API routes
    components/       UI, auth, broker, and theme components
    content/          Broker integration guides
    lib/              Auth, FastAPI bridge, utilities
    service/          Server actions, broker types, guide loading
```

The frontend talks to the backend through `NEXT_PUBLIC_API_BASE_URL`. Server actions add `X-User-Id`, `X-User-Email`, and `X-Market-Stack-Session` headers from the Better Auth session. In backend-only development, missing `X-User-Id` falls back to `local-dev-user`.

## Prerequisites

- Node.js compatible with Next.js 16 and React 19.
- Python 3.12 recommended.
- Redis is optional for broker CRUD and read-only data APIs. Redis is required for production live alerting, workflow evaluation fanout, and stream coordination.

## Backend Setup

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

Generate a production-safe Fernet key and set `CREDENTIAL_ENCRYPTION_KEY` in `backend/.env`:

```bash
.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Run database migrations:

```bash
.venv/bin/alembic upgrade head
```

Start the API:

```bash
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Useful backend URLs:

- API health: `http://127.0.0.1:8000/health`
- Versioned health: `http://127.0.0.1:8000/api/v1/health`
- OpenAPI docs: `http://127.0.0.1:8000/docs`

Optional live alert worker processes:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m app.workers.live_market_data
PYTHONPATH=. .venv/bin/python -m app.workers.alert_evaluator
PYTHONPATH=. .venv/bin/python -m app.workers.alert_delivery
```

## Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env.local
```

Set the frontend environment values:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
```

Generate `BETTER_AUTH_SECRET` with:

```bash
openssl rand -base64 32
```

Start the frontend:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Development Commands

Backend:

```bash
cd backend
.venv/bin/alembic current
.venv/bin/alembic revision --autogenerate -m "describe_change"
.venv/bin/alembic upgrade head
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
npm run dev
```

## API Overview

All versioned API routes use the `/api/v1` prefix.

Core routes:

- `GET /health`
- `GET /health/redis`
- `GET /brokers/supported`
- `GET /users/me`
- `POST /users`
- `GET /users/{user_id}`

Broker account routes:

- `GET /broker-accounts`
- `POST /broker-accounts`
- `GET /broker-accounts/{account_id}`
- `DELETE /broker-accounts/{account_id}`
- `POST /broker-accounts/{account_id}/verify`
- `POST /broker-accounts/{account_id}/quotes`
- `POST /broker-accounts/maintenance/run`

Session routes are exposed under:

```text
/broker-accounts/{account_id}/sessions/{broker}
```

Unified broker operation routes include:

- `GET /broker-accounts/{account_id}/profile`
- `GET /broker-accounts/{account_id}/portfolio/orders`
- `GET /broker-accounts/{account_id}/portfolio/trades`
- `GET /broker-accounts/{account_id}/portfolio/positions`
- `GET /broker-accounts/{account_id}/portfolio/holdings`
- `GET /broker-accounts/{account_id}/portfolio/funds`
- `POST /broker-accounts/{account_id}/margin/calculate`
- `GET /broker-accounts/{account_id}/data/capabilities`
- `POST /broker-accounts/{account_id}/data/instruments/sync`
- `POST /broker-accounts/{account_id}/data/instruments/sync-csv`
- `DELETE /broker-accounts/{account_id}/data/instruments`
- `GET /broker-accounts/{account_id}/data/instruments/search`
- `POST /broker-accounts/{account_id}/data/quotes`
- `POST /broker-accounts/{account_id}/data/ohlc`
- `POST /broker-accounts/{account_id}/data/historical`
- `POST /broker-accounts/{account_id}/data/option-chain`
- `POST /broker-accounts/{account_id}/data/greeks`
- `GET /broker-accounts/{account_id}/data/stream/status`

Notifications:

- `GET /notifications`
- `POST /notifications/{notification_id}/read`

User alert routes:

- `GET /alert-templates`
- `POST /alert-templates/{template_id}/instantiate`
- `GET /alert-workflows`
- `POST /alert-workflows`
- `GET /alert-workflows/{workflow_id}`
- `PUT /alert-workflows/{workflow_id}`
- `POST /alert-workflows/{workflow_id}/enable`
- `POST /alert-workflows/{workflow_id}/disable`
- `POST /alert-workflows/{workflow_id}/duplicate`
- `POST /alert-workflows/{workflow_id}/test`
- `GET /alert-workflows/{workflow_id}/runs`
- `GET /alert-workflows/history/all`
- `GET /alert-notifications`
- `GET /alert-notifications/unread-count`
- `POST /alert-notifications/{notification_id}/read`
- `POST /alert-notifications/read-all`
- `GET /alert-notifications/stream`
- `POST /alert-notifications/test`
- `GET /alert-channels`
- `PUT /alert-channels/{channel_type}`
- `POST /alert-channels/{channel_type}/test`
- `GET /live-streams/status`
- `GET /live-streams/subscriptions`
- `POST /live-streams/subscriptions`
- `PUT /live-streams/subscriptions/replace`
- `DELETE /live-streams/subscriptions/{subscription_id}`

## Environment Notes

Backend environment:

- `DATABASE_URL` defaults to `sqlite:///./data/app.db`.
- `APP_PUBLIC_BASE_URL` is used by broker callback/session flows.
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`, and `REDIS_QUOTE_TTL_SECONDS` configure quote caching and the live alert worker event bus.
- `CREDENTIAL_ENCRYPTION_KEY` protects broker secrets at rest and must be treated like a master secret.
- `ALLOW_INSECURE_DEV_CREDENTIALS=true` is only for throwaway local development.
- `APP_DEBUG` controls backend debug mode.

Frontend environment:

- `NEXT_PUBLIC_APP_URL` is the browser-facing frontend URL.
- `NEXT_PUBLIC_API_BASE_URL` points to the backend `/api/v1` base.
- `BETTER_AUTH_SECRET` signs auth state.
- `BETTER_AUTH_URL` is the Better Auth base URL.

## Data And Security

- Backend broker credentials are stored in broker-specific SQLAlchemy tables and encrypted with Fernet.
- Backend SQLite data is stored under `backend/data/` by default.
- Frontend Better Auth SQLite data is stored under `frontend/data/` by default.
- Do not commit `.env`, SQLite databases, broker tokens, generated auth secrets, or production Fernet keys.
- Broker API responses are generally broker-native shapes; the API layer does not fully normalize portfolio/order payloads.

## Implementation Notes

- Backend router entry point: `backend/app/main.py`.
- Backend API router registration: `backend/app/api/v1/__init__.py`.
- Broker account API: `backend/app/api/v1/broker_accounts.py`.
- Unified broker operations API: `backend/app/api/v1/broker_ops.py`.
- Alert APIs: `backend/app/api/v1/alert_*.py` and `backend/app/api/v1/live_streams.py`.
- Alert services and workers: `backend/app/services/alerts.py`, `backend/app/services/alert_runtime.py`, and `backend/app/workers/`.
- Broker registry: `backend/broker/core/registry.py`.
- Frontend auth: `frontend/lib/auth.ts`.
- Frontend FastAPI bridge: `frontend/lib/fastapi.ts`.
- Frontend broker server actions: `frontend/service/actions/broker.ts`.
- Frontend alert actions and types: `frontend/service/actions/alerts.ts` and `frontend/service/types/alerts.ts`.
- Frontend broker pages: `frontend/app/brokers/`.
- Frontend alerts workspace: `frontend/app/alerts/` and `frontend/app/alert-channels/`.

For deeper backend architecture and broker-extension guidance, see `backend/AGENTS.md`.
