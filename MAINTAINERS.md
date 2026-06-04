# Maintainer Guide

This document is for repository owners and maintainers who manage access,
protected branches, package publishing, and releases.

## Access Model

Recommended roles:

| Role | Who | Permissions |
| ---- | --- | ----------- |
| Organization owners | Smallest possible set | Org settings, billing, security, package visibility |
| Repository admins | Core maintainers (`@TechManasija`, `@Shaunfurtado`) | Repo settings, environments, merges when allowed |
| Contributors | Everyone else | Fork, branch, open pull requests — no direct push to `main` |
| Triage helpers | Optional | Label issues and manage discussions without pushing code |
| Trusted implementers | Rare | `Write` only when you accept branch pushes; still protect `main` |

For normal open source contribution, keep the repository **public** and rely on
pull requests plus branch protection instead of granting broad write access.

## Protect `main`

Use a repository ruleset or branch protection rule for `main`.

Recommended settings:

- Require a pull request before merging
- Require at least **one** approval
- Require review from **Code Owners** (see [.github/CODEOWNERS](.github/CODEOWNERS))
- Dismiss stale approvals when new commits are pushed
- Require conversation resolution before merge
- Block force pushes and branch deletion
- Restrict bypass to the smallest maintainer set
- Allow only maintainers (or a maintainer team) to merge pull requests

If only two accounts should merge to `main`, put them in a **@manasijatech/maintainers**
team and use that team for merge rights and environment approvals.

## Required CI Checks

After merging [`.github/workflows/ci.yml`](.github/workflows/ci.yml), require these
status checks on `main` before merge:

- `Backend checks`
- `Frontend checks`

Path: **Settings → Branches → Branch protection rules** (or **Rules → Rulesets**)
→ enable **Require status checks to pass**.

## Package Publishing

The **Publish Docker image** workflow does **not** run on ordinary `main` commits.
It runs only when:

- A version tag such as `v0.1.0` is pushed, or
- A maintainer manually runs the workflow from GitHub Actions

The workflow uses the `package-publish` environment. Configure required reviewers:

1. Open repository **Settings**
2. Go to **Environments**
3. Create or open `package-publish`
4. Add required reviewers (maintainers team or named accounts)
5. Save

Even if a collaborator can trigger the workflow, publishing should wait for an
approved deployment to `package-publish`.

Local publishing (authorized accounts only):

```bash
scripts/publish-image.sh 0.1.0 ghcr.io/manasijatech/ananta-market-stack
```

See [docs/docker-image.md](docs/docker-image.md) for full publishing details.

## Versioning

Use semantic version tags:

- `v0.1.0` for the first public preview
- `v0.1.1` for patch fixes
- `v0.2.0` for compatible feature additions
- `v1.0.0` when you are ready for a stronger compatibility promise

Prefer pinned image tags in docs and deployment templates:

```text
ghcr.io/manasijatech/ananta-market-stack:0.1.0
```

Use `latest` only for testing or explicitly floating deployments.

## Package Visibility

Images publish to:

```text
ghcr.io/manasijatech/ananta-market-stack
```

Keep the GHCR package **public** if users should run `docker pull` without GitHub
authentication. Keep it private only when every consumer must `docker login ghcr.io`.

## Review Expectations

- Small, focused pull requests merge faster
- Security-sensitive changes need an explicit security note in the PR
- UI changes should include screenshots when useful
- Schema changes need Alembic migrations and a migration note in the PR

Contributor-facing workflow: [CONTRIBUTING.md](CONTRIBUTING.md).
