# Development Setup

This guide is for working on Ananta Market Stack from source. For Docker-based self-hosting, use [self-hosting.md](self-hosting.md).

## Requirements

- [Python](https://www.python.org/downloads/) 3.12 recommended for the backend.
- [Node.js](https://nodejs.org/) 24 for the frontend. The frontend uses Node's built-in `node:sqlite` driver.
- [Redis](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/) for cached quote snapshots, live alert workers, broker chat queues, and event streams.

## Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
```

Generate a Fernet key and set `CREDENTIAL_ENCRYPTION_KEY` in `backend/.env`:

```bash
.venv/bin/python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Run migrations:

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

<details>
<summary>PowerShell backend commands</summary>

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
.\.venv\Scripts\alembic.exe upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

</details>

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

Set the local frontend environment values:

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

Generate `BETTER_AUTH_SECRET`:

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

## Architecture Notes

The repository is split into two apps:

- `frontend/` - Next.js app with Better Auth, broker account screens, integration guides, session workflows, quotes, portfolio views, alerts workspace, and alert channel settings.
- `backend/` - FastAPI service with broker account persistence, encrypted credential storage, broker session helpers, unified portfolio/order endpoints, alert workflow APIs, SQLite, Alembic, and Redis-backed workers.

The frontend talks to the backend through the configured API base URL. In Docker, server-side frontend calls use `http://backend:8000/api/v1` inside the Compose network while browser-facing websocket/testing URLs use `http://localhost:8000/api/v1` by default.

Server actions add `X-User-Id`, `X-User-Email`, and `X-Market-Stack-Session` headers from the Better Auth session. In backend-only development, missing `X-User-Id` falls back to `local-dev-user`.

<details>
<summary>Implementation entry points</summary>

- Backend router entry point: `backend/app/main.py`
- Backend API router registration: `backend/app/api/v1/__init__.py`
- Broker account API: `backend/app/api/v1/broker_accounts.py`
- Unified broker operations API: `backend/app/api/v1/broker_ops.py`
- Alert APIs: `backend/app/api/v1/alert_*.py` and `backend/app/api/v1/live_streams.py`
- Alert services and workers: `backend/app/services/alerts.py`, `backend/app/services/alert_runtime.py`, and `backend/app/workers/`
- Broker registry: `backend/broker/core/registry.py`
- Frontend auth: `frontend/lib/auth.ts`
- Frontend FastAPI bridge: `frontend/lib/fastapi.ts`
- Frontend broker server actions: `frontend/service/actions/broker.ts`
- Frontend alert actions and types: `frontend/service/actions/alerts.ts` and `frontend/service/types/alerts.ts`
- Frontend broker pages: `frontend/app/broker-connections/`
- Frontend alerts workspace: `frontend/app/alerts-workspace/` and `frontend/app/alert-channels/`

For deeper backend architecture and broker-extension guidance, see [backend/AGENTS.md](../backend/AGENTS.md).

</details>

<details>
<summary>Optional worker processes</summary>

Live alert workers:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m app.workers.live_market_data
PYTHONPATH=. .venv/bin/python -m app.workers.alert_evaluator
PYTHONPATH=. .venv/bin/python -m app.workers.alert_delivery
```

Broker chat worker:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m app.workers.broker_chat
```

PowerShell:

```powershell
cd backend
$env:PYTHONPATH = "."
.\.venv\Scripts\python.exe -m app.workers.live_market_data
.\.venv\Scripts\python.exe -m app.workers.alert_evaluator
.\.venv\Scripts\python.exe -m app.workers.alert_delivery
.\.venv\Scripts\python.exe -m app.workers.broker_chat
```

The API process includes fallback behavior for simple installs, but dedicated workers are preferred for higher throughput.

</details>

## Migration Workflow

1. Change SQLAlchemy models.
2. Generate an Alembic revision.
3. Review and edit the revision carefully.
4. Run `alembic upgrade head`.
5. Start the app and verify.

See [backend/docs/migrations.md](../backend/docs/migrations.md) for project-specific migration notes.

## Compatibility Notes

The backend should remain bootable on Windows local environments. Follow [backend/docs/windows_runtime_compat.md](../backend/docs/windows_runtime_compat.md) when changing datetime imports, asyncio timeout handling, or platform-specific dependencies.

## Contributing

Before opening a pull request, read [CONTRIBUTING.md](../CONTRIBUTING.md).
