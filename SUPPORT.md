# Support

Start with the docs that match what you are trying to do:

- Quick Docker start: [README.md](README.md)
- Production/self-hosting: [docs/self-hosting.md](docs/self-hosting.md)
- Development setup: [docs/development.md](docs/development.md)
- Environment variables: [docs/environment.md](docs/environment.md)
- API routes: [docs/api-overview.md](docs/api-overview.md)
- Security notes: [docs/security.md](docs/security.md)
- Broker auth flows: [backend/docs/broker_auth_flows.md](backend/docs/broker_auth_flows.md)

## Reporting Issues

When opening a GitHub issue, include:

- What you were trying to do.
- Your operating system.
- Whether you used Docker Compose or manual development setup.
- The command that failed.
- Relevant logs from `docker compose logs -f backend` or `docker compose logs -f frontend`.
- Any changed environment variables, with secrets removed.
- Broker name and flow involved, if the issue is broker-specific.

Do not paste broker API secrets, passwords, PINs, TOTP secrets, session tokens, generated Fernet keys, Redis passwords, `.env` files, or SQLite database contents into public issues.

## Hosted API Resources

The hosted developer resources are:

- [Manasija developer portal](https://developers.manasija.in)
- [API docs](https://developers.manasija.in/docs)
- [API key registration](http://platform.manasija.in/)

These are optional for normal local self-hosting unless a feature you enable specifically depends on the hosted API.
