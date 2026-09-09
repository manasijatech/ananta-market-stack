"""Load Agent Skills from shipped/enterprise markdown + optional DB overrides."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

SKILL_BODY_MAX_CHARS = 12_000
SKILL_CATALOG_MAX_CHARS = 2_000
SKILL_AUTO_LOAD_MAX = 2
SESSION_INSTRUCTIONS_MAX_CHARS = 4_000

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.S)
_URL_RE = re.compile(r"https?://[^\s)>\]]+", re.I)

_SHIPPED_DIR = Path(__file__).resolve().parent / "shipped"
_ENTERPRISE_DIR = Path(__file__).resolve().parent / "enterprise"


@dataclass
class SkillRecord:
    id: str
    name: str
    description: str
    version: int = 1
    tools: list[str] = field(default_factory=list)
    triggers: list[str] = field(default_factory=list)
    body: str = ""
    enabled: bool = True
    source: str = "shipped"  # shipped | enterprise | user
    path: str | None = None

    def catalog_entry(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "triggers": list(self.triggers),
            "tools": list(self.tools),
            "version": self.version,
            "source": self.source,
            "enabled": self.enabled,
        }


def _parse_markdown(path: Path, *, source: str) -> SkillRecord | None:
    raw = path.read_text(encoding="utf-8")
    match = _FRONTMATTER_RE.match(raw)
    if not match:
        return None
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return None
    if not isinstance(meta, dict):
        return None
    skill_id = str(meta.get("id") or path.stem).strip()
    if not skill_id:
        return None
    name = str(meta.get("name") or skill_id).strip()
    description = str(meta.get("description") or "").strip()
    tools_raw = meta.get("tools") or []
    triggers_raw = meta.get("triggers") or []
    tools = [str(t).strip() for t in tools_raw if str(t).strip()] if isinstance(tools_raw, list) else []
    triggers = [str(t).strip() for t in triggers_raw if str(t).strip()] if isinstance(triggers_raw, list) else []
    try:
        version = int(meta.get("version") or 1)
    except (TypeError, ValueError):
        version = 1
    body = (match.group(2) or "").strip()
    if len(body) > SKILL_BODY_MAX_CHARS:
        body = body[: SKILL_BODY_MAX_CHARS - 20] + "\n\n...[truncated]"
    return SkillRecord(
        id=skill_id,
        name=name,
        description=description,
        version=version,
        tools=tools,
        triggers=triggers,
        body=body,
        enabled=True,
        source=source,
        path=str(path),
    )


def _load_dir(directory: Path, *, source: str) -> dict[str, SkillRecord]:
    out: dict[str, SkillRecord] = {}
    if not directory.is_dir():
        return out
    for path in sorted(directory.glob("*.md")):
        record = _parse_markdown(path, source=source)
        if record:
            out[record.id] = record
    return out


def load_file_skills() -> dict[str, SkillRecord]:
    """Shipped then enterprise (enterprise overrides same id)."""
    skills = _load_dir(_SHIPPED_DIR, source="shipped")
    skills.update(_load_dir(_ENTERPRISE_DIR, source="enterprise"))
    return skills


def apply_db_overrides(
    skills: dict[str, SkillRecord],
    overrides: list[dict[str, Any]] | None,
) -> dict[str, SkillRecord]:
    """Apply user/org overrides. Later rows win. Same id replaces description/body/enabled."""
    if not overrides:
        return skills
    merged = {k: SkillRecord(**{**v.__dict__}) for k, v in skills.items()}
    for row in overrides:
        if not isinstance(row, dict):
            continue
        skill_id = str(row.get("skill_id") or row.get("id") or "").strip()
        if not skill_id:
            continue
        base = merged.get(skill_id)
        enabled = row.get("enabled")
        markdown = row.get("markdown")
        if base is None and not markdown:
            # Unknown id with only disable — skip
            continue
        if base is None:
            # User-authored skill from markdown
            parsed = _parse_override_markdown(skill_id, str(markdown or ""))
            if parsed:
                parsed.source = "user"
                if enabled is False:
                    parsed.enabled = False
                merged[skill_id] = parsed
            continue
        clone = SkillRecord(**{**base.__dict__})
        if enabled is False:
            clone.enabled = False
        elif enabled is True:
            clone.enabled = True
        if isinstance(markdown, str) and markdown.strip():
            parsed = _parse_override_markdown(skill_id, markdown)
            if parsed:
                clone.name = parsed.name or clone.name
                clone.description = parsed.description or clone.description
                clone.body = parsed.body or clone.body
                clone.tools = parsed.tools or clone.tools
                clone.triggers = parsed.triggers or clone.triggers
                clone.version = parsed.version or clone.version
                clone.source = "user"
        merged[skill_id] = clone
    return merged


def _parse_override_markdown(skill_id: str, markdown: str) -> SkillRecord | None:
    match = _FRONTMATTER_RE.match(markdown.strip())
    if match:
        try:
            meta = yaml.safe_load(match.group(1)) or {}
        except yaml.YAMLError:
            meta = {}
        body = (match.group(2) or "").strip()
    else:
        meta = {}
        body = markdown.strip()
    if not isinstance(meta, dict):
        meta = {}
    name = str(meta.get("name") or skill_id).strip()
    description = str(meta.get("description") or "").strip() or f"User skill {skill_id}"
    tools_raw = meta.get("tools") or []
    triggers_raw = meta.get("triggers") or []
    tools = [str(t).strip() for t in tools_raw if str(t).strip()] if isinstance(tools_raw, list) else []
    triggers = [str(t).strip() for t in triggers_raw if str(t).strip()] if isinstance(triggers_raw, list) else []
    try:
        version = int(meta.get("version") or 1)
    except (TypeError, ValueError):
        version = 1
    if len(body) > SKILL_BODY_MAX_CHARS:
        body = body[: SKILL_BODY_MAX_CHARS - 20] + "\n\n...[truncated]"
    return SkillRecord(
        id=skill_id,
        name=name,
        description=description,
        version=version,
        tools=tools,
        triggers=triggers,
        body=body,
        enabled=True,
        source="user",
    )


def resolve_skills(
    *,
    overrides: list[dict[str, Any]] | None = None,
    include_disabled: bool = False,
) -> dict[str, SkillRecord]:
    skills = apply_db_overrides(load_file_skills(), overrides)
    if include_disabled:
        return skills
    return {k: v for k, v in skills.items() if v.enabled}


def list_skill_catalog(
    *,
    overrides: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    skills = resolve_skills(overrides=overrides, include_disabled=False)
    # Stable order by id for prefix cache
    return [skills[k].catalog_entry() for k in sorted(skills.keys())]


def format_skill_catalog(entries: list[dict[str, Any]] | None = None) -> str:
    entries = entries if entries is not None else list_skill_catalog()
    lines = ["<agent_skills>"]
    for entry in entries:
        desc = str(entry.get("description") or "").replace("<", "").replace(">", "")
        name = str(entry.get("name") or entry.get("id") or "")
        sid = str(entry.get("id") or "")
        lines.append(f'  <skill id="{sid}" name="{name}">{desc}</skill>')
    lines.append("</agent_skills>")
    lines.append(
        "Call skill_load(id) to load a skill body when the user task matches. "
        "Do not invent tool names; only use tools listed in the skill and already attached."
    )
    text = "\n".join(lines)
    if len(text) > SKILL_CATALOG_MAX_CHARS:
        # Keep as many full entries as fit
        kept = ["<agent_skills>"]
        for entry in entries:
            chunk = (
                f'  <skill id="{entry.get("id")}" name="{entry.get("name")}">'
                f'{str(entry.get("description") or "").replace("<", "")}</skill>'
            )
            candidate = "\n".join(kept + [chunk, "</agent_skills>"])
            if len(candidate) > SKILL_CATALOG_MAX_CHARS - 120:
                break
            kept.append(chunk)
        kept.append("</agent_skills>")
        kept.append("Call skill_load(id) for full procedures. Catalog truncated.")
        text = "\n".join(kept)
    return text


def load_skill(
    skill_id: str,
    *,
    overrides: list[dict[str, Any]] | None = None,
    offset: int = 0,
) -> dict[str, Any]:
    skills = resolve_skills(overrides=overrides, include_disabled=True)
    record = skills.get(str(skill_id or "").strip())
    if record is None:
        return {"ok": False, "code": "unknown_skill", "message": f"Unknown skill id: {skill_id}"}
    if not record.enabled:
        return {"ok": False, "code": "skill_disabled", "message": f"Skill disabled: {skill_id}"}
    body = record.body or ""
    start = max(0, int(offset or 0))
    chunk = body[start : start + SKILL_BODY_MAX_CHARS]
    truncated = start + len(chunk) < len(body)
    return {
        "ok": True,
        "id": record.id,
        "name": record.name,
        "description": record.description,
        "version": record.version,
        "tools": record.tools,
        "triggers": record.triggers,
        "source": record.source,
        "offset": start,
        "truncated": truncated,
        "next_offset": start + len(chunk) if truncated else None,
        "body": chunk,
    }


def format_skill_body_message(records: list[SkillRecord]) -> str:
    if not records:
        return ""
    parts: list[str] = []
    for record in records:
        parts.append(
            f"[Loaded skill: {record.id} — {record.name}]\n"
            f"{record.body.strip()}\n"
            f"[End skill: {record.id}]"
        )
    return "\n\n".join(parts)


def _message_urls(text: str) -> list[str]:
    return [m.group(0) for m in _URL_RE.finditer(text or "")]


def _trigger_matches(trigger: str, message: str) -> bool:
    t = (trigger or "").strip()
    if not t:
        return False
    msg = message or ""
    lower = msg.lower()
    if t.lower().startswith("url:"):
        host = t[4:].strip().lower()
        if not host:
            return False
        for url in _message_urls(msg):
            try:
                parsed = urlparse(url)
                netloc = (parsed.netloc or "").lower()
            except Exception:
                continue
            if host in netloc or netloc.endswith("." + host):
                return True
        return False
    if t.lower().startswith("keyword:"):
        kw = t[8:].strip().lower()
        return bool(kw) and kw in lower
    # bare keyword
    return t.lower() in lower


def auto_match_skills(
    message: str,
    *,
    overrides: list[dict[str, Any]] | None = None,
    limit: int = SKILL_AUTO_LOAD_MAX,
) -> list[SkillRecord]:
    skills = resolve_skills(overrides=overrides, include_disabled=False)
    matched: list[SkillRecord] = []
    # Stable id order then first-match wins until cap
    for skill_id in sorted(skills.keys()):
        record = skills[skill_id]
        if any(_trigger_matches(tr, message) for tr in record.triggers):
            matched.append(record)
            if len(matched) >= max(1, int(limit)):
                break
    return matched
