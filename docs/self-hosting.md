# Self-Hosting Ananta Market Stack

This guide covers the Docker-based path for running Ananta Market Stack as a self-hosted application. For local source development, use [development.md](development.md).

If you want the simplest prebuilt image flow for a VPS, Railway, or similar platform, use the [published Docker image guide](docker-image.md). That guide includes the single-container update flow and Railway environment variables. The Compose flow below is best when you want to build from source or develop locally.

## Recommended Docker Setup

From the repository root:

```bash
cp .env.example .env
docker compose up -d --build
```

Open the frontend at:

```text
http://localhost:3000
```

The default stack runs:

- Frontend on `http://localhost:3000`
- Backend on `http://localhost:8000`
- Backend API base at `http://localhost:8000/api/v1`
- Redis inside the Compose network as `redis:6379`
- SQLite and generated secrets in Docker named volumes

## Updating Safely

Normal updates do not delete application data or rotate generated secrets:

```bash
git pull
docker compose up -d --build
```

This rebuilds images and recreates containers if needed. Recreating containers is normal; persistent data is kept in Docker named volumes. It preserves:

- `ananta-market-stack_backend_data` - SQLite app database, backend data, and generated desktop alert audio under `/data/alert-audio`.
- `ananta-market-stack_ananta_market_stack_config` - generated `CREDENTIAL_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, and `REDIS_PASSWORD`.
- `ananta-market-stack_redis_data` - Redis append-only data.

Use this only for a complete local reset:

```bash
docker compose down -v
docker compose up --build
```

Do not run `docker compose down -v` on a real self-hosted instance unless you have backups.

For the published single-image install, do not use `docker compose`. Follow [published image updates](docker-image.md#updating): pull the new image, remove the old container, and start a new container with the same `/data` volume.

## Production Domains

For production domains, set these values before starting Compose:

```env
FRONTEND_PORT=3000
BACKEND_PORT=8000
BETTER_AUTH_URL=https://your-frontend-domain.example
BETTER_AUTH_TRUSTED_ORIGINS=https://your-frontend-domain.example
NEXT_PUBLIC_APP_URL=https://your-frontend-domain.example
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.example/api/v1
APP_PUBLIC_BASE_URL=https://your-backend-domain.example
```

Most HTTP API calls are made by the Next.js server. Docker Compose automatically uses `http://backend:8000/api/v1` for server-side calls. Browser websocket and testing traffic must enter through the public frontend origin at `/api/v1`; configure the public reverse proxy to forward `/api/v1` (including WebSocket upgrades) to FastAPI. The backend does not need to be exposed as a separate public service.

