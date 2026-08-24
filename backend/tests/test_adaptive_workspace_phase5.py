from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.schemas.adaptive_workspace import parse_workspace_spec
from app.services import adaptive_workspace as workspace_svc
from app.services import adaptive_workspace_interop as interop
from app.services.adaptive_workspace_personalization import DESK_SKILLS, get_skill


def _spec_with_holdings():
    return {
        "version": "1",
        "title": "Morning portfolio review",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "holdings",
                "type": "holdings-table",
                "position": {"x": 0, "y": 0, "w": 8, "h": 5},
                "data": {"tool": "broker_get_portfolio", "params": {"sections": ["holdings"]}},
                "actions": ["select", "refresh"],
            }
        ],
    }


def test_micro_app_is_allowlisted_from_registry_only():
    spec = parse_workspace_spec(
        {
            "version": "1",
            "title": "Sandbox",
            "layout": {"mode": "grid", "columns": 12},
            "components": [
                {
                    "id": "payoff",
                    "type": "micro-app",
                    "position": {"x": 0, "y": 0, "w": 6, "h": 5},
                    "data": {"tool": "workspace_get_micro_app", "params": {"app_id": "payoff-diagram"}},
                    "props": {"appId": "payoff-diagram", "kind": "straddle", "spot": 25000, "strike": 25000, "premium": 180},
                }
            ],
        }
    )
    assert spec.components[0].props["appId"] == "payoff-diagram"

    payload = {
        "version": "1",
        "title": "Bad sandbox",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "evil",
                "type": "micro-app",
                "position": {"x": 0, "y": 0, "w": 6, "h": 5},
                "props": {"appId": "https://evil.example", "src": "https://evil.example"},
            }
        ],
    }
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "not allowed" in str(exc) or "curated registry" in str(exc)
    else:
        raise AssertionError("expected ValidationError")


def test_micro_app_rejects_unknown_app_and_wrong_tool():
    payload = {
        "version": "1",
        "title": "Unknown app",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "payoff",
                "type": "micro-app",
                "position": {"x": 0, "y": 0, "w": 6, "h": 5},
                "props": {"appId": "not-a-real-app"},
            }
        ],
    }
    try:
        parse_workspace_spec(payload)
    except ValidationError:
        pass
    else:
        raise AssertionError("expected ValidationError")

    payload["components"][0]["props"] = {"appId": "payoff-diagram"}
    payload["components"][0]["data"] = {"tool": "broker_get_quotes", "params": {}}
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "workspace_get_micro_app" in str(exc)
    else:
        raise AssertionError("expected ValidationError")


def test_bind_micro_app_payload_clamps_numbers_and_text():
    bound = interop.bind_micro_app_payload(
        "payoff-diagram",
        props={"kind": "call", "spot": 1e12, "strike": -5, "premium": "nope", "width_pct": 99},
    )
    assert bound["appId"] == "payoff-diagram"
    assert bound["kind"] == "call"
    assert bound["spot"] == 10_000_000
    assert bound["strike"] == 0.01
    assert bound["premium"] == 180
    assert bound["width_pct"] == 50

    try:
        interop.bind_micro_app_payload("notes-scratch", props={"text": "x" * 8000})
    except ValueError as exc:
        assert "curated registry" in str(exc)
    else:
        raise AssertionError("expected notes-scratch to be removed from the registry")


def test_a2ui_round_trip_preserves_workspace_spec():
    spec = parse_workspace_spec(_spec_with_holdings())
    parsed, validation, messages = interop.round_trip_a2ui(spec)
    assert validation["ok"] is True
    assert parsed is not None
    assert workspace_svc.workspace_spec_dump(parsed) == workspace_svc.workspace_spec_dump(spec)
    assert messages[0]["createSurface"]["catalogId"] == interop.A2UI_CATALOG_ID
    assert any(item.get("component") == "holdings-table" for item in messages[1]["updateComponents"]["components"])


def test_a2ui_import_rejects_unknown_catalog_types():
    messages = [
        {"version": "v0.9", "createSurface": {"surfaceId": "desk", "catalogId": "ananta-workspace-v1"}},
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "desk",
                "components": [
                    {"id": "root", "component": "Grid", "children": ["evil"]},
                    {"id": "evil", "component": "iframe", "props": {"src": "https://evil.example"}},
                ],
            },
        },
    ]
    parsed, validation = interop.a2ui_to_workspace_spec(messages)
    assert parsed is None
    assert validation["ok"] is False
    assert any("not in the catalog" in item["message"] for item in validation["errors"])


