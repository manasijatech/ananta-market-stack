import asyncio
import json

from agents.tool_context import ToolContext
from pydantic import ValidationError

from app.agent_tools.broker_tools import BrokerAgentContext
from app.agent_tools.workspace_tools import workspace_publish_html_artifact, workspace_update_html_artifact
from app.schemas.adaptive_workspace import parse_workspace_spec, sanitize_html_artifact_document


def _html_artifact_spec(document: str, **overrides):
    sanitized = sanitize_html_artifact_document(document)
    payload = {
        "version": "1",
        "title": "Custom viz desk",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "viz",
                "type": "html-artifact",
                "position": {"x": 0, "y": 0, "w": 12, "h": 8},
                "data": {
                    "tool": "workspace_publish_html_artifact",
                    "params": {"document": sanitized},
                },
                "props": {"title": "Sector breakdown", "kind": "briefing"},
            }
        ],
    }
    payload.update(overrides)
    return payload


def test_parse_wraps_raw_canvas_fragment():
    payload = {
        "version": "1",
        "title": "Raw fragment desk",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "viz",
                "type": "html-artifact",
                "position": {"x": 0, "y": 0, "w": 12, "h": 8},
                "data": {
                    "tool": "workspace_publish_html_artifact",
                    "params": {"document": "<div class='aw'><h2 class='aw-h'>TCS</h2></div>"},
                },
                "props": {"title": "TCS timeline", "kind": "timeline"},
            }
        ],
    }
    spec = parse_workspace_spec(payload)
    document = spec.components[0].data.params["document"]
    assert "--aw-gold" in document
    assert "<html" in document.lower()
    assert spec.components[0].props["kind"] == "timeline"


def test_html_artifact_valid_spec_accepted():
    fragment = (
        "<div><svg viewBox='0 0 120 40' role='img'>"
        "<path d='M0 20 L120 20' stroke='#34d399' fill='none'/>"
        "</svg><script>document.body.dataset.ready='1'</script></div>"
    )
    spec = parse_workspace_spec(_html_artifact_spec(fragment))
    assert spec.components[0].type == "html-artifact"
    assert spec.components[0].data.tool == "workspace_publish_html_artifact"
    assert "svg" in spec.components[0].data.params["document"]


def test_html_artifact_rejects_remote_script_src():
    payload = {
        "version": "1",
        "title": "Bad viz",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "viz",
                "type": "html-artifact",
                "position": {"x": 0, "y": 0, "w": 12, "h": 8},
                "data": {
                    "tool": "workspace_publish_html_artifact",
                    "params": {"document": "<script src='https://evil.example/x.js'></script>"},
                },
                "props": {"title": "Evil"},
            }
        ],
    }
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "remote script" in str(exc).lower() or "script src" in str(exc).lower()
    else:
        raise AssertionError("expected ValidationError")


def test_html_artifact_rejects_missing_document():
    payload = {
        "version": "1",
        "title": "Missing doc",
        "layout": {"mode": "grid", "columns": 12},
        "components": [
            {
                "id": "viz",
                "type": "html-artifact",
                "position": {"x": 0, "y": 0, "w": 12, "h": 8},
                "data": {"tool": "workspace_publish_html_artifact", "params": {}},
                "props": {"title": "Broken"},
            }
        ],
    }
    try:
        parse_workspace_spec(payload)
    except ValidationError as exc:
        assert "document" in str(exc).lower()
    else:
        raise AssertionError("expected ValidationError")


def test_sanitize_wraps_with_canvas_kit_css():
    wrapped = sanitize_html_artifact_document("<div class='aw'><h2 class='aw-h'>Title</h2></div>")
    assert "--aw-gold" in wrapped
    assert ".aw-h" in wrapped


def test_sanitize_strips_agent_style_tags():
    wrapped = sanitize_html_artifact_document(
        "<style>body{background:blue}</style><div class='aw'><p class='aw-lead'>Hi</p></div>"
    )
    assert "background:blue" not in wrapped
    assert "--aw-gold" in wrapped


def test_sanitize_strips_rainbow_classes_keeps_aw_classes():
    wrapped = sanitize_html_artifact_document(
        "<div class='aw rainbow-pill neon-header'><p class='aw-kicker date-pill'>Label</p></div>"
    )
    assert "rainbow-pill" not in wrapped
    assert "neon-header" not in wrapped
    assert "date-pill" not in wrapped
    assert "aw-kicker" in wrapped
    assert "class=\"aw\"" in wrapped or "class='aw'" in wrapped


