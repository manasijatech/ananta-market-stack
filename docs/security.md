# Security Notes

Ananta Market Stack can store broker credentials, broker session tokens, auth state, and alert delivery configuration. Treat the deployment as sensitive infrastructure.

## Credential Encryption

Broker credentials are encrypted at rest with Fernet using `CREDENTIAL_ENCRYPTION_KEY`.

Important behavior:

- Losing `CREDENTIAL_ENCRYPTION_KEY` makes existing encrypted broker secrets unreadable.
- Rotating `CREDENTIAL_ENCRYPTION_KEY` requires a deliberate migration plan.
- Anyone with both the SQLite database and the encryption key can decrypt stored broker secrets.
- `ALLOW_INSECURE_DEV_CREDENTIALS=true` is only for throwaway local development.

## Docker Secrets

Docker Compose stores generated secrets in the `ananta-market-stack_ananta_market_stack_config` volume. This includes:

- `CREDENTIAL_ENCRYPTION_KEY`
- `BETTER_AUTH_SECRET`
- `REDIS_PASSWORD`

The config volume is preserved across rebuilds. Root `.env` values seed those secrets only on first run unless you deliberately reset the config volume.

## Backups

Back up these volumes together:

- `ananta-market-stack_backend_data`
- `ananta-market-stack_ananta_market_stack_config`

The backend data volume contains SQLite application data. The config volume contains the key needed to decrypt broker credentials in that data.

Do not treat a database backup as complete unless you also have the matching config/secrets backup.

## Auth And Sessions

`BETTER_AUTH_SECRET` signs auth state. Changing it can invalidate existing sessions.

Broker sessions may include short-lived tokens or broker-specific auth material. Do not print, paste, or commit broker tokens, app secrets, passwords, PINs, TOTP secrets, generated session files, SQLite databases, or `.env` files.

Broker web-login automation, where available, should be treated as optional and broker-specific. Official redirect/session flows remain the safer baseline. See [backend/docs/broker_auth_flows.md](../backend/docs/broker_auth_flows.md).

## Redis

Redis is used for quote snapshots, live alert workflows, stream coordination, and broker chat queue/event fanout.

For production:

- Require a Redis password.
- Keep Redis private to the application network where possible.
- Use a managed or separately secured Redis deployment if your hosting environment requires it.
- Make sure app services and Redis agree on the same `REDIS_PASSWORD`.

## Production Hardening

Before exposing a self-hosted instance publicly:

- Use HTTPS for frontend and backend domains.
- Set `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, `MARKET_STACK_PUBLIC_APP_URL`, and backend API URL variables to real production domains.
- Keep backend access private unless browser-facing websocket features require a public backend URL.
- Restrict access with normal infrastructure controls such as firewall rules, reverse proxy policy, RBAC, and secret management.
- Back up data and config volumes before updates or secret rotation.
- Review logs before sharing them publicly; logs may contain identifiers or operational context.

See [self-hosting.md](self-hosting.md) for Docker setup, updates, backups, and troubleshooting.
