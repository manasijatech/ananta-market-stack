from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.services import adaptive_workspace_personalization as personalization
from db.models import User
from db.session import Base


def test_personalization_tables_are_on_the_metadata():
    tables = set(Base.metadata.tables)
    assert "adaptive_workspace_saved_desks" in tables
    assert "adaptive_workspace_preferences" in tables
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    existing = set(inspect(engine).get_table_names())
    assert "adaptive_workspace_saved_desks" in existing
    assert "adaptive_workspace_preferences" in existing


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_templates_and_skills_are_valid_workspace_specs():
    templates = personalization.list_templates()
    skills = personalization.list_skills()
    assert {item["id"] for item in templates} == {"investor", "trader", "researcher", "operations"}
    assert {item["id"] for item in skills} == {
        "morning-brief",
        "fno-desk",
        "earnings-week",
        "alert-studio",
        "research-sandbox",
    }
    for item in templates + skills:
        assert item["spec"]["version"] == "1"
        assert item["spec"]["layout"]["columns"] == 12
        assert item["spec"]["components"]


def test_named_desks_and_deletable_preferences():
    db = _db()
    db.add(User(id="desk-user", display_name="Desk"))
    db.commit()
    template = personalization.get_template("investor")
    saved = personalization.save_desk(db, "desk-user", "My investor desk", template["spec"])
    assert saved["name"] == "My investor desk"
    assert saved["valid"] is True

    renamed = personalization.rename_saved_desk(db, "desk-user", saved["id"], "Core book")
    assert renamed["name"] == "Core book"
    assert len(personalization.list_saved_desks(db, "desk-user")) == 1

    pref = personalization.upsert_preference(db, "desk-user", "density", "compact")
    assert pref["key"] == "density"
    assert pref["value"] == "compact"
    assert pref["deletable"] is True
    keys = {item["key"] for item in personalization.list_preferences(db, "desk-user")}
    assert "density" in keys
    personalization.delete_preference(db, "desk-user", "density")
    assert personalization.list_preferences(db, "desk-user") == []

    personalization.record_request_intents(db, "desk-user", ["watchlist"])
    keys = {item["key"] for item in personalization.list_preferences(db, "desk-user")}
    assert "request_intent_counts" not in keys

    personalization.delete_saved_desk(db, "desk-user", saved["id"])
    assert personalization.list_saved_desks(db, "desk-user") == []


def test_suggestions_require_repeated_requests_and_never_auto_apply():
    db = _db()
    db.add(User(id="desk-user", display_name="Desk"))
    db.commit()
    first = personalization.record_request_intents(db, "desk-user", ["watchlist", "news"])
    assert first == []
    personalization.record_request_intents(db, "desk-user", ["watchlist", "news"])
    third = personalization.record_request_intents(db, "desk-user", ["watchlist", "news"])
    match = next(item for item in third if item["target_id"] == "researcher")
    assert match["auto_apply"] is False
    assert match["label"] == "Researcher"
    assert "Researcher" in match["message"]
    assert personalization.list_suggestions(db, "desk-user")

    personalization.record_request_intents(db, "desk-user", ["quotes", "watchlist", "alerts"] * 3)
    stacked = personalization.list_suggestions(db, "desk-user")
    labels = [item["label"] for item in stacked]
    assert len(labels) == len(set(labels))
    assert "Researcher" in labels
    assert "F&O desk" in labels
    assert all(item["auto_apply"] is False for item in stacked)