For Railway or the published single-image deployment, use the same public app domain for frontend, auth, and broker callbacks, and keep browser API traffic on `/api/v1`. See [Railway](docker-image.md#railway) and [Broker Callback URLs](environment.md#broker-callback-urls).

Broker browser redirects should point to the frontend callback page:

```text
Zerodha redirect URL: https://your-frontend-domain.example/broker-connections
Upstox OAuth redirect URI: https://your-frontend-domain.example/broker-connections
Upstox notifier webhook: https://your-frontend-domain.example/api/broker-callbacks/upstox/notifier
```

## Generated Secrets

The `bootstrap` service creates `/config/ananta-market-stack.env` in the `ananta-market-stack_ananta_market_stack_config` volume.

Secret behavior:

- If the config volume does not exist, `bootstrap` creates missing secrets.
- If root `.env` provides `CREDENTIAL_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, or `REDIS_PASSWORD` on first run, those values seed the generated config file.
- If root `.env` leaves them empty on first run, `bootstrap` generates secure random values.
- If `/config/ananta-market-stack.env` already exists, existing values are preserved.
- Changing root `.env` after first run does not rotate secrets.

Impact:

- `CREDENTIAL_ENCRYPTION_KEY` decrypts broker credentials stored in SQLite. Losing or changing it makes existing encrypted broker secrets unreadable.
- `BETTER_AUTH_SECRET` signs Better Auth state. Changing it can invalidate existing auth sessions.
- `REDIS_PASSWORD` protects the bundled Redis instance. Redis and app services must use the same value.

Inspect generated secret names without printing values:

```bash
docker compose exec backend sh -c "cut -d= -f1 /config/ananta-market-stack.env"
```

Inspect generated secrets directly only on your own trusted machine:

```bash
docker compose exec backend sh -c "cat /config/ananta-market-stack.env"
```

Treat that output like production credentials.

## Backups

Back up the backend data and config volumes together:

```bash
docker run --rm -v ananta-market-stack_backend_data:/data -v "$(pwd)":/backup alpine tar czf /backup/ananta-market-stack-backend-data.tgz -C /data .
docker run --rm -v ananta-market-stack_ananta_market_stack_config:/config -v "$(pwd)":/backup alpine tar czf /backup/ananta-market-stack-config.tgz -C /config .
```

On Windows Command Prompt, replace `"$(pwd)"` with `"%cd%"`.

## External Redis

The bundled Redis service is enough for simple self-hosting. If you use external Redis, set:

```env
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=your-redis-password
```

Then remove or ignore the bundled Redis service through your deployment-specific Compose override.

Redis is optional for basic broker CRUD and read-only data APIs, but required for production live alerting, workflow fanout, stream coordination, and broker chat queue/event fanout.

## Docker Startup Sequence

<details>
<summary>Full startup sequence</summary>

When you run `docker compose up --build`, Compose:

1. Reads `docker-compose.yml` and optional root `.env` overrides.
2. Builds the backend image from `backend/Dockerfile`.
3. Builds the frontend image from `frontend/Dockerfile`.
4. Creates the Docker network and named volumes.
5. Runs the one-shot `bootstrap` service.
6. Starts Redis after generated secrets exist.
7. Starts the backend after Redis is healthy.
8. Starts the frontend after the backend is healthy.

The backend uses SQLite at `/data/app.db` in the `ananta-market-stack_backend_data` volume. The frontend uses the same SQLite database for Better Auth so frontend auth users and backend users stay aligned.

Image rebuilds do not rotate secrets because secrets live in the named config volume, not inside the image.

</details>

## Inspecting Docker State

Show services:

```bash
docker compose ps
```

Show logs:

```bash
docker compose logs -f bootstrap
docker compose logs -f redis
docker compose logs -f backend
docker compose logs -f frontend
```

Check the SQLite database file:

```bash
docker compose exec backend sh -c "ls -lh /data/app.db"
```

Check Redis auth:

```bash
docker compose exec redis sh -c "REDIS_PASSWORD=\"$(awk -F= '$1 == \"REDIS_PASSWORD\" {sub(/^[^=]*=/, \"\"); print; exit}' /config/ananta-market-stack.env)\"; redis-cli -a \"$REDIS_PASSWORD\" ping"
```

List named volumes:

```bash
docker volume ls | grep ananta-market-stack
```

PowerShell:

```powershell
docker volume ls | Select-String ananta-market-stack
```

## Troubleshooting

<details>
<summary>Common Docker issues</summary>

If a container keeps restarting:

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
```

If Redis logs `Memory overcommit must be enabled`, enable it on the Docker host:

```bash
sudo sysctl -w vm.overcommit_memory=1
echo 'vm.overcommit_memory=1' | sudo tee /etc/sysctl.d/99-ananta-market-stack-redis.conf
```

This is host kernel configuration; changing it inside the application container is not sufficient. It prevents Redis background persistence from failing under memory pressure.

After replacing the application image, an already-open browser tab may briefly hold Server Action IDs from the previous Next.js build. Current images include deployment skew protection and should hard-reload automatically. For older images, perform one hard refresh after the container update.

If port `8000` is already used locally, set these in root `.env`:

```env
BACKEND_PORT=8004
NEXT_PUBLIC_API_BASE_URL=http://localhost:8004/api/v1
APP_PUBLIC_BASE_URL=http://localhost:8004
```

Then rebuild:

```bash
docker compose up --build
```

On Windows, this error usually means a shell entrypoint was checked out with Windows CRLF line endings:

```text
exec /usr/local/bin/ananta-market-stack-backend-entrypoint: no such file or directory
```

The Dockerfiles normalize entrypoint line endings during build. If you still see the error after updating the repo:

```powershell
docker compose down
docker compose build --no-cache backend frontend
docker compose up
```

Use `docker compose down` to stop services while preserving data. Use `docker compose down -v` only for a full reset.

</details>
