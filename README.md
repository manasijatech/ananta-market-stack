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

The frontend talks to the backend through the configured API base URL. In Docker, server-side frontend calls use `http://backend:8000/api/v1` inside the Compose network while browser-facing websocket/testing URLs use `http://localhost:8000/api/v1` by default. Server actions add `X-User-Id`, `X-User-Email`, and `X-Market-Stack-Session` headers from the Better Auth session. In backend-only development, missing `X-User-Id` falls back to `local-dev-user`.

## Prerequisites

- Docker and Docker Compose for the fastest full-stack setup.
- Node.js compatible with Next.js 16 and React 19 for manual frontend development.
- Python 3.12 recommended for manual backend development.
- Redis is optional for broker CRUD and read-only data APIs. Redis is required for production live alerting, workflow evaluation fanout, and stream coordination.

## Quick Start With Docker

From the repository root:

```bash
docker compose up --build
```

Open:

```text
http://localhost:3000
```

The default Docker stack runs:

- Frontend on `http://localhost:3000`
- Backend on `http://localhost:8000`
- Backend API base at `http://localhost:8000/api/v1`
- Redis inside the Compose network as `redis:6379`
- SQLite and generated secrets in Docker named volumes

The backend also uses `8000` inside the Compose network, so frontend server-side calls go to `http://backend:8000/api/v1`.

Optional local overrides can be set in a root `.env` file:

```bash
cp .env.example .env
```

For example, if backend port `8000` is already occupied on your machine:

```env
BACKEND_PORT=8004
NEXT_PUBLIC_API_BASE_URL=http://localhost:8004/api/v1
MARKET_STACK_PUBLIC_API_BASE_URL=http://localhost:8004/api/v1
APP_PUBLIC_BASE_URL=http://localhost:8004
```

Useful Docker commands:

```bash
docker compose up -d --build
docker compose logs -f backend
docker compose logs -f frontend
docker compose down
```

To update a running self-hosted instance:

```bash
git pull
docker compose up -d --build
```

To reset all Docker-managed development data and generated secrets:

```bash
docker compose down -v
```

Do not use `down -v` on a real self-hosted instance unless you have backups.

## Docker Data And Secrets

Docker Compose creates these named volumes:

- `market-stack_backend_data` - SQLite database and backend data files.
- `market-stack_market_stack_config` - generated `CREDENTIAL_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, and `REDIS_PASSWORD`.
- `market-stack_redis_data` - Redis append-only data.

The `bootstrap` service generates missing secrets once and keeps them stable across restarts and image rebuilds. Back up `market-stack_backend_data` and `market-stack_market_stack_config` together. If `CREDENTIAL_ENCRYPTION_KEY` is lost, existing encrypted broker credentials in SQLite cannot be decrypted.

For production domains, override these values before starting Compose:

```bash
FRONTEND_PORT=3000
BACKEND_PORT=8000
BETTER_AUTH_URL=https://your-frontend-domain.example
BETTER_AUTH_TRUSTED_ORIGINS=https://your-frontend-domain.example
NEXT_PUBLIC_APP_URL=https://your-frontend-domain.example
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.example/api/v1
MARKET_STACK_PUBLIC_APP_URL=https://your-frontend-domain.example
MARKET_STACK_PUBLIC_API_BASE_URL=https://your-backend-domain.example/api/v1
MARKET_STACK_API_INTERNAL_URL=http://backend:8000/api/v1
APP_PUBLIC_BASE_URL=https://your-backend-domain.example
```

Most HTTP API calls are made by the Next.js server, so a private backend works for normal pages. The backend still needs a browser-reachable URL for the current websocket features: broker data websocket testing and market-intelligence live feed. If you do not use those features, you can keep backend access private behind your deployment. If you do use them, expose the backend through a reverse proxy/subdomain and point `MARKET_STACK_PUBLIC_API_BASE_URL` at that public backend URL.

If you use an external Redis, set `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, and `REDIS_PASSWORD`, and remove or ignore the bundled Redis service as part of your deployment-specific Compose override.

## Manual Backend Setup

```bash
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

PowerShell on Windows:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
Copy-Item .env.example .env
```

Generate a production-safe Fernet key and set `CREDENTIAL_ENCRYPTION_KEY` in `backend/.env`:

```bash
.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

PowerShell on Windows:

```powershell
.\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Run database migrations:

```bash
.venv/bin/alembic upgrade head
```

PowerShell on Windows:

```powershell
.\.venv\Scripts\alembic.exe upgrade head
```

Start the API:

```bash
.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

PowerShell on Windows:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
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

PowerShell on Windows:

```powershell
cd backend
$env:PYTHONPATH = "."
.\.venv\Scripts\python.exe -m app.workers.live_market_data
.\.venv\Scripts\python.exe -m app.workers.alert_evaluator
.\.venv\Scripts\python.exe -m app.workers.alert_delivery
```

## Manual Frontend Setup

```bash
cd frontend
npm install
cp .env.example .env.local
```

Set the frontend environment values:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1
MARKET_STACK_PUBLIC_APP_URL=http://localhost:3000
MARKET_STACK_PUBLIC_API_BASE_URL=http://127.0.0.1:8000/api/v1
MARKET_STACK_API_INTERNAL_URL=http://127.0.0.1:8000/api/v1
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
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

PowerShell on Windows:

```powershell
cd backend
.\.venv\Scripts\alembic.exe current
.\.venv\Scripts\alembic.exe revision --autogenerate -m "describe_change"
.\.venv\Scripts\alembic.exe upgrade head
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
- `MARKET_STACK_API_INTERNAL_URL` lets frontend server actions call the backend through an internal Docker URL such as `http://backend:8000/api/v1`.
- `MARKET_STACK_PUBLIC_APP_URL` and `MARKET_STACK_PUBLIC_API_BASE_URL` are runtime-friendly public URLs for server-rendered frontend flows.
- `BETTER_AUTH_SECRET` signs auth state.
- `BETTER_AUTH_URL` is the Better Auth base URL.
- `BETTER_AUTH_TRUSTED_ORIGINS` is a comma-separated allow-list for frontend origins.

## Data And Security

- Backend broker credentials are stored in broker-specific SQLAlchemy tables and encrypted with Fernet.
- Backend SQLite data is stored under `backend/data/` by default in manual development and `/data/app.db` in Docker.
- Frontend Better Auth uses the same SQLite database by default so backend user IDs and frontend sessions stay aligned.
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
