from app.agent_tools.tool_labels import decorate_tool_payload, display_name_for_tool


def test_tool_aliases_cover_core_and_mcp_names():
    assert display_name_for_tool("broker_get_quotes") == "Live quotes"
    assert display_name_for_tool("workspace_publish_html_artifact") == "Publish canvas"
    assert display_name_for_tool("drishti__get_news") == "News"


def test_decorate_tool_payload_stamps_alias():
    payload = decorate_tool_payload("intel_get_feed", {"tool_name": "intel_get_feed", "arguments": {}})
    assert payload["display_name"] == "Market intelligence"
    assert payload["tool_alias"] == "Market intelligence"
