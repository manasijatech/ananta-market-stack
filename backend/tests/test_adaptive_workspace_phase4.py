from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.agent_tools.alert_studio_tools import ALERT_STUDIO_TOOLS
from app.main import app
from app.schemas.adaptive_workspace import ALLOWED_ACTIONS, ALLOWED_DATA_TOOLS, parse_workspace_spec
from app.schemas.alert import AlertCondition, AlertGraphDsl, AlertWorkflowCreate, AlertWorkflowDsl
from app.services import adaptive_workspace as workspace_svc
from app.services import adaptive_workspace_alert_studio as studio
from app.services.adaptive_workspace_personalization import DESK_SKILLS, get_skill
from db.models import AdaptiveWorkspaceSnapshot, AlertWorkflowChatSnapshot, User
from db.session import Base


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def _workflow_create(name: str = "Studio draft") -> AlertWorkflowCreate:
    return AlertWorkflowCreate(
        name=name,
        description="Adaptive studio test",
        symbol="RELIANCE",
        exchange="NSE",
        workflow_dsl=AlertWorkflowDsl(
            workflow_type="alert",
            combine="all",
            conditions=[AlertCondition(field="ltp", operator="gte", value=100)],
        ),
        graph_dsl=AlertGraphDsl(),
        editor_mode="rule",
    )


def test_studio_types_and_tools_are_allowlisted():
    spec = parse_workspace_spec(
        {
            "version": "1",
            "title": "Alert studio",
            "layout": {"mode": "grid", "columns": 12},
            "components": [
                {
                    "id": "draft",
                    "type": "alert-rule-draft",
                    "position": {"x": 0, "y": 0, "w": 6, "h": 5},
                    "data": {"tool": "alert_get_studio", "params": {}},
                },
                {
                    "id": "graph",
                    "type": "workflow-graph",
                    "position": {"x": 6, "y": 0, "w": 6, "h": 5},
                    "data": {"tool": "alert_get_studio", "params": {}},
                },
                {
                    "id": "simulation",
                    "type": "workflow-simulation",
                    "position": {"x": 0, "y": 5, "w": 6, "h": 4},
                    "data": {"tool": "alert_get_studio", "params": {}},
                },
                {
                    "id": "approval",
                    "type": "approval-card",
                    "position": {"x": 6, "y": 5, "w": 6, "h": 4},
                    "data": {"tool": "alert_get_studio", "params": {}},
                    "actions": ["select", "refresh", "deploy-alert"],
                },
            ],
        }
    )
    assert [item.type for item in spec.components] == [
        "alert-rule-draft",
        "workflow-graph",
        "workflow-simulation",
        "approval-card",
    ]
    assert "alert_get_studio" in ALLOWED_DATA_TOOLS
    assert "deploy-alert" in ALLOWED_ACTIONS
    assert {tool.name for tool in ALERT_STUDIO_TOOLS} == {
        "alert_get_studio",
        "alert_refresh_studio",
        "alert_deploy_snapshot",
    }


def test_alert_studio_skill_uses_existing_snapshot_fields():
    skill = get_skill("alert-studio")
    types = [item["type"] for item in skill["spec"]["components"]]
    assert types == ["alert-rule-draft", "workflow-graph", "workflow-simulation", "approval-card"]
    assert all(item["data"]["tool"] == "alert_get_studio" for item in skill["spec"]["components"])
    assert "alert-studio" in DESK_SKILLS


def test_studio_payload_reads_alert_workflow_chat_snapshots():
    db = _db()
    db.add(User(id="studio-user", display_name="Studio"))
    db.commit()

    empty = studio.get_studio(db, "studio-user")
    assert empty.source == "empty"
    assert empty.workflow_id is None

    from app.services.alert_workflow_chat import sessions as chat_sessions
    from app.schemas.alert_workflow_chat import AlertWorkflowChatSessionCreateIn

    session = chat_sessions.create_session(
        db,
        "studio-user",
        AlertWorkflowChatSessionCreateIn(title="Draft chat", draft_workflow=_workflow_create()),
    )
    synthesized = studio.get_studio(db, "studio-user", workflow_id=session.workflow_id)
    assert synthesized.source == "workflow"
    assert synthesized.workflow_id == session.workflow_id
    assert synthesized.snapshot_id is None
    assert synthesized.workflow_payload["name"] == "Studio draft"
    assert "workflow_dsl" in synthesized.workflow_payload

    refreshed = studio.refresh_studio(db, "studio-user", session.workflow_id)
    assert refreshed.source == "snapshot"
    assert refreshed.snapshot_id
    row = db.get(AlertWorkflowChatSnapshot, refreshed.snapshot_id)
    assert row is not None
    assert row.workflow_id == session.workflow_id
    assert row.validation_json
    assert row.samples_json is not None

    loaded = studio.get_studio(db, "studio-user", workflow_id=session.workflow_id)
    assert loaded.snapshot_id == refreshed.snapshot_id
    assert loaded.validation == refreshed.validation
    assert loaded.samples == refreshed.samples


def test_deploy_without_confirm_fails():
    db = _db()
    db.add(User(id="studio-user", display_name="Studio"))
    db.commit()
    from app.services.alert_workflow_chat import sessions as chat_sessions
    from app.schemas.alert_workflow_chat import AlertWorkflowChatSessionCreateIn

    session = chat_sessions.create_session(
        db,
        "studio-user",
        AlertWorkflowChatSessionCreateIn(title="Draft chat", draft_workflow=_workflow_create()),
    )
    refreshed = studio.refresh_studio(db, "studio-user", session.workflow_id)
    try:
        studio.deploy_studio(db, "studio-user", refreshed.snapshot_id, confirm=False)
    except ValueError as exc:
        assert "confirm" in str(exc).lower()
    else:
        raise AssertionError("expected confirm gate")

    deployed = studio.deploy_studio(db, "studio-user", refreshed.snapshot_id, confirm=True)
    assert deployed.snapshot_id == refreshed.snapshot_id
    assert deployed.status == "active"


def test_no_second_snapshot_table_was_added():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    tables = set(inspect(engine).get_table_names())
    assert "alert_workflow_chat_snapshots" in tables
    assert "adaptive_workspace_snapshots" in tables
    assert "adaptive_alert_studio_snapshots" not in tables
    chat_columns = {column["name"] for column in inspect(engine).get_columns("alert_workflow_chat_snapshots")}
    workspace_columns = {column["name"] for column in inspect(engine).get_columns("adaptive_workspace_snapshots")}
    assert "samples_json" in chat_columns
    assert "workflow_payload_json" in chat_columns
    assert "diff_json" in chat_columns
    assert "samples_json" not in workspace_columns
    assert "workspace_payload_json" in workspace_columns
    assert set(AdaptiveWorkspaceSnapshot.__table__.c.keys()) == workspace_columns
    assert set(AlertWorkflowChatSnapshot.__table__.c.keys()) == chat_columns


def test_evaluate_request_recommends_studio_types():
    planned = workspace_svc.evaluate_request("Open an alert workflow studio on this canvas")
    assert "alert_studio" in planned["intents"]
    assert planned["recommended_tools"] == ["alert_get_studio"]
    assert planned["recommended_types"] == [
        "alert-rule-draft",
        "workflow-graph",
        "workflow-simulation",
        "approval-card",
    ]


def test_alert_studio_routes_are_mounted():
    paths = set(app.openapi()["paths"])
    assert "/api/v1/adaptive-workspace/alert-studio" in paths
    assert "/api/v1/adaptive-workspace/alert-studio/refresh" in paths
    assert "/api/v1/adaptive-workspace/alert-studio/deploy" in paths
