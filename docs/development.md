# Development Setup

This guide is for working on Ananta Market Stack from source. For Docker-based self-hosting, use [self-hosting.md](self-hosting.md).

## Choose a workflow

| Workflow | Best for |
|----------|----------|
| [Native setup](#requirements) below | Day-to-day coding, fastest reload on Windows |
| [Docker Compose Watch](#docker-compose-watch-development) | One-command stack without local Python, Node, or Redis |

## Docker Compose Watch development

Run the full stack in Docker with hot reload via [Compose Watch](https://docs.docker.com/compose/how-tos/file-watch/). Compose syncs edited files into running containers; `uvicorn --reload` and `next dev` handle the reload.

**Requirements:** [Docker Desktop](https://docs.docker.com/get-docker/) with Compose **2.22+** (Compose Watch).

### First-time setup

```bash
cp .env.dev.example .env.dev
```

<details>
<summary>PowerShell first-time setup</summary>

```powershell
Copy-Item .env.dev.example .env.dev
```

</details>

Generate a stable `BETTER_AUTH_SECRET` in `.env.dev` (recommended):

```bash
openssl rand -base64 32
```

Optionally set `CREDENTIAL_ENCRYPTION_KEY` in `.env.dev` as well. If you leave it empty, dev Compose enables `ALLOW_INSECURE_DEV_CREDENTIALS=true` for local-only broker credential encryption.

### Start with watch

```bash
docker compose -f docker-compose.dev.yml watch
```

Equivalent:

```bash
docker compose -f docker-compose.dev.yml up --watch
```

Open `http://localhost:3000`. The dev stack exposes:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- API docs: `http://127.0.0.1:8000/docs`

SQLite data is stored on the host at `backend/data/` (shared by backend and frontend auth).

### How file sync works

| Change | Compose action | Reload |
|--------|----------------|--------|
| Backend `.py` files | `sync` into `/app` | `uvicorn --reload` |
| Frontend `.tsx` / `.ts` / CSS | `sync` into `/app` | Next.js dev server |
| `backend/requirements.txt` | `rebuild` backend image | container recreate |
| `frontend/package.json` / lockfile | `rebuild` frontend image | container recreate |
| `frontend/next.config.ts`, `tsconfig.json` | `sync+restart` | Next.js restart |
| `backend/.env`, `frontend/.env.local` | `sync+restart` | service restart |

`node_modules` and `.next` stay inside the image; only application source is synced. Frontend watch rules target source directories (`app/`, `components/`, etc.) rather than the whole `frontend/` tree so macOS file watchers do not traverse `node_modules`.

### Troubleshooting watch on macOS

If `docker compose watch` exits immediately with:

```text
notify.Add(".../frontend"): ... node_modules/...: too many open files
```

Compose is registering watchers on `node_modules`. The dev compose file avoids that by syncing source subdirectories only. If you still hit the limit:

1. Ensure you are on the current `docker-compose.dev.yml` (not an older single-path `./frontend` watch rule).
2. Upgrade Docker Compose to **v5.0.2+** (Docker Desktop 4.58+). Compose **v5.0.1** on macOS shipped without `fsevents` and walks ignored folders anyway.
3. As a last resort before starting watch: `ulimit -n 65536`

Then restart:

```bash
docker compose -f docker-compose.dev.yml watch
```

### Useful dev commands

```bash
docker compose -f docker-compose.dev.yml logs -f backend
docker compose -f docker-compose.dev.yml logs -f frontend
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml down
```

Run migrations after pulling new revisions:

```bash
docker compose -f docker-compose.dev.yml exec backend python -c "from db.session import init_db; init_db()"
```

The dev backend entrypoint uses the same `init_db()` path as the API on startup. On a fresh database it creates the full schema and stamps Alembic to `head`; on an existing Alembic-managed database it runs `upgrade head`.

Generate a migration from a running backend container:

```bash
docker compose -f docker-compose.dev.yml exec backend alembic revision --autogenerate -m "describe_change"
```

Optional workers (separate terminals):

```bash
docker compose -f docker-compose.dev.yml exec backend python -m app.workers.live_market_data
docker compose -f docker-compose.dev.yml exec backend python -m app.workers.alert_evaluator
docker compose -f docker-compose.dev.yml exec backend python -m app.workers.alert_delivery
docker compose -f docker-compose.dev.yml exec backend python -m app.workers.broker_chat
```

### Windows notes

Compose Watch syncs files into Linux containers instead of bind-mounting the whole repo, which is usually more reliable than host mounts on Windows. If a change is not picked up, save the file again or restart with `docker compose -f docker-compose.dev.yml watch`.

If the backend container restarts repeatedly during first boot, check `docker compose -f docker-compose.dev.yml logs backend`. A failed migration on a partially created database can usually be fixed by stopping Compose, deleting `backend/data/app.db` (and any `app.db-*` journal files), and starting again.

```bash
docker compose -f docker-compose.dev.yml down
rm -f backend/data/app.db backend/data/app.db-*
docker compose -f docker-compose.dev.yml watch
```

For the fastest edit-run loop on Windows, the [native setup](#requirements) below is still preferred.

### Dev vs production Compose

| | `docker-compose.dev.yml` | `docker-compose.yml` |
|--|--------------------------|----------------------|
| Purpose | Hot-reload development | Self-hosted / production-like runs |
| Frontend | `next dev` | Built Next.js standalone |
| Backend | `uvicorn --reload` | `uvicorn` (no reload) |
| Redis | No password | Password from bootstrap volume |
| Secrets | `.env.dev` (+ optional per-app env files) | Generated config volume |
| Data | `backend/data/` on host | Docker named volume |

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
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

If you run the backend on a non-default port, change only `NEXT_PUBLIC_API_BASE_URL`; Next.js server actions use that same value unless `MARKET_STACK_API_INTERNAL_URL` is explicitly set.

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

The frontend talks to the backend through `NEXT_PUBLIC_API_BASE_URL`. In Docker, server-side frontend calls use `http://backend:8000/api/v1` automatically while browser-facing websocket/testing URLs use `NEXT_PUBLIC_API_BASE_URL` by default.

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
