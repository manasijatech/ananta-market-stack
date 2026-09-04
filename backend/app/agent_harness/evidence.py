"""Evidence-based done: contracts, audit checkers, harness nudges.

OSS-safe: no sandbox or execution-plane imports. Callers pass sandbox_available.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import BrokerChatEvent, BrokerChatRun

EvidenceKind = Literal[
    "link_fetch",
    "web_grounding",
    "broker_read",
    "calculation",
    "canvas",
    "mcp_or_intel",
]

EVIDENCE_KINDS: tuple[EvidenceKind, ...] = (
    "link_fetch",
    "web_grounding",
    "broker_read",
    "calculation",
    "canvas",
    "mcp_or_intel",
)

MAX_EVIDENCE_CONTINUATIONS = 3
HIDDEN_EVENT_TYPES = frozenset(
    {
        "model_context_built",
        "harness_nudge",
        "context_injected",
        "context_hook_error",
        "compaction",
        "compaction_failed",
    }
)

_URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.IGNORECASE)
_CALC_RE = re.compile(
    r"\b(cagr|compound(?:ing)?|ratio|implied|scenario|payoff|what if|"
    r"split\s+\d|lakh|crore|% change|percentage change)\b",
    re.IGNORECASE,
)
_BROKER_RE = re.compile(
    r"\b(holding|holdings|portfolio|position|positions|quote|quotes|ltp|"
    r"funds|session status|broker account|my stocks)\b",
    re.IGNORECASE,
)
_CANVAS_RE = re.compile(
    r"\b(canvas|compose(?:_surface)?|pin (?:a |the )?(?:desk|canvas|comparison)|"
    r"publish(?:ed)? (?:a |the )?(?:canvas|desk)|put (?:a |it |this )?(?:short )?"
    r"(?:comparison )?canvas|on the desk)\b",
    re.IGNORECASE,
)
_NEWS_RE = re.compile(
    r"\b(news|headline|headlines|filing|filings|announcement|announcements|"
    r"earnings call|concall|daily summary|morning brief)\b",
    re.IGNORECASE,
)
_BROKER_ONLY_RE = re.compile(
    r"\b(my holding|my portfolio|my position|connected broker|session status)\b",
    re.IGNORECASE,
)

_LOCAL_TOOL_PREFIXES = (
    "broker_",
    "intel_",
    "workspace_",
    "alert_",
    "compose_",
    "patch_",
    "sandbox_",
    "web_",
)

_TODO_LABELS: dict[EvidenceKind, str] = {
    "link_fetch": "Open the pasted URL",
    "web_grounding": "Ground the answer in a public source",
    "broker_read": "Read connected broker data",
    "calculation": "Compute the figures (do not invent them)",
    "canvas": "Pin or compose the desk",
    "mcp_or_intel": "Pull news or filings",
}

_NUDGE_HINTS: dict[EvidenceKind, str] = {
    "link_fetch": "open the pasted URL with web_fetch (or say the page is unreadable)",
    "web_grounding": "call web_search / web_fetch or intel/MCP news, or say no sources were available",
    "broker_read": "call the matching broker_* tool, or report action_required / empty holdings",
    "calculation": "run sandbox_run_python (or show the arithmetic steps if no calculator is attached)",
    "canvas": "compose_surface or workspace_publish_html_artifact, then a one-line pointer in chat",
    "mcp_or_intel": "call connected MCP tools (get_news, get_daily_summary, events). Do not use intel_get_feed while MCP is connected.",
}


@dataclass(frozen=True)
class EvidenceContract:
    required: tuple[EvidenceKind, ...]
    optional: tuple[EvidenceKind, ...]
    urls: tuple[str, ...]
    assumed: bool = False
    clarify: bool = False


@dataclass(frozen=True)
class EvidenceGap:
    kind: EvidenceKind
    reason: str
    blocker: str | None = None


@dataclass
class EvidenceReport:
    contract: EvidenceContract
    gaps: list[EvidenceGap] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)
    status: Literal["pending", "satisfied", "partial"] = "pending"
    todos: list[dict[str, str]] = field(default_factory=list)

    def unsatisfied(self) -> list[EvidenceGap]:
        return [gap for gap in self.gaps if gap.blocker is None]

    def as_json(self) -> dict[str, Any]:
        return {
            "contract": {
                "required": list(self.contract.required),
                "optional": list(self.contract.optional),
                "urls": list(self.contract.urls),
                "assumed": self.contract.assumed,
                "clarify": self.contract.clarify,
            },
            "gaps": [{"kind": gap.kind, "reason": gap.reason, "blocker": gap.blocker} for gap in self.gaps],
            "status": self.status,
            "blockers": self.blockers,
            "todos": self.todos,
        }


def extract_urls(message: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for match in _URL_RE.findall(message or ""):
        cleaned = match.rstrip(".,;")
        if cleaned not in seen:
            seen.add(cleaned)
            found.append(cleaned)
    return found


def plan_evidence_contract(
    message: str,
    *,
    adaptive_workspace: bool = False,
    sandbox_available: bool = False,
    mcp_enabled: bool = False,
) -> EvidenceContract:
    text = message or ""
    urls = extract_urls(text)
    required: list[EvidenceKind] = []
    optional: list[EvidenceKind] = []

    if urls:
        required.append("link_fetch")
    if _BROKER_RE.search(text):
        required.append("broker_read")
    news = bool(_NEWS_RE.search(text))
    if news and mcp_enabled:
        required.append("mcp_or_intel")
    elif news:
        required.append("web_grounding")
    elif (
        adaptive_workspace
        and not urls
        and not _BROKER_ONLY_RE.search(text)
        and not _BROKER_RE.search(text)
        and len(text.strip()) > 40
    ):
        optional.append("web_grounding")

    if _CALC_RE.search(text):
        if sandbox_available:
            required.append("calculation")
        else:
            optional.append("calculation")
    if _CANVAS_RE.search(text) and adaptive_workspace:
        required.append("canvas")

    # Ambiguous short prompt: one clarify, then assume a light web contract.
    clarify = not required and not urls and len(text.strip()) < 48 and adaptive_workspace
    assumed = False
    if clarify:
        assumed = True
        optional.append("web_grounding")

    # Dedupe while preserving order.
    def _uniq(items: Iterable[EvidenceKind]) -> tuple[EvidenceKind, ...]:
        seen_kinds: list[EvidenceKind] = []
        for item in items:
            if item not in seen_kinds:
                seen_kinds.append(item)
        return tuple(seen_kinds)

    return EvidenceContract(
        required=_uniq(required),
        optional=_uniq(optional),
        urls=tuple(urls),
        assumed=assumed,
        clarify=clarify,
    )


def _parse_output(payload: dict[str, Any]) -> dict[str, Any]:
    output = payload.get("output")
    if isinstance(output, str):
        try:
            parsed = json.loads(output)
        except json.JSONDecodeError:
            return {"text": output}
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    return output if isinstance(output, dict) else {}


def _tool_records(events: Iterable[Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for event in events:
        event_type = getattr(event, "event_type", None) or (event.get("event_type") if isinstance(event, dict) else "")
        if event_type != "tool_call_completed":
            continue
        if isinstance(event, dict):
            payload = event.get("payload") or event.get("full_payload") or {}
        else:
            raw = getattr(event, "full_payload_json", None) or getattr(event, "public_payload_json", "{}")
            try:
                payload = json.loads(raw) if isinstance(raw, str) else {}
            except json.JSONDecodeError:
                payload = {}
        if not isinstance(payload, dict):
            payload = {}
        output = _parse_output(payload)
        name = str(payload.get("tool_name") or "")
        records.append(
            {
                "tool_name": name,
                "ok": output.get("ok"),
                "code": output.get("code"),
                "status_code": output.get("status_code"),
                "reason": output.get("reason"),
                "message": str(output.get("message") or ""),
                "url": str(output.get("url") or output.get("final_url") or ""),
                "applied": output.get("applied"),
                "output": output,
            }
        )
    return records


def _is_mcp_tool(name: str) -> bool:
    return bool(name) and not name.startswith(_LOCAL_TOOL_PREFIXES)


def _fetch_blocker(record: dict[str, Any]) -> str | None:
    code = str(record.get("code") or "")
    status = record.get("status_code")
    message = (record.get("message") or "").lower()
    if code in {"url_blocked", "fetch_timeout", "fetch_failed", "http_403", "http_401"}:
        return "url_unreadable" if code != "url_blocked" else "url_blocked"
    if status in {401, 403, 407} or (isinstance(status, int) and int(status) >= 400):
        return "url_unreadable"
    if "login" in message or "sign in" in message:
        return "url_unreadable"
    return None


def _broker_blocker(record: dict[str, Any]) -> str | None:
    code = str(record.get("code") or "")
    if code in {"action_required", "broker_auth_failed"}:
        return "action_required"
    if code in {"empty", "not_found"}:
        return "empty"
    message = (record.get("message") or "").lower()
    if "empty" in message or "no holdings" in message:
        return "empty"
    return None


def _record_succeeded(record: dict[str, Any]) -> bool:
    if record.get("ok") is True:
        return True
    if record.get("ok") is False:
        return False
    output = record.get("output") or {}
    if isinstance(output, dict) and str(output.get("text") or "").strip():
        return True
    return False


def evidence_gaps(
    contract: EvidenceContract,
    events: Iterable[Any],
    *,
    final_text: str = "",
    sandbox_available: bool = False,
) -> EvidenceReport:
    records = _tool_records(events)
    gaps: list[EvidenceGap] = []
    blockers: list[str] = []

    if "link_fetch" in contract.required:
        fetches = [record for record in records if record["tool_name"] == "web_fetch"]
        hosts = {urlparse(url).hostname for url in contract.urls if urlparse(url).hostname}
        success = False
        blocker: str | None = None
        for record in fetches:
            host = urlparse(record.get("url") or "").hostname
            record_blocker = _fetch_blocker(record)
            if record.get("ok") is True and (not hosts or host in hosts or not host):
                success = True
                break
            if record_blocker:
                blocker = record_blocker
        if not success:
            if blocker:
                blockers.append(blocker)
                gaps.append(EvidenceGap("link_fetch", "pasted URL was not readable", blocker))
            else:
                gaps.append(EvidenceGap("link_fetch", "pasted URL was not fetched"))

    if "web_grounding" in contract.required:
        grounded = any(
            record["tool_name"] in {"web_search", "web_fetch"}
            and record.get("ok") is True
            and record.get("reason") != "budget_exhausted"
            for record in records
        ) or any(
            record["tool_name"].startswith("intel_") and _record_succeeded(record) for record in records
        ) or any(_is_mcp_tool(record["tool_name"]) and _record_succeeded(record) for record in records)
        if not grounded:
            if any(record["tool_name"] in {"web_search", "web_fetch"} and record.get("reason") == "budget_exhausted" for record in records):
                gaps.append(EvidenceGap("web_grounding", "search budget exhausted without a usable source"))
            else:
                gaps.append(EvidenceGap("web_grounding", "no public source was retrieved"))

    if "broker_read" in contract.required:
        broker_calls = [record for record in records if record["tool_name"].startswith("broker_")]
        success = any(_record_succeeded(record) for record in broker_calls)
        blocker = None
        if not success:
            for record in broker_calls:
                blocker = _broker_blocker(record)
                if blocker:
                    break
        if not success:
            if blocker:
                blockers.append(blocker)
                gaps.append(EvidenceGap("broker_read", "broker returned a typed blocker", blocker))
            else:
                gaps.append(EvidenceGap("broker_read", "no successful broker_* read"))

    if "calculation" in contract.required:
        calc_ok = any(record["tool_name"] == "sandbox_run_python" and record.get("ok") is True for record in records)
        if not calc_ok:
            if sandbox_available:
                gaps.append(EvidenceGap("calculation", "no sandbox_run_python result"))
            else:
                # OSS / no plane: waive if the answer shows arithmetic steps.
                if not re.search(r"\d", final_text or ""):
                    gaps.append(EvidenceGap("calculation", "no arithmetic was shown"))

    if "canvas" in contract.required:
        canvas_ok = any(
            record["tool_name"] in {"compose_surface", "patch_surface", "workspace_publish_html_artifact"}
            and (record.get("ok") is True or record.get("applied") is True)
            for record in records
        )
        if not canvas_ok:
            gaps.append(EvidenceGap("canvas", "desk/canvas was not published"))

    if "mcp_or_intel" in contract.required:
        news_ok = any(_is_mcp_tool(record["tool_name"]) and _record_succeeded(record) for record in records)
        if not news_ok:
            mcp_events = [
                event
                for event in events
                if (getattr(event, "event_type", None) or (event.get("event_type") if isinstance(event, dict) else ""))
                in {"mcp_unavailable", "mcp_inventory_refresh_failed"}
            ]
            if mcp_events:
                blockers.append("mcp_unavailable")
                gaps.append(EvidenceGap("mcp_or_intel", "MCP was unavailable", "mcp_unavailable"))
            else:
                gaps.append(EvidenceGap("mcp_or_intel", "no connected MCP news/summary result"))

    stripped = (final_text or "").strip()
    canvas_only = "canvas" in contract.required and not stripped
    if canvas_only:
        gaps.append(EvidenceGap("canvas", "canvas without a one-line pointer in chat"))

    unsatisfied = [gap for gap in gaps if gap.blocker is None]
    todos = infer_todos(contract, gaps)
    return EvidenceReport(
        contract=contract,
        gaps=gaps,
        blockers=list(dict.fromkeys(blockers)),
        status="satisfied" if not unsatisfied else "pending",
        todos=todos,
    )


def infer_todos(contract: EvidenceContract, gaps: list[EvidenceGap]) -> list[dict[str, str]]:
    kinds = list(contract.required)
    if len(kinds) < 3 and len(contract.urls) < 2:
        return []
    gap_by_kind = {gap.kind: gap for gap in gaps}
    todos: list[dict[str, str]] = []
    for index, kind in enumerate(kinds, start=1):
        gap = gap_by_kind.get(kind)
        if gap is None:
            state = "done"
        elif gap.blocker:
            state = "blocked"
        else:
            state = "pending"
        todos.append(
            {
                "id": f"t{index}",
                "label": _TODO_LABELS[kind],
                "state": state,
            }
        )
    return todos


def ui_todos(todos: list[dict[str, str]]) -> list[dict[str, str]]:
    mapped = []
    for item in todos:
        state = item.get("state") or "pending"
        status = "completed" if state in {"done", "blocked"} else "pending"
        content = item.get("label") or ""
        if state == "blocked":
            content = f"{content} (blocked)"
        mapped.append({"content": content, "status": status})
    return mapped


def evidence_nudge_message(report: EvidenceReport) -> str:
    missing = [gap.kind for gap in report.unsatisfied()]
    hints = [_NUDGE_HINTS[kind] for kind in missing if kind in _NUDGE_HINTS]
    lines = [
        "[harness nudge — not a user request]",
        evidence_status_line(report),
        "Still missing: " + "; ".join(hints) if hints else "Finish the user-facing answer.",
        "Then write the answer. If a source is unreadable, say so and finish.",
        "Do not mark the work complete until the contract is satisfied or a typed blocker is stated.",
    ]
    return "\n".join(lines)


def evidence_status_line(report: EvidenceReport) -> str:
    parts: list[str] = []
    gap_kinds = {gap.kind: gap for gap in report.gaps}
    for kind in report.contract.required:
        gap = gap_kinds.get(kind)
        if gap is None:
            parts.append(f"{kind} done")
        elif gap.blocker:
            parts.append(f"{kind} blocked:{gap.blocker}")
        else:
            parts.append(f"{kind} pending")
    if not parts:
        return "evidence: none required"
    return "evidence: " + "; ".join(parts)


def clarify_nudge_message() -> str:
    return (
        "[harness nudge — not a user request]\n"
        "The request is ambiguous. Assume a public-web briefing unless the user only wanted "
        "connected broker data. Prefer a URL, time horizon, or peer set if still unclear. "
        "Ask at most once, then proceed."
    )


def load_run_events(db: Session, run_id: str) -> list[BrokerChatEvent]:
    return list(
        db.scalars(
            select(BrokerChatEvent)
            .where(BrokerChatEvent.run_id == run_id)
            .order_by(BrokerChatEvent.sequence.asc())
        ).all()
    )


def persist_evidence(db: Session, run: BrokerChatRun, report: EvidenceReport) -> None:
    run.evidence_json = json.dumps(report.as_json(), ensure_ascii=False, separators=(",", ":"))
    db.add(run)
    db.commit()
    db.refresh(run)


def parse_evidence_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
