from __future__ import annotations

from datetime import timezone

# Backport datetime.UTC for Python versions before 3.11.
UTC = timezone.utc