def test_a2ui_import_accepts_nested_component_discriminator():
    messages = [
        {"version": "v0.9", "createSurface": {"surfaceId": "desk", "catalogId": "ananta-workspace-v1"}},
        {
            "version": "v0.9",
            "updateDataModel": {"surfaceId": "desk", "path": "/", "value": {"title": "Nested desk"}},
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "desk",
                "components": [
                    {
                        "id": "quotes",
                        "component": {
                            "quote-ticker": {
                                "position": {"x": 0, "y": 0, "w": 6, "h": 3},
                                "data": {"tool": "broker_get_quotes", "params": {}},
                            }
                        },
                    }
                ],
            },
        },
    ]
    parsed, validation = interop.a2ui_to_workspace_spec(messages)
    assert validation["ok"] is True
    assert parsed is not None
    assert parsed.title == "Nested desk"
    assert parsed.components[0].type == "quote-ticker"


def test_agui_maps_existing_sse_without_replacing_it():
    events = [
        {"sequence": 1, "event_type": "run_started", "payload": {"status": "running"}},
        {"sequence": 2, "event_type": "token", "payload": {"text": "Hello "}},
        {"sequence": 3, "event_type": "token", "payload": {"text": "desk"}},
        {
            "sequence": 4,
            "event_type": "tool_call_started",
            "payload": {"tool_name": "compose_surface", "tool_call_id": "c1", "arguments": {"spec": {}}},
        },
        {
            "sequence": 5,
            "event_type": "tool_call_completed",
            "payload": {"tool_name": "compose_surface", "tool_call_id": "c1", "output": {"ok": True, "applied": True}},
        },
        {"sequence": 6, "event_type": "run_completed", "payload": {"status": "completed"}},
    ]
    mapped = interop.broker_events_to_agui(
        events,
        thread_id="session-1",
        run_id="run-1",
        spec=_spec_with_holdings(),
    )
    types = [item["type"] for item in mapped]
    assert types[0] == "RUN_STARTED"
    assert "TEXT_MESSAGE_START" in types
    assert "TEXT_MESSAGE_CONTENT" in types
    assert "TOOL_CALL_START" in types
    assert "TOOL_CALL_RESULT" in types
    assert types[-1] == "RUN_FINISHED"
    assert any(item["type"] == "STATE_SNAPSHOT" and item["snapshot"]["spec"]["title"] == "Morning portfolio review" for item in mapped)
    assert "Hello desk" == "".join(item["delta"] for item in mapped if item["type"] == "TEXT_MESSAGE_CONTENT")


def test_research_sandbox_skill_uses_curated_micro_app():
    skill = get_skill("research-sandbox")
    types = [item["type"] for item in skill["spec"]["components"]]
    assert types == ["micro-app", "notes-block"]
    payoff = skill["spec"]["components"][0]
    assert payoff["props"]["appId"] == "payoff-diagram"
    assert payoff["data"]["tool"] == "workspace_get_micro_app"
    assert "research-sandbox" in DESK_SKILLS


def test_evaluate_request_covers_sandbox_intent():
    planned = workspace_svc.evaluate_request("Add a sandboxed straddle payoff")
    assert "sandbox" in planned["intents"]
    assert "workspace_get_micro_app" in planned["recommended_tools"]
    assert "micro-app" in planned["recommended_types"]
    assert "notes-block" in planned["recommended_types"]


def test_phase5_routes_are_mounted_under_api_v1():
    paths = set(app.openapi()["paths"])
    assert "/api/v1/adaptive-workspace/interop/a2ui/export" in paths
    assert "/api/v1/adaptive-workspace/interop/a2ui/import" in paths
    assert "/api/v1/adaptive-workspace/interop/ag-ui" in paths
    assert "/api/v1/adaptive-workspace/micro-apps" in paths


def test_phase5_routes_register_with_testclient_context():
    from fastapi import FastAPI

    from app.api.v1 import adaptive_workspace

    test_app = FastAPI()
    test_app.include_router(adaptive_workspace.router, prefix="/adaptive-workspace")
    with TestClient(test_app) as client:
        paths = set(client.get("/openapi.json").json()["paths"])
    assert "/adaptive-workspace/interop/ag-ui" in paths
    assert "/adaptive-workspace/micro-apps/{app_id}" in paths
