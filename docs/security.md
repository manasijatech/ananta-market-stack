# Security Notes

Ananta Market Stack can store broker credentials, broker session tokens, auth state, and alert delivery configuration. Treat the deployment as sensitive infrastructure.

## Credential Encryption

Broker credentials are encrypted at rest with Fernet using `CREDENTIAL_ENCRYPTION_KEY`.

Important behavior:

- Losing `CREDENTIAL_ENCRYPTION_KEY` makes existing encrypted broker secrets unreadable.
- Rotating `CREDENTIAL_ENCRYPTION_KEY` requires a deliberate migration plan.
- Anyone with both the SQLite database and the encryption key can decrypt stored broker secrets.
- `ALLOW_INSECURE_DEV_CREDENTIALS=true` is only for throwaway local development. It uses a deterministic key derived in code, not a value from the repository.
- Do not put real Fernet keys in `.env.example`, docs, or tests. Secret scanners treat any valid-looking Fernet string as a leak, even in examples.

If GitGuardian or GitHub secret scanning reported a Fernet key in this repository, it was almost certainly from `backend/.env.example` (a sample key committed since the first backend import) or the old hard-coded dev fallback in `backend/broker/crypto.py` — not from `docker build` or `docker push`. Image builds generate secrets at container start into `/data/config/` and do not publish them to GitHub.

If you ever copied the old `.env.example` key into production, generate a new `CREDENTIAL_ENCRYPTION_KEY`, update your config volume or `.env`, and re-enter broker credentials (existing ciphertext cannot be decrypted with a new key).

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
- Set `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `NEXT_PUBLIC_APP_URL`, and `NEXT_PUBLIC_API_BASE_URL` to real production domains.
- Keep backend access private unless browser-facing websocket features require a public backend URL.
- Restrict access with normal infrastructure controls such as firewall rules, reverse proxy policy, RBAC, and secret management.
- Back up data and config volumes before updates or secret rotation.
- Review logs before sharing them publicly; logs may contain identifiers or operational context.

See [self-hosting.md](self-hosting.md) for Docker setup, updates, backups, and troubleshooting.
