# Migrations

This repo now includes Alembic for schema tracking.

## Current model

- Alembic is the primary migration mechanism.
- The SQLite startup patcher in `db/session.py` is now only a compatibility fallback for legacy databases that do not yet have an `alembic_version` table.
- Once a database is stamped or upgraded under Alembic, runtime column patching is skipped.

## Commands

### Check current revision

```bash
./venv/bin/alembic current
```

### Stamp an existing database to the current baseline

Use this only if the database already has the current schema and you want Alembic to start managing it without replaying old DDL:

```bash
./venv/bin/alembic stamp head
```

### Create a new revision

```bash
./venv/bin/alembic revision -m "describe_change"
```

Or with autogenerate:

```bash
./venv/bin/alembic revision --autogenerate -m "describe_change"
```

### Apply migrations

```bash
./venv/bin/alembic upgrade head
```

## Project-specific notes

- The Alembic environment reads `DATABASE_URL` through `app.config.get_settings()`.
- The current baseline revision is `f5ed572aacd8`.
- The next schema revision adds the broker instrument cache tables:
  - `3b1f6d7c9a2e` for `broker_instruments` and `broker_instrument_sync_runs`
- The next schema revision after that adds the alerting workspace domain:
  - `8c4f2aa91d72` for alert templates, workflows, runs, live subscriptions, user alert notifications, user alert channels, and delivery records
- Existing local SQLite development databases can be stamped to that revision if they already contain the current schema.
- If a local SQLite database already contains runtime-patched tables but has not been Alembic-managed yet, do not run `upgrade head` against it blindly. Stamp it to the latest compatible revision first, then continue from there.

## Recommended workflow

1. Change SQLAlchemy models.
2. Generate an Alembic revision.
3. Review and edit the revision file carefully.
4. Run `alembic upgrade head`.
5. Start the app and verify.

Avoid relying on the runtime SQLite patcher for new schema work; it exists to keep older local databases from breaking while the project transitions to a proper migration workflow.
