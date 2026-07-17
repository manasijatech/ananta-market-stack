# Published Docker Image

Ananta Market Stack can be distributed as a single Docker image for small self-hosted deployments and platform hosts such as Railway.

The image runs:

- Next.js frontend on public port `3000` or `$PORT`.
- FastAPI backend internally on `127.0.0.1:8000`.
- SQLite at `/data/app.db`.
- Generated runtime secrets at `/data/config/ananta-market-stack.env`.
- Redis, started automatically by default.

No production secrets are baked into the image.

The container itself is disposable. Persistent state lives in the `/data` mount, including SQLite, generated auth/encryption secrets, and bundled Redis data. Normal updates replace the container but reuse the same `/data` volume.

## Run Locally Or On A VPS

```bash
docker run -d \
  --name ananta-market-stack \
  --restart unless-stopped \
  -p 3000:3000 \
  -v ananta-market-stack-data:/data \
  ghcr.io/manasijatech/ananta-market-stack:latest
```

Open:

```text
http://localhost:3000
```

If a container named `ananta-market-stack` already exists, Docker will refuse to create another one with the same name. Update by stopping and removing the old container, then starting a new one with the same `ananta-market-stack-data:/data` volume. See [Updating](#updating).

## Runtime Secrets

On first boot, the container creates `/data/config/ananta-market-stack.env` with:

- `CREDENTIAL_ENCRYPTION_KEY`
- `BETTER_AUTH_SECRET`
- `REDIS_PASSWORD` when bundled Redis is used

Existing values are preserved on later boots. If the host provides any of these variables, the provided values are used.

Back up `/data/app.db` and `/data/config/ananta-market-stack.env` together. Losing or changing `CREDENTIAL_ENCRYPTION_KEY` makes existing encrypted broker credentials unreadable.

## Railway

Railway uses the same published image, but the public URL variables are important. Without them, auth redirects, trusted origins, broker callback URLs, and same-domain `/api/v1` routing may not match the Railway domain.

Use the published image:

```text
ghcr.io/manasijatech/ananta-market-stack:latest
```

Set:

```env
PORT=3000
NEXT_PUBLIC_APP_URL=https://your-railway-domain
APP_PUBLIC_BASE_URL=https://your-railway-domain
BETTER_AUTH_URL=https://your-railway-domain
BETTER_AUTH_TRUSTED_ORIGINS=https://your-railway-domain
NEXT_PUBLIC_API_BASE_URL=/api/v1
MARKET_STACK_API_INTERNAL_URL=http://127.0.0.1:8000/api/v1
```

Add a persistent volume mounted at:

```text
/data
```

That is enough for the normal Railway setup. Ananta Market Stack will generate its own secrets, start Redis automatically, and route `/api/v1` traffic through the same public app domain.

Broker developer-console URLs should use the same Railway app domain:

```text
Zerodha redirect URL: https://your-railway-domain/broker-connections
Upstox OAuth redirect URI: https://your-railway-domain/broker-connections
Upstox notifier webhook: https://your-railway-domain/api/broker-callbacks/upstox/notifier
```

For the variable meanings and broker callback notes, see [environment.md](environment.md#broker-callback-urls).

## Advanced Redis

The bundled Redis process is the default and is the simplest option for self-hosting. If you already operate Redis separately, or if your hosting platform requires a separate Redis service, set:

```env
REDIS_URL=${{ Redis.REDIS_URL }}
```

When `REDIS_URL` is set, Ananta Market Stack uses that Redis instance instead of starting the bundled Redis process.

On a Linux Docker host, Redis may warn that memory overcommit is disabled. Enable it once on the host so background AOF/RDB persistence remains reliable:

```bash
sudo sysctl -w vm.overcommit_memory=1
echo 'vm.overcommit_memory=1' | sudo tee /etc/sysctl.d/99-ananta-market-stack-redis.conf
```

## Updating

Docker does not update a running container in place. Update by replacing the container while keeping the same `/data` volume.

If you are upgrading from the older `ghcr.io/manasijatech/market-stack` image, reuse your existing data volume and rename the generated secrets file once before starting the new container (replace `YOUR_DATA_VOLUME` with the volume you already use, for example `market-stack-data`):

```bash
docker run --rm -v YOUR_DATA_VOLUME:/data alpine sh -c 'mv /data/config/market-stack.env /data/config/ananta-market-stack.env 2>/dev/null || true'
```

```bash
docker pull ghcr.io/manasijatech/ananta-market-stack:latest
docker stop ananta-market-stack
docker rm ananta-market-stack
docker run -d \
  --name ananta-market-stack \
  --restart unless-stopped \
  -p 3000:3000 \
  -v ananta-market-stack-data:/data \
  ghcr.io/manasijatech/ananta-market-stack:latest
```

PowerShell:

```powershell
docker pull ghcr.io/manasijatech/ananta-market-stack:latest
docker stop ananta-market-stack
docker rm ananta-market-stack
docker run -d `
  --name ananta-market-stack `
  --restart unless-stopped `
  -p 3000:3000 `
  -v ananta-market-stack-data:/data `
  ghcr.io/manasijatech/ananta-market-stack:latest
```

This deletes only the old container. It does not delete the named Docker volume. Do not run `docker volume rm ananta-market-stack-data` unless you intentionally want to delete the database, generated secrets, and bundled Redis data.

Updates do not rotate secrets because secrets live in `/data/config/ananta-market-stack.env`.

The backend runs database migrations on startup. Before upgrading a real instance, back up the `/data` volume.

Create a quick backup before updating:

```bash
docker run --rm -v ananta-market-stack-data:/data -v "$(pwd)":/backup alpine tar czf /backup/ananta-market-stack-data-backup.tgz -C /data .
```

PowerShell:

```powershell
docker run --rm -v ananta-market-stack-data:/data -v ${PWD}:/backup alpine tar czf /backup/ananta-market-stack-data-backup.tgz -C /data .
```

## Publishing

The GitHub Actions workflow at `.github/workflows/publish-image.yml` builds `Dockerfile`, smoke-tests the container, and publishes multi-architecture images to GitHub Container Registry.

Tag behavior:

- Normal commits do not publish images.
- Manual workflow runs can publish a version such as `0.1.0`.
- Version tags such as `v0.1.0` publish `0.1.0`, `0.1`, `0`, and SHA tags.
- `latest` is published only when the manual workflow input `publish_latest` is enabled.
- Images are pushed to `ghcr.io/manasijatech/ananta-market-stack`.

## GitHub Release Flow

Use this when you want GitHub Actions to build and publish the image:

1. Merge the release-ready code.
2. Create a version tag from the release commit:

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. Wait for the `Publish Docker image` workflow to pass.
4. Confirm the image exists in GitHub Packages:

```text
ghcr.io/manasijatech/ananta-market-stack:latest
```

5. Use the `latest` tag in production instructions and Railway templates.

You can also run the workflow manually from GitHub Actions. Provide `version=0.1.0`. Enable `publish_latest` only when you intentionally want to move the `latest` tag.

## Local Publish Flow

Use this when you want to build and push from your own machine.

First log in to GHCR with a GitHub token that has package write access:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

Then publish:

```bash
scripts/publish-image.sh 0.1.0 ghcr.io/manasijatech/ananta-market-stack
```

The script builds the image, smoke-tests it locally, tags it as `0.1.0`, `0.1`, `0`, and `sha-<commit>`, then pushes those tags. To also move `latest`, run:

```bash
PUBLISH_LATEST=true scripts/publish-image.sh 0.1.0 ghcr.io/manasijatech/ananta-market-stack
```

Use the `latest` tag in user-facing Docker image instructions so new installs and updates pick up the current published image.
