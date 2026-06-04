# Security Policy

## Supported Versions

Security fixes are provided for the latest release tag and the current `main`
branch. Older tags may receive fixes at maintainer discretion depending on
severity and effort.

| Version | Supported |
| ------- | --------- |
| Latest tagged release | Yes |
| `main` | Yes |
| Older tags | Best effort |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately using one of these channels:

1. **Preferred:** [GitHub Private Security Advisories](https://github.com/manasijatech/ananta-market-stack/security/advisories/new)
2. **Alternative:** Contact repository maintainers through your existing private
   maintainer channel if you already have one.

Include:

- A clear description of the issue and impact
- Steps to reproduce, if applicable
- Affected components (frontend, backend, Docker image, broker integration, etc.)
- Your suggested fix or mitigation, if you have one

## What to Expect

- Acknowledgement within **5 business days** when possible
- A severity assessment and planned fix timeline
- Coordinated disclosure after a fix is available, when appropriate

## Out of Scope

The following are generally not treated as product vulnerabilities on their own:

- Missing hardening on intentionally local-only dev setups
- Issues that require a user to paste live broker secrets into a public issue
- Vulnerabilities in third-party broker APIs outside this repository's control

For operational security guidance (encryption keys, backups, production
hardening), see [docs/security.md](docs/security.md).

## Safe Disclosure Reminder

Never include broker API keys, passwords, PINs, TOTP secrets, session tokens,
Fernet keys, `.env` files, or database dumps in public issues or pull requests.
