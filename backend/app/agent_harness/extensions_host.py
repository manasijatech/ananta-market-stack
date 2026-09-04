"""OSS compatibility hook for enterprise typed extensions (Plan 09).

The self-hosted edition never imports a sandbox executor or user-supplied code.
Keeping this hook stable lets the shared Chat runner remain merge-safe.
"""

from __future__ import annotations

from typing import Any


def extra_tools(context: Any) -> list[Any]:
    return []
