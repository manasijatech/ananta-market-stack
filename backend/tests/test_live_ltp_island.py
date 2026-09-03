"""Plan 08 — live LTP island grammar + canvas sanitizer."""

from app.schemas.adaptive_workspace import sanitize_html_artifact_document
from app.services.live_ltp_island import (
    flatten_live_ltp_islands,
    parse_live_ltp_token,
    prepare_live_ltp_in_html,
    sanitize_ananta_ltp_elements,
)


def test_parse_valid_token():
    attrs = parse_live_ltp_token(
        "{{ltp:NSE:GABRIEL|ltp=245.10|chgPct=1.24|asOf=2026-08-28T13:40:00+05:30}}"
    )
    assert attrs is not None
    assert attrs["symbol"] == "GABRIEL"
    assert attrs["exchange"] == "NSE"
    assert attrs["ltp"] == 245.10
    assert attrs["chgPct"] == 1.24
    assert attrs["asOf"].startswith("2026-08-28")


def test_reject_bare_prose_is_not_a_token():
    assert parse_live_ltp_token("RELIANCE at 1423") is None
    assert parse_live_ltp_token("GABRIEL 245.10 (+1.24%)") is None


def test_flatten_prefers_live_over_snapshot():
    text = "Gabriel prints {{ltp:NSE:GABRIEL|ltp=245.10|chgPct=1.24|asOf=2026-08-28T13:40:00+05:30}} today."
    out = flatten_live_ltp_islands(text, {"NSE:GABRIEL": {"ltp": 250.5, "chgPct": 2.0}})
    assert "250.50" in out or "250.5" in out
    assert "+2.00%" in out
    assert "{{ltp:" not in out


def test_flatten_uses_snapshot_when_no_live():
    text = "{{ltp:NSE:TCS|ltp=3500|chgPct=-0.5|asOf=x}}"
    out = flatten_live_ltp_islands(text, {})
    assert "TCS" in out
    assert "3,500.00" in out or "3500.00" in out
    assert "-0.50%" in out


def test_sanitize_strips_onclick_keeps_safe_attrs():
    dirty = '<ananta-ltp data-symbol="GABRIEL" data-exchange="NSE" data-ltp="10" onclick="alert(1)"></ananta-ltp>'
    cleaned = sanitize_ananta_ltp_elements(dirty)
    assert "onclick" not in cleaned.lower()
    assert 'data-symbol="GABRIEL"' in cleaned
    assert "ananta-ltp" in cleaned


def test_prepare_converts_token_and_canvas_keeps_tag():
    fragment = (
        "<div class='aw'><p class='aw-lead'>Spot "
        "{{ltp:NSE:GABRIEL|ltp=245.10|chgPct=1.24|asOf=2026-08-28T13:40:00+05:30}}"
        "</p></div>"
    )
    prepared = prepare_live_ltp_in_html(fragment)
    assert "{{ltp:" not in prepared
    assert "<ananta-ltp" in prepared
    assert 'data-symbol="GABRIEL"' in prepared

    wrapped = sanitize_html_artifact_document(fragment)
    assert "ananta-ltp" in wrapped
    assert "aw-ltp" in wrapped
    assert "javascript:" not in wrapped.lower()


def test_remote_script_still_rejected():
    try:
        sanitize_html_artifact_document("<script src='https://evil.example/x.js'></script>")
    except ValueError as exc:
        assert "script" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")


def test_historic_sentence_unchanged():
    prose = "In FY24 Q1, RELIANCE printed revenue of 1,423 crore."
    assert prepare_live_ltp_in_html(prose) == prose
    assert flatten_live_ltp_islands(prose) == prose
