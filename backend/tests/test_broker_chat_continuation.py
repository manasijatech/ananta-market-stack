from app.services.broker_chat_runner import response_looks_incomplete


def test_incomplete_when_tools_ran_without_message():
    assert response_looks_incomplete("", tool_calls=4, had_message=False) is True


def test_incomplete_when_last_line_is_planning():
    text = "Found it — the NSE symbol is M&M. Let me fetch its live quote to complete the picture."
    assert response_looks_incomplete(text, tool_calls=8, had_message=True) is True


def test_complete_briefing_is_not_retried():
    text = (
        "Nifty 50 constituents were mixed today. RELIANCE last 1311.60 (-0.4%). "
        "MCP daily summary: breadth negative; top news is the SEBI circular on SHRIRAMFIN."
    )
    assert response_looks_incomplete(text, tool_calls=6, had_message=True) is False
