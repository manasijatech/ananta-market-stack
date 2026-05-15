from __future__ import annotations

"""Shared datetime compatibility helpers.

Use `UTC` from this module instead of importing `UTC` directly from the stdlib
`datetime` module. `datetime.UTC` exists only on newer Python versions, while
this backend still needs to boot cleanly on Python 3.10 environments,
especially common Windows local setups.

Repo convention:
- `from common.datetime_compat import UTC`
- `datetime.now(tz=UTC)` for aware UTC timestamps
- convert to naive UTC explicitly only when persisting into SQLite columns that
  intentionally store naive UTC values
"""

from datetime import timezone

# Backport datetime.UTC for Python versions before 3.11.
UTC = timezone.utc