def test_sanitize_keeps_bar_fill_width_only():
    wrapped = sanitize_html_artifact_document(
        "<div class='aw'><div class='aw-bar'><div class='aw-bar__track'>"
        "<div class='aw-bar__fill' style='width:42%; background:blue'></div>"
        "</div></div></div>"
    )
    assert "width:42%" in wrapped
    assert "background:blue" not in wrapped


def test_workspace_publish_html_artifact_tool_sanitizes_and_binds():
    fragment = "<p class='aw-lead'>Custom table</p><style>table{border-collapse:collapse}</style>"
    context = BrokerAgentContext(user_id="desk-user", adaptive_workspace=True, session_id="desk-1")
    tool_context = ToolContext(
        context=context,
        tool_name="workspace_publish_html_artifact",
        tool_call_id="call-1",
        tool_arguments=json.dumps({"document": fragment, "title": "Table view", "kind": "snapshot"}),
    )
    result = asyncio.run(workspace_publish_html_artifact.on_invoke_tool(tool_context, tool_context.tool_arguments))
    assert result["ok"] is True
    bind = result["bind"]
    assert bind["component_type"] == "html-artifact"
    assert bind["data"]["tool"] == "workspace_publish_html_artifact"
    document = bind["data"]["params"]["document"]
    assert "<html" in document.lower()
    assert "table{border-collapse" not in document
    assert "--aw-gold" in document
    assert bind["props"]["title"] == "Table view"
    assert bind["props"]["kind"] == "snapshot"


def test_workspace_publish_html_artifact_tool_rejects_remote_script():
    context = BrokerAgentContext(user_id="desk-user", adaptive_workspace=True, session_id="desk-1")
    tool_context = ToolContext(
        context=context,
        tool_name="workspace_publish_html_artifact",
        tool_call_id="call-2",
        tool_arguments=json.dumps({"document": "<script src='https://evil.example/x.js'></script>"}),
    )
    result = asyncio.run(
        workspace_publish_html_artifact.on_invoke_tool(tool_context, tool_context.tool_arguments)
    )
    assert result["ok"] is False
    assert result["code"] == "invalid_document"


def test_workspace_update_html_artifact_updates_existing_component():
    fragment = "<div class='aw'><p class='aw-lead'>First</p></div>"
    spec = parse_workspace_spec(_html_artifact_spec(fragment))
    context = BrokerAgentContext(
        user_id="desk-user",
        adaptive_workspace=True,
        workspace_spec=json.loads(spec.model_dump_json()),
    )
    updated_fragment = "<div class='aw'><p class='aw-lead'>Updated briefing</p></div>"
    tool_context = ToolContext(
        context=context,
        tool_name="workspace_update_html_artifact",
        tool_call_id="call-3",
        tool_arguments=json.dumps(
            {
                "component_id": "viz",
                "document": updated_fragment,
                "title": "Gabriel briefing",
                "kind": "briefing",
            }
        ),
    )
    result = asyncio.run(workspace_update_html_artifact.on_invoke_tool(tool_context, tool_context.tool_arguments))
    assert result["ok"] is True
    assert result["applied_to"] == "viz"
    assert "Updated briefing" in result["spec"]["components"][0]["data"]["params"]["document"]
    assert result["spec"]["components"][0]["props"]["title"] == "Gabriel briefing"
    assert result["spec"]["components"][0]["props"]["kind"] == "briefing"
    assert context.workspace_spec == result["spec"]
    assert any(item["id"] == "viz" for item in result["canvas_inventory"])


def test_workspace_update_html_artifact_missing_id_returns_inventory():
    spec = parse_workspace_spec(_html_artifact_spec("<div class='aw'></div>"))
    context = BrokerAgentContext(
        user_id="desk-user",
        adaptive_workspace=True,
        workspace_spec=json.loads(spec.model_dump_json()),
    )
    tool_context = ToolContext(
        context=context,
        tool_name="workspace_update_html_artifact",
        tool_call_id="call-4",
        tool_arguments=json.dumps(
            {
                "component_id": "missing-canvas",
                "document": "<div class='aw'><p class='aw-lead'>Nope</p></div>",
            }
        ),
    )
    result = asyncio.run(workspace_update_html_artifact.on_invoke_tool(tool_context, tool_context.tool_arguments))
    assert result["ok"] is False
    assert result["code"] == "missing_component"
    assert any(item["id"] == "viz" for item in result["canvas_inventory"])
