"""Shared Plan 09 manifest constants; OSS deliberately has no executable registry."""

from __future__ import annotations

from typing import Any

ALLOWED_KINDS = frozenset({"tool", "skill", "hook", "shortcut"})
ALLOWED_EVAL_STATUS = frozenset({"draft", "passed", "failed", "enabled"})


class ManifestError(ValueError):
    pass


def parse_manifest(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate only the portable contract; executable tool registration is enterprise-only."""
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not raw["id"].strip():
        raise ManifestError("manifest id is required")
    if raw.get("kind") not in ALLOWED_KINDS:
        raise ManifestError("manifest kind is invalid")
    if raw.get("eval_status", "draft") not in ALLOWED_EVAL_STATUS:
        raise ManifestError("manifest eval_status is invalid")
    return dict(raw)
