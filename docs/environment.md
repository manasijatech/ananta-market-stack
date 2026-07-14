# Environment Reference

This page summarizes the main environment variables used by Ananta Market Stack. Most users should start with the root [.env.example](../.env.example) and only override values they need to change.

## Root Docker Compose Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRONTEND_PORT` | `3000` | Host port for the frontend container. |
| `BACKEND_PORT` | `8000` | Host port for the backend container. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Browser-facing frontend URL. |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | Browser-facing backend API base URL. |
| `MARKET_STACK_API_INTERNAL_URL` | `http://backend:8000/api/v1` in Docker Compose | Optional internal frontend-to-backend URL for server actions. |
| `APP_PUBLIC_BASE_URL` | `http://localhost:8000` | Backend public URL used by backend API links and fallback session flows. |
| `MCP_GOOGLE_DRIVE_OAUTH_CLIENT_ID` | empty | Optional Google OAuth client ID for one-click Google Drive MCP connect. |
| `MCP_GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` | empty | Optional Google OAuth client secret for one-click Google Drive MCP connect. |
| `MCP_SLACK_OAUTH_CLIENT_ID` | empty | Optional Slack OAuth client ID for one-click Slack MCP connect. |
| `MCP_SLACK_OAUTH_CLIENT_SECRET` | empty | Optional Slack OAuth client secret for one-click Slack MCP connect when your Slack app issues one. |
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
| `APP_PUBLIC_BASE_URL` | `http://localhost:8000` | Public backend URL for backend API links and fallback session flows. |
| `MCP_GOOGLE_DRIVE_OAUTH_CLIENT_ID` | empty | Optional Google OAuth client ID for one-click Google Drive MCP connect. Register the frontend callback URL `/api/mcp/oauth/callback`. |
| `MCP_GOOGLE_DRIVE_OAUTH_CLIENT_SECRET` | empty | Optional Google OAuth client secret for one-click Google Drive MCP connect. |
| `MCP_SLACK_OAUTH_CLIENT_ID` | empty | Optional Slack OAuth client ID for one-click Slack MCP connect. |
| `MCP_SLACK_OAUTH_CLIENT_SECRET` | empty | Optional Slack OAuth client secret for one-click Slack MCP connect when your Slack app issues one. |
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
| `DESKTOP_AUDIO_STORAGE_DIR` | `/data/alert-audio` in Docker, `./data/alert-audio` locally | Directory where generated desktop alert audio files are stored. |
| `DESKTOP_AUDIO_RETENTION_DAYS` | `15` | Number of days to retain generated desktop alert audio before maintenance deletes it. |
| `DESKTOP_AUDIO_PAIRING_TTL_SECONDS` | `300` | Lifetime for one-time desktop app pairing secrets. |

## Frontend Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTH_DATABASE_PATH` | `/data/app.db` in Docker | Better Auth SQLite database path. |
| `BETTER_AUTH_SECRET` | generated in Docker | Secret used to sign Better Auth state. |
| `BETTER_AUTH_URL` | `http://localhost:3000` | Auth base URL. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated trusted frontend origins. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Browser-facing frontend URL. |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000/api/v1` | Browser-facing backend API URL. |
| `MARKET_STACK_API_INTERNAL_URL` | `NEXT_PUBLIC_API_BASE_URL` locally, `http://backend:8000/api/v1` in Docker | Optional internal backend URL used by frontend server actions. |
| `MANASIJA_API_BASE_URL` | `https://developers.manasija.in` | Base URL for Manasija developer APIs. |
| `GITHUB_TOKEN` | empty | Optional server-side GitHub token for fetching stargazer profiles in the top bar. Star count still works without it. |

`MARKET_STACK_PUBLIC_APP_URL` and `MARKET_STACK_PUBLIC_API_BASE_URL` are still accepted as compatibility aliases, but new installs should prefer `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_API_BASE_URL`.

## Broker Callback URLs

Broker session flows often require an exact callback or redirect URL in the broker developer console. In Ananta Market Stack, broker browser callbacks terminate at the Next.js frontend first, then the frontend calls the relevant backend session exchange.

Deployment shape matters:

- Docker Compose usually exposes frontend and backend separately. Broker browser callback URLs should still point to the frontend domain.
- The published Docker image and Railway deployment expose one public app domain and proxy `/api/v1` internally, so broker callbacks, auth URLs, and browser API traffic should use the same app domain.

Use these broker-facing callback URLs:

```text
Zerodha redirect URL: <NEXT_PUBLIC_APP_URL>/broker-connections
Upstox OAuth redirect URI: <NEXT_PUBLIC_APP_URL>/broker-connections
Upstox notifier webhook: <NEXT_PUBLIC_APP_URL>/api/broker-callbacks/upstox/notifier
```

The Upstox OAuth redirect URI must also be saved in the Ananta Market Stack Upstox broker account. It must match the broker console value exactly.

For local Docker Compose:

```env
APP_PUBLIC_BASE_URL=http://localhost:8000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
```

Broker console values for local Docker Compose:

```text
Zerodha redirect URL: http://localhost:3000/broker-connections
Upstox OAuth redirect URI: http://localhost:3000/broker-connections
Upstox notifier webhook: http://localhost:3000/api/broker-callbacks/upstox/notifier
```

For production, use your real backend domain:

```env
APP_PUBLIC_BASE_URL=https://your-backend-domain.example
NEXT_PUBLIC_APP_URL=https://your-frontend-domain.example
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.example/api/v1
```

Broker console values for split-domain production:

```text
Zerodha redirect URL: https://your-frontend-domain.example/broker-connections
Upstox OAuth redirect URI: https://your-frontend-domain.example/broker-connections
Upstox notifier webhook: https://your-frontend-domain.example/api/broker-callbacks/upstox/notifier
```

For the published Docker image, the frontend and backend share one public port. Use the frontend domain for auth variables and leave browser API traffic on the built-in relative path:

```env
NEXT_PUBLIC_APP_URL=https://your-app-domain.example
BETTER_AUTH_URL=https://your-app-domain.example
APP_PUBLIC_BASE_URL=https://your-app-domain.example
NEXT_PUBLIC_API_BASE_URL=/api/v1
MARKET_STACK_API_INTERNAL_URL=http://127.0.0.1:8000/api/v1
```

The published image includes an internal reverse proxy so `/api/v1` supports normal HTTP requests and browser websocket upgrades on the same public domain.

Broker console values for the published Docker image and Railway:

```text
Zerodha redirect URL: https://your-app-domain.example/broker-connections
Upstox OAuth redirect URI: https://your-app-domain.example/broker-connections
Upstox notifier webhook: https://your-app-domain.example/api/broker-callbacks/upstox/notifier
```

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
