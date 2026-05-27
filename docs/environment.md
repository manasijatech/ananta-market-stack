# Environment Reference

This page summarizes the main environment variables used by Market Stack. Most users should start with the root [.env.example](../.env.example) and only override values they need to change.

## Root Docker Compose Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRONTEND_PORT` | `3000` | Host port for the frontend container. |
| `BACKEND_PORT` | `8000` | Host port for the backend container. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Browser-facing frontend URL. |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | Browser-facing backend API base URL. |
| `MARKET_STACK_PUBLIC_APP_URL` | `http://localhost:3000` | Runtime-friendly public frontend URL for server-rendered flows. |
| `MARKET_STACK_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | Runtime-friendly public backend API URL. |
| `MARKET_STACK_API_INTERNAL_URL` | `http://backend:8000/api/v1` | Internal frontend-to-backend URL inside Docker Compose. |
| `APP_PUBLIC_BASE_URL` | `http://localhost:8000` | Backend public URL used by broker callback/session flows. |
| `CREDENTIAL_ENCRYPTION_KEY` | empty | Optional first-run seed for broker credential encryption. Generated if empty in Docker. |
| `BETTER_AUTH_SECRET` | empty | Optional first-run seed for auth signing. Generated if empty in Docker. |
| `REDIS_PASSWORD` | empty | Optional first-run seed for bundled Redis auth. Generated if empty in Docker. |
| `REDIS_HOST` | `redis` | Redis host for Compose. |
| `REDIS_PORT` | `6379` | Redis port. |
| `REDIS_DB` | `0` | Redis database index. |
| `REDIS_URL` | empty | Optional external Redis URL. Overrides host, port, password, DB, username, and TLS settings when set. |

## Backend Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./data/app.db` locally, `sqlite:////data/app.db` in Docker | SQLAlchemy database URL. |
| `APP_PUBLIC_BASE_URL` | `http://localhost:8000` | Public backend URL for broker callbacks and session flows. |
| `MANASIJA_API_BASE_URL` | `https://developers.manasija.in` | Base URL for Manasija developer APIs. |
| `REDIS_HOST` | `127.0.0.1` locally, `redis` in Docker | Redis host. |
| `REDIS_PORT` | `6379` | Redis port. |
| `REDIS_URL` | empty | Optional external Redis URL. Supports `redis://` and `rediss://`. |
| `REDIS_PASSWORD` | empty or generated | Redis password. |
| `REDIS_DB` | `0` | Redis database index. |
| `REDIS_QUOTE_TTL_SECONDS` | `30` | TTL for cached quote snapshots. |
| `CREDENTIAL_ENCRYPTION_KEY` | required unless dev fallback is enabled | Fernet key for encrypting broker credentials at rest. |
| `ALLOW_INSECURE_DEV_CREDENTIALS` | `false` | Dev-only fallback using an insecure built-in key. Do not enable in production. |
| `APP_DEBUG` | `false` | Backend debug mode. |
| `ENABLE_IN_PROCESS_ALERT_WORKERS` | `true` in Docker | Runs alert workers in the API process for simple installs. |
| `ENABLE_IN_PROCESS_ALPHA_WS_WORKER` | `true` in Docker | Runs the alpha websocket worker in process. |
| `ENABLE_IN_PROCESS_WATCHLIST_PRESET_WORKER` | `true` in Docker | Runs watchlist preset worker in process. |

## Frontend Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_DATABASE_PATH` | `/data/app.db` in Docker | Better Auth SQLite database path. |
| `BETTER_AUTH_SECRET` | generated in Docker | Secret used to sign Better Auth state. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Auth base URL. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated trusted frontend origins. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Browser-facing frontend URL. |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | Browser-facing backend API URL. |
| `MARKET_STACK_PUBLIC_APP_URL` | `http://localhost:3000` | Runtime-friendly public frontend URL. |
| `MARKET_STACK_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | Runtime-friendly public backend API URL. |
| `MARKET_STACK_API_INTERNAL_URL` | `http://backend:8000/api/v1` in Docker | Internal backend URL used by frontend server actions. |
| `MANASIJA_API_BASE_URL` | `https://developers.manasija.in` | Base URL for Manasija developer APIs. |

## Broker Callback URLs

Broker session flows often require the backend public URL to match the callback or redirect URL configured in the broker developer console.

Deployment shape matters:

- Docker Compose usually exposes frontend and backend separately, so callback/API URLs may point to the backend domain.
- The published Docker image and Railway deployment expose one public app domain and proxy `/api/v1` internally, so callback/auth URLs should use the same app domain.

For local Docker Compose:

```env
APP_PUBLIC_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
MARKET_STACK_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
```

For production, use your real backend domain:

```env
APP_PUBLIC_BASE_URL=https://your-backend-domain.example
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.example/api/v1
MARKET_STACK_PUBLIC_API_BASE_URL=https://your-backend-domain.example/api/v1
```

For the published Docker image, the frontend and backend share one public port. Use the frontend domain for auth variables and leave browser API traffic on the built-in relative path:

```env
NEXT_PUBLIC_APP_URL=https://your-app-domain.example
MARKET_STACK_PUBLIC_APP_URL=https://your-app-domain.example
BETTER_AUTH_URL=https://your-app-domain.example
APP_PUBLIC_BASE_URL=https://your-app-domain.example
NEXT_PUBLIC_API_BASE_URL=/api/v1
MARKET_STACK_PUBLIC_API_BASE_URL=/api/v1
MARKET_STACK_API_INTERNAL_URL=http://127.0.0.1:8000/api/v1
```

The published image includes an internal reverse proxy so `/api/v1` supports normal HTTP requests and browser websocket upgrades on the same public domain.

Railway uses the same shape as the published Docker image. Set the app-domain values in [docker-image.md#railway](docker-image.md#railway), mount a persistent volume at `/data`, and do not point browser API variables at `127.0.0.1`.

## Hosted API Links

The public developer portal is available at:

- `https://developers.manasija.in`
- `https://developers.manasija.in/docs`

API key registration is available at:

- `http://platform.manasija.in/`

These links are optional for local self-hosting unless a feature you enable specifically needs the hosted API.

## Unsafe Development Flags

`ALLOW_INSECURE_DEV_CREDENTIALS=true` is only for throwaway local development without a Fernet key. It should never be used in production or with real broker credentials.

Do not commit `.env`, `.env.local`, SQLite databases, generated secrets, broker tokens, API keys, or production Fernet keys.
