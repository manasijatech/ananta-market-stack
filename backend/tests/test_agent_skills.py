"""Plan 07 — Agent Skills loader / catalog / triggers."""

from app.agent_harness.skills import (
    auto_match_skills,
    format_skill_catalog,
    list_skill_catalog,
    load_skill,
    resolve_skills,
)
from app.agent_harness.skills.loader import apply_db_overrides, load_file_skills


def test_catalog_excludes_bodies():
    entries = list_skill_catalog()
    assert entries
    ids = {e["id"] for e in entries}
    assert "screener-page" in ids
    assert "session-recall" in ids
    catalog = format_skill_catalog(entries)
    assert "<agent_skills>" in catalog
    assert "Call skill_load" in catalog
    # Bodies must not appear in catalog
    assert "Open the pasted page" not in catalog
    assert "---" not in catalog


def test_screener_url_auto_loads_once():
    matched = auto_match_skills(
        "Please read https://www.screener.in/company/INFY/consolidated/ for Infosys fundamentals"
    )
    assert len(matched) >= 1
    assert matched[0].id == "screener-page"
    assert len(matched) <= 2


def test_unknown_skill_load_errors():
    result = load_skill("not-a-real-skill-id")
    assert result["ok"] is False
    assert result["code"] == "unknown_skill"


def test_user_override_replaces_description():
    base = load_file_skills()
    assert "screener-page" in base
    overrides = [
        {
            "skill_id": "screener-page",
            "enabled": True,
            "markdown": (
                "---\n"
                "id: screener-page\n"
                "name: Screener page (user)\n"
                "description: Use when user override description.\n"
                "version: 2\n"
                "---\n\n"
                "User body only."
            ),
        }
    ]
    merged = apply_db_overrides(base, overrides)
    assert merged["screener-page"].description.startswith("Use when user override")
    assert merged["screener-page"].body.startswith("User body")
    assert merged["screener-page"].source == "user"


def test_disabled_skill_absent_from_catalog():
    overrides = [{"skill_id": "open-web-news", "enabled": False}]
    entries = list_skill_catalog(overrides=overrides)
    ids = {e["id"] for e in entries}
    assert "open-web-news" not in ids
    # Still resolvable when include_disabled for admin
    all_skills = resolve_skills(overrides=overrides, include_disabled=True)
    assert all_skills["open-web-news"].enabled is False
    loaded = load_skill("open-web-news", overrides=overrides)
    assert loaded["ok"] is False
    assert loaded["code"] == "skill_disabled"


def test_skill_load_returns_body():
    result = load_skill("desk-canvas")
    assert result["ok"] is True
    assert "Chat answers first" in result["body"]
    assert result["truncated"] is False
