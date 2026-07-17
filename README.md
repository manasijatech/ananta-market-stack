# Ananta Market Stack

[![CI](https://github.com/manasijatech/ananta-market-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/manasijatech/ananta-market-stack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/manasijatech/ananta-market-stack)](LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/manasijatech/ananta-market-stack)](https://github.com/manasijatech/ananta-market-stack/issues)

Ananta Market Stack is a self-hosted trading and market-data workspace for connecting broker accounts, managing broker sessions, viewing portfolio data, fetching market data, and running user-owned alert workflows from one consistent UI and API.

It is built for people who want a practical local or self-hosted market workspace without wiring together every broker integration themselves. Developers can also use it as a FastAPI + Next.js reference implementation for broker account management, encrypted credential storage, market-data APIs, alerting, and broker-aware automation.

Resources: [Manasija](https://manasija.in/) | [Developer portal](https://developers.manasija.in) | [API docs](https://developers.manasija.in/docs) | [API key registration](http://platform.manasija.in/)

## What It Includes

- Next.js frontend with authentication, broker account setup, integration guides, portfolio views, quote workflows, alert management, and notification settings.
- FastAPI backend with broker account persistence, encrypted credential storage, session helpers, unified broker operations, alert APIs, SQLite, Alembic, and Redis-backed live workflows.
- Unified broker operations for profile, orders, trades, positions, holdings, funds, quotes, smart orders, close-all, and margin calculation where supported by the broker adapter.
- Published Docker image and Docker Compose setup for the frontend, backend, Redis, SQLite data, and generated local secrets.
- Broker setup guides rendered inside the app for Zerodha, Upstox, Angel, Dhan, Groww, INDmoney, and Kotak.

## Supported Brokers

- `angel`
- `dhan`
- `groww`
- `indmoney`
- `kotak`
- `upstox`
- `zerodha`

## Quick Start

### Fastest Docker Run

Run the published Ananta Market Stack image with one persistent data volume:

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

The image starts the frontend, backend, SQLite data store, generated runtime secrets, and Redis. Secrets are generated on first boot into `/data/config/ananta-market-stack.env`; they are not baked into the image.

To update this install later, pull the new image and recreate the container with the same `ananta-market-stack-data:/data` volume. Removing the container is safe; removing the volume deletes the database and generated secrets. See [published image updates](docs/docker-image.md#updating).

For Railway or similar platforms, deploy the same image, attach a persistent volume at `/data`, and set the required public URL environment variables. See the [Railway setup](docs/docker-image.md#railway) and [published-image environment notes](docs/environment.md#broker-callback-urls) before deploying; auth, redirects, and broker callbacks depend on these values matching your public domain.

### Build From Source

For source builds and contributor workflows, install [Docker](https://docs.docker.com/get-docker/) with [Docker Compose](https://docs.docker.com/compose/), then run:

```bash
git clone https://github.com/manasijatech/ananta-market-stack.git
cd ananta-market-stack
docker compose up -d --build
```

Open:

```text
http://localhost:3000
```

The default Docker stack starts:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- API base: `http://localhost:8000/api/v1`
- Redis: bundled inside the Compose network
- SQLite data and generated secrets: Docker named volumes

Optional local overrides can be set with:

```bash
cp .env.example .env
```

Useful commands:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose ps
docker compose down
```

Use `docker compose down -v` only when you intentionally want to delete Docker-managed SQLite data, Redis data, and generated secrets.

## Documentation

- [Published Docker image](docs/docker-image.md) - fastest single-image setup, Railway settings, safe updates, backups, and manual/GitHub publishing.
- [Self-hosting guide](docs/self-hosting.md) - source/Compose setup, production domains, generated secrets, Redis, backups, and troubleshooting.
- [Environment reference](docs/environment.md) - required domain/auth/API variables for Docker, Railway, broker callbacks, Redis, and hosted API settings.
- [Development setup](docs/development.md) - native or Docker Compose Watch dev, local env files, workers, migrations, and checks.
- [API overview](docs/api-overview.md) - route groups, local OpenAPI docs, and hosted API documentation links.
- [Security notes](docs/security.md) - encrypted broker credentials, secrets, backups, Redis, and production hardening.
- [Contributing](CONTRIBUTING.md) - contribution workflow, checks, migrations, and compatibility expectations.
- [Support](SUPPORT.md) - where to start when setup or runtime issues appear.
- [Security policy](SECURITY.md) - how to report vulnerabilities privately.
- [Code of Conduct](CODE_OF_CONDUCT.md) - community expectations.
- [Maintainers](MAINTAINERS.md) - branch protection, releases, and publishing (maintainers only).

## Project Layout

```text
ananta-market-stack/
  backend/       FastAPI app, broker integrations, services, database, workers
  frontend/      Next.js app, UI, auth, broker guides, server actions
  docs/          Public setup, self-hosting, environment, API, and security docs
  docker/        Compose bootstrap helpers
```

## Prerequisites

For the published Docker image path, you only need [Docker](https://docs.docker.com/get-docker/). For source builds, install Docker Compose as well.

For manual development, use:

- [Python](https://www.python.org/downloads/) 3.12 recommended for the backend.
- [Node.js](https://nodejs.org/) 24 for the frontend.
- [Redis](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/) for cached quotes, live alerting, stream coordination, and background workflows.

## Security At A Glance

Broker credentials are encrypted at rest with a Fernet `CREDENTIAL_ENCRYPTION_KEY`. In Docker, the key and other generated secrets are stored in a named config volume and preserved across rebuilds.

Back up the application data volume and config/secrets volume together. If the encryption key is lost or rotated without a migration plan, existing encrypted broker credentials cannot be decrypted.

For production, review the [published Docker image guide](docs/docker-image.md), [self-hosting guide](docs/self-hosting.md), and [security notes](docs/security.md) before exposing the app publicly.
