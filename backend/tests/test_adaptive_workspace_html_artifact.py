import asyncio
import json

from agents.tool_context import ToolContext
from pydantic import ValidationError

from app.agent_tools.broker_tools import BrokerAgentContext
from app.agent_tools.workspace_tools import workspace_publish_html_artifact
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
                "props": {"title": "Sector breakdown"},
            }
        ],
    }
    payload.update(overrides)
    return payload


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


def test_workspace_publish_html_artifact_tool_sanitizes_and_binds():
    fragment = "<p>Custom table</p><style>table{border-collapse:collapse}</style>"
    context = BrokerAgentContext(user_id="desk-user", adaptive_workspace=True, session_id="desk-1")
    tool_context = ToolContext(
        context=context,
        tool_name="workspace_publish_html_artifact",
        tool_call_id="call-1",
        tool_arguments=json.dumps({"document": fragment, "title": "Table view"}),
    )
    result = asyncio.run(workspace_publish_html_artifact.on_invoke_tool(tool_context, tool_context.tool_arguments))
    assert result["ok"] is True
    bind = result["bind"]
    assert bind["component_type"] == "html-artifact"
    assert bind["data"]["tool"] == "workspace_publish_html_artifact"
    assert "<html" in bind["data"]["params"]["document"].lower()
    assert bind["props"]["title"] == "Table view"


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
