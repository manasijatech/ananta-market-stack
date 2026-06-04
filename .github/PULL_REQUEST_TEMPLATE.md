## Summary

<!-- What changed and why? Link issues with "Fixes #123" when applicable. -->

Fixes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation only

## Checks run

Mark what you ran locally (see [CONTRIBUTING.md](../CONTRIBUTING.md)):

- [ ] Backend: `alembic upgrade head` (if models/migrations changed)
- [ ] Backend: `python -m compileall -q app broker` (or touched modules)
- [ ] Frontend: `npm run lint`
- [ ] Frontend: `npm run build` (if frontend changed)
- [ ] Docker smoke test (if Docker/runtime changed)
- [ ] Could not run some checks (explain below)

## Screenshots / recordings

<!-- Required for meaningful UI changes -->

## Security, migrations, and ops

- [ ] No secrets, tokens, `.env`, or database files committed
- [ ] Alembic migration included and reviewed (if schema changed)
- [ ] Security-sensitive change explained below (auth, credentials, Redis, encryption)

**Notes:**

<!-- Setup impact, env var changes, broker flow changes, Windows compat, etc. -->
