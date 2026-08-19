from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.agent_tools import BROKER_DATA_TOOLS, INTEL_TOOLS, WORKSPACE_TOOLS
from app.main import app
from app.schemas.adaptive_workspace import parse_workspace_spec
from app.services import adaptive_workspace as workspace_svc
from app.services.broker_chat import create_session
from db.models import User
from db.session import Base


def _valid_spec(**overrides):
    payload = {
        "version": "1",
        "title": "Morning portfolio review",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "holdings",
                "type": "holdings-table",
                "position": {"x": 0, "y": 0, "w": 8, "h": 4},
                "data": {"tool": "broker_get_portfolio", "params": {"sections": ["holdings"]}},
                "actions": ["select", "refresh", "remove", "duplicate"],
            }
        ],
    }
    payload.update(overrides)
    return payload


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_workspace_tools_are_not_on_broker_chat_by_default():
    broker_names = {tool.name for tool in BROKER_DATA_TOOLS}
    workspace_names = {tool.name for tool in WORKSPACE_TOOLS}
    intel_names = {tool.name for tool in INTEL_TOOLS}

    assert workspace_names == {
        "compose_surface",
        "patch_surface",
        "workspace_evaluate_request",
        "workspace_get_authoring_docs",
        "workspace_get_current",
        "workspace_list_preferences",
        "workspace_list_saved_desks",
        "workspace_list_skills",
        "workspace_list_templates",
        "workspace_validate_spec",
    }
    assert intel_names == {
        "intel_get_feed",
        "intel_list_alert_notifications",
        "intel_list_alert_workflows",
    }
    assert workspace_names.isdisjoint(broker_names)
    assert intel_names.isdisjoint(broker_names)
    assert all(tool.description for tool in WORKSPACE_TOOLS)
    assert all(tool.description for tool in INTEL_TOOLS)


def test_duplicate_action_is_allowlisted():
    spec = parse_workspace_spec(_valid_spec())
    assert "duplicate" in spec.components[0].actions


def test_patch_add_remove_and_duplicate():
    spec = workspace_svc.patch_workspace_spec(
        None,
        operation="replace",
        spec=_valid_spec(),
    )
    spec = workspace_svc.patch_workspace_spec(
        spec,
        operation="add",
        component={
            "type": "quote-ticker",
            "position": {"x": 8, "y": 0, "w": 4, "h": 3},
            "data": {"tool": "broker_get_quotes", "params": {}},
        },
    )
    assert len(spec.components) == 2
    quote_id = next(item.id for item in spec.components if item.type == "quote-ticker")

    spec = workspace_svc.patch_workspace_spec(spec, operation="duplicate", component_id=quote_id)
    assert len(spec.components) == 3
    assert len({item.id for item in spec.components}) == 3

    spec = workspace_svc.patch_workspace_spec(spec, operation="remove", component_id=quote_id)
    assert all(item.id != quote_id for item in spec.components)


def test_patch_rejects_unknown_component_type():
    parsed, validation = workspace_svc.patch_workspace_spec_or_error(
        _valid_spec(),
        operation="add",
        component={"id": "bad-widget", "type": "made-up", "position": {"x": 0, "y": 4, "w": 4, "h": 2}},
    )
    assert parsed is None
    assert validation["ok"] is False
    assert any("catalog" in item["message"] for item in validation["errors"])


def test_snapshots_persist_and_restore_independently_of_chat():
    db = _db()
    db.add(User(id="desk-user", display_name="Desk"))
    db.commit()
    session = create_session(db, "desk-user", "Adaptive workspace")

    first = workspace_svc.create_snapshot(db, "desk-user", session.id, _valid_spec(), label="compose")
    assert first.version == 1
    assert first.valid is True
    assert first.applied_at is not None

    second_payload = _valid_spec(title="Quotes desk")
    second_payload["components"] = [
        {
            "id": "quotes",
            "type": "quote-ticker",
            "position": {"x": 0, "y": 0, "w": 6, "h": 3},
            "data": {"tool": "broker_get_quotes", "params": {}},
        }
    ]
    second = workspace_svc.create_snapshot(db, "desk-user", session.id, second_payload, label="rebuild")
    assert second.version == 2

    current = workspace_svc.get_current_snapshot(db, "desk-user", session.id)
    assert current is not None
    assert current.id == second.id
    assert workspace_svc.snapshot_to_out(current).workspace_payload["title"] == "Quotes desk"

    restored = workspace_svc.apply_snapshot(db, "desk-user", first.id)
    current = workspace_svc.get_current_snapshot(db, "desk-user", session.id)
    assert current is not None
    assert current.id == restored.id
    assert workspace_svc.snapshot_to_out(current).workspace_payload["title"] == "Morning portfolio review"


def test_adaptive_workspace_routes_are_mounted_under_api_v1():
    paths = set(app.openapi()["paths"])

    assert "/api/v1/adaptive-workspace/sessions/{session_id}/current" in paths
    assert "/api/v1/adaptive-workspace/sessions/{session_id}/snapshots" in paths
    assert "/api/v1/adaptive-workspace/snapshots/{snapshot_id}/apply" in paths
    assert "/api/v1/adaptive-workspace/templates" in paths
    assert "/api/v1/adaptive-workspace/skills" in paths
    assert "/api/v1/adaptive-workspace/desks" in paths
    assert "/api/v1/adaptive-workspace/preferences" in paths
    assert "/api/v1/adaptive-workspace/suggestions" in paths


def test_adaptive_workspace_routes_are_registered_with_testclient_context():
    from fastapi import FastAPI

    from app.api.v1 import adaptive_workspace

    test_app = FastAPI()
    test_app.include_router(adaptive_workspace.router, prefix="/adaptive-workspace")
    with TestClient(test_app) as client:
        paths = set(client.get("/openapi.json").json()["paths"])

    assert "/adaptive-workspace/sessions/{session_id}/current" in paths
    assert "/adaptive-workspace/snapshots/{snapshot_id}/apply" in paths
