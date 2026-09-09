from app.agent_harness.evidence import (
    evidence_gaps,
    plan_evidence_contract,
)


def _completed(tool_name: str, output: dict) -> dict:
    return {
        "event_type": "tool_call_completed",
        "payload": {"tool_name": tool_name, "output": output},
    }


SCREENER = "https://www.screener.in/company/TCS/consolidated/"


def test_pasted_url_without_fetch_is_incomplete():
    contract = plan_evidence_contract(
        f"Analyse {SCREENER} and tell me the story",
        adaptive_workspace=True,
        sandbox_available=True,
    )
    assert "link_fetch" in contract.required
    report = evidence_gaps(contract, [])
    assert report.unsatisfied()
    assert report.status == "pending"


def test_web_fetch_403_is_done_with_blocker():
    contract = plan_evidence_contract(f"Open {SCREENER}", adaptive_workspace=True)
    report = evidence_gaps(
        contract,
        [
            _completed(
                "web_fetch",
                {"ok": False, "code": "http_403", "status_code": 403, "url": SCREENER},
            )
        ],
    )
    assert not report.unsatisfied()
    assert "url_unreadable" in report.blockers
    assert report.status == "satisfied"


def test_cagr_requires_sandbox_on_enterprise():
    contract = plan_evidence_contract(
        "What is the implied CAGR if revenue doubles in 4 years?",
        adaptive_workspace=True,
        sandbox_available=True,
    )
    assert "calculation" in contract.required
    report = evidence_gaps(contract, [], sandbox_available=True)
    assert any(gap.kind == "calculation" for gap in report.unsatisfied())


def test_cagr_optional_on_oss_when_digits_shown():
    contract = plan_evidence_contract(
        "What is the implied CAGR if revenue doubles in 4 years?",
        adaptive_workspace=True,
        sandbox_available=False,
    )
    assert "calculation" not in contract.required
    assert "calculation" in contract.optional
    report = evidence_gaps(
        contract,
        [],
        final_text="Implied CAGR is 18.92% from 2**(1/4)-1.",
        sandbox_available=False,
    )
    assert not report.unsatisfied()


def test_news_without_mcp_uses_web_grounding_not_intel():
    contract = plan_evidence_contract(
        "What are today's Indian market headlines and filings?",
        adaptive_workspace=True,
        mcp_enabled=False,
    )
    assert "web_grounding" in contract.required
    assert "mcp_or_intel" not in contract.required


def test_news_with_mcp_requires_intel():
    contract = plan_evidence_contract(
        "What are today's Indian market headlines and filings?",
        adaptive_workspace=True,
        mcp_enabled=True,
    )
    assert "mcp_or_intel" in contract.required
    assert "web_grounding" not in contract.required


def test_canvas_only_when_user_asks():
    briefing = plan_evidence_contract(
        "Compare TCS and Infosys on the latest reported results in detail",
        adaptive_workspace=True,
    )
    assert "canvas" not in briefing.required
    asked = plan_evidence_contract(
        "Compare TCS and Infosys and pin a comparison canvas on the desk",
        adaptive_workspace=True,
    )
    assert "canvas" in asked.required


def test_mcp_text_result_satisfies_intel_requirement():
    contract = plan_evidence_contract(
        "What are today's Indian market headlines and filings?",
        adaptive_workspace=True,
        mcp_enabled=True,
    )
    report = evidence_gaps(
        contract,
        [_completed("get_news", {"type": "text", "text": '{"headlines":["SEBI circular"]}'})],
    )
    assert not report.unsatisfied()
    assert report.status == "satisfied"


def test_todos_for_complex_multi_url_contract():
    contract = plan_evidence_contract(
        f"Open {SCREENER} and https://www.screener.in/company/INFY/ then compute CAGR "
        "and pin a comparison canvas on the desk",
        adaptive_workspace=True,
        sandbox_available=True,
    )
    report = evidence_gaps(contract, [])
    todos = report.todos
    assert len(todos) >= 3
    assert {item["state"] for item in todos} == {"pending"}
