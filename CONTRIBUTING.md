# Contributing

Thanks for helping improve Ananta Market Stack. This project combines a Next.js frontend, FastAPI backend, broker integrations, encrypted credential handling, Redis-backed workflows, and local/self-hosted deployment support. Small, focused changes are easier to review and safer for users.

## Start Here

1. Read the [development setup](docs/development.md).
2. Create a branch for your change.
3. Keep the change focused on one feature, bug fix, or docs improvement.
4. Run the relevant checks before opening a pull request.

## Local Checks

Backend:

```bash
cd backend
.venv/bin/python -m py_compile app/main.py
.venv/bin/alembic current
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

Use the checks that match the files you changed. If a check cannot be run because a dependency, broker credential, Redis instance, or API key is unavailable, mention that in the pull request.

## Pull Request Expectations

- Explain what changed and why.
- Include screenshots for UI changes when useful.
- Mention any setup, migration, or environment impact.
- Do not include unrelated formatting churn.
- Do not commit `.env`, `.env.local`, SQLite databases, generated secrets, broker tokens, API keys, or local cache files.
- Leave `CREDENTIAL_ENCRYPTION_KEY` empty in `.env.example`; use comments with a generate command instead of sample Fernet keys (scanners flag them as leaks).
- Expect maintainers to merge changes. Contributors should open pull requests rather than pushing directly to `main`.

## Backend Changes

For API, broker, auth, session, alert, or database work:

- Preserve encrypted credential handling.
- Keep official broker auth/session flows first-class.
- Treat web-login automation as optional and broker-specific.
- Add or update Alembic migrations for schema changes.
- Review [backend/docs/migrations.md](backend/docs/migrations.md) before changing models.
- Follow [backend/docs/windows_runtime_compat.md](backend/docs/windows_runtime_compat.md) for datetime imports, asyncio timeout handling, and platform-specific dependency behavior.

## Frontend Changes

For UI work:

- Keep setup and broker workflows clear for less technical users.
- Prefer existing components and app conventions.
- Make environment and callback URL requirements explicit where users need them.
- Keep developer/API links useful but secondary to the self-hosted project flow.

## Documentation Changes

The root README should stay short and discovery-focused. Put detailed setup, production, environment, API, and security material in the relevant file under `docs/`.

When adding docs:

- Prefer relative links for repository files.
- Keep commands aligned with `docker-compose.yml`, `.env.example`, backend requirements, and frontend package scripts.
- Use collapsible sections for long optional platform-specific details.

## Security-Sensitive Changes

If your change touches broker credentials, session tokens, auth state, Redis, secret generation, encryption, or API key handling, explain the security impact in the pull request. Avoid logging secrets or returning raw stored credentials from APIs.
