from types import SimpleNamespace

from app.agent_tools.web_tools import MAX_SEARCHES_PER_RUN, _bump, _extract, fetch_public_url


def test_extract_strips_scripts_and_keeps_table_text():
    title, text = _extract(
        "<html><head><title>Screener</title><script>alert(1)</script></head>"
        "<body><h1>Gabriel India</h1><table><tr><td>Sales</td><td>1,234</td></tr></table></body></html>"
    )
    assert title == "Screener"
    assert "Gabriel India" in text
    assert "Sales" in text
    assert "1,234" in text
    assert "alert" not in text


def test_fetch_blocks_localhost():
    result = fetch_public_url("http://127.0.0.1:8004/health")
    assert result.get("ok") is False
    assert result.get("code") == "url_blocked"


def test_search_budget_stops_after_limit():
    ctx = SimpleNamespace(context=SimpleNamespace(web_usage={}))
    for _ in range(MAX_SEARCHES_PER_RUN):
        assert _bump(ctx, "search", MAX_SEARCHES_PER_RUN) is None
    blocked = _bump(ctx, "search", MAX_SEARCHES_PER_RUN)
    assert blocked and blocked.get("ok") is True
    assert blocked.get("reason") == "budget_exhausted"
