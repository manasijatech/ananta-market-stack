"""First-party Adaptive Workspace canvas kit.

The model must not invent CSS. It authors semantic HTML using these classes.
The host injects this stylesheet into every html-artifact iframe so canvases
match Ananta (charcoal surface, gold #ffcd2e, muted type, no rainbow pills).
"""

from __future__ import annotations

import re
from typing import Any

CANVAS_KINDS = ("briefing", "timeline", "snapshot", "comparison", "movers", "notes")

CANVAS_KIT_VERSION = "1"

_STYLE_TAG_RE = re.compile(r"<style\b[^>]*>.*?</style>", re.I | re.S)
_STYLE_ATTR_RE = re.compile(r"\sstyle\s*=\s*(['\"]).*?\1", re.I | re.S)
_CLASS_ATTR_RE = re.compile(r"\sclass\s*=\s*['\"]([^'\"]*)['\"]", re.I)
_BODY_INNER_RE = re.compile(r"<body\b[^>]*>(.*)</body>", re.I | re.S)

# Classes the agent is allowed to use. Unknown classes are stripped.
ALLOWED_CLASSES = frozenset(
    {
        "aw",
        "aw-kicker",
        "aw-h",
        "aw-sub",
        "aw-meta",
        "aw-stack",
        "aw-row",
        "aw-grid-2",
        "aw-grid-3",
        "aw-card",
        "aw-stats",
        "aw-stat",
        "aw-stat__label",
        "aw-stat__value",
        "aw-stat__delta",
        "aw-up",
        "aw-down",
        "aw-flat",
        "aw-table-wrap",
        "aw-table",
        "aw-tl",
        "aw-tl__item",
        "aw-tl__when",
        "aw-tl__body",
        "aw-pill",
        "aw-pill--accent",
        "aw-pill--muted",
        "aw-list",
        "aw-src",
        "aw-split",
        "aw-bar",
        "aw-bar__track",
        "aw-bar__fill",
        "aw-rule",
        "aw-lead",
    }
)

CANVAS_KIT_CSS = """
:root {
  --aw-bg: #1c1c1c;
  --aw-fg: #f4f4f5;
  --aw-muted: #a1a1aa;
  --aw-surface: #2a2a2a;
  --aw-line: rgba(255,255,255,0.10);
  --aw-gold: #ffcd2e;
  --aw-gold-ink: #131722;
  --aw-up: #34d399;
  --aw-down: #f87171;
  --aw-pad: 12px;
}
html, body {
  margin: 0;
  padding: 0;
  background: var(--aw-bg);
  color: var(--aw-fg);
  font: 12.5px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.aw {
  padding: var(--aw-pad);
  min-height: 100%;
  box-sizing: border-box;
}
.aw-kicker {
  margin: 0 0 4px;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--aw-gold);
}
.aw-h {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--aw-fg);
}
.aw-sub, .aw-lead {
  margin: 6px 0 0;
  color: var(--aw-muted);
  font-size: 12px;
}
.aw-meta, .aw-src {
  margin: 8px 0 0;
  color: var(--aw-muted);
  font-size: 11px;
}
.aw-stack { display: flex; flex-direction: column; gap: 12px; }
.aw-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.aw-grid-2, .aw-grid-3 {
  display: grid;
  gap: 10px;
}
.aw-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.aw-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 520px) {
  .aw-grid-2, .aw-grid-3 { grid-template-columns: 1fr; }
}
.aw-card {
  background: var(--aw-surface);
  border: 1px solid var(--aw-line);
  border-radius: 8px;
  padding: 10px 12px;
}
.aw-rule {
  height: 1px;
  background: var(--aw-line);
  border: 0;
  margin: 2px 0;
}
.aw-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 8px;
}
.aw-stat { min-width: 0; }
.aw-stat__label {
  display: block;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--aw-muted);
}
.aw-stat__value {
  display: block;
  margin-top: 2px;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
.aw-stat__delta {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.aw-up { color: var(--aw-up); }
.aw-down { color: var(--aw-down); }
.aw-flat { color: var(--aw-muted); }
.aw-table-wrap { overflow: auto; }
.aw-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.aw-table th {
  text-align: left;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--aw-muted);
  border-bottom: 1px solid var(--aw-line);
  padding: 6px 8px 6px 0;
}
.aw-table td {
  padding: 7px 8px 7px 0;
  border-bottom: 1px solid var(--aw-line);
  vertical-align: top;
}
.aw-table tr:last-child td { border-bottom: 0; }
.aw-tl { display: flex; flex-direction: column; gap: 10px; }
.aw-tl__item {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}
.aw-tl__when {
  font-size: 11px;
  font-weight: 650;
  color: var(--aw-gold);
  padding-top: 1px;
}
.aw-tl__body { min-width: 0; color: var(--aw-fg); }
.aw-pill {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--aw-line);
  background: transparent;
  color: var(--aw-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.aw-pill--accent {
  background: var(--aw-gold);
  border-color: var(--aw-gold);
  color: var(--aw-gold-ink);
}
.aw-pill--muted { color: var(--aw-muted); }
.aw-list { margin: 0; padding-left: 16px; }
.aw-list li { margin: 0 0 6px; }
.aw-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 520px) { .aw-split { grid-template-columns: 1fr; } }
.aw-bar__track {
  height: 6px;
  border-radius: 99px;
  background: var(--aw-line);
  overflow: hidden;
}
.aw-bar__fill {
  height: 100%;
  background: var(--aw-gold);
  border-radius: 99px;
}
""".strip()

CANVAS_CLASS_CATALOG: list[dict[str, str]] = [
    {"class": "aw", "use": "Root wrapper. Always wrap the body fragment in <div class='aw'>."},
    {"class": "aw-kicker", "use": "Eyebrow label above the title (e.g. Timeline · GABRIEL)."},
    {"class": "aw-h", "use": "Main heading. One per canvas."},
    {"class": "aw-sub / aw-lead", "use": "One-line summary under the heading."},
    {"class": "aw-meta / aw-src", "use": "Source + as-of line. Small muted caption."},
    {"class": "aw-stack", "use": "Vertical rhythm between sections."},
    {"class": "aw-row", "use": "Wrap pills or inline controls."},
    {"class": "aw-grid-2 / aw-grid-3", "use": "Equal columns for cards or stats groups."},
    {"class": "aw-card", "use": "Optional surface for a secondary section. Do not wrap every block."},
    {"class": "aw-stats + aw-stat*", "use": "KPI strip: label, value, optional delta with aw-up/aw-down."},
    {"class": "aw-table-wrap + aw-table", "use": "Compact data table. No zebra, no colored headers."},
    {"class": "aw-tl*", "use": "Dated activity list. Gold date, body text. Not rainbow date pills."},
    {"class": "aw-pill / --accent / --muted", "use": "Sparse tags (product, exchange). Accent is gold only."},
    {"class": "aw-list", "use": "Bullets when a table is too heavy."},
    {"class": "aw-split", "use": "Two purposeful columns (e.g. activity | earnings)."},
    {"class": "aw-bar*", "use": "Simple proportion bar. Fill width via inline style ONLY on aw-bar__fill as width:N%."},
    {"class": "aw-rule", "use": "Hairline divider."},
]

CANVAS_KIND_GUIDE: dict[str, str] = {
    "briefing": "Kicker + heading + lead + stats + 4–8 bullets or a small table. One canvas.",
    "timeline": "Kicker + heading + aw-tl items (date + event). Newest first.",
    "snapshot": "Kicker + heading + aw-stats (4–6 KPIs) + optional one table.",
    "comparison": "Heading + aw-table of names vs metrics. No duplicate intel-feed.",
    "movers": "Heading + table of symbol, last, change%. Gold accent only on the title kicker.",
    "notes": "Heading + short lead. Prefer notes-block for editable desk notes.",
}

_BAR_OPEN_RE = re.compile(
    r"<([a-zA-Z0-9]+)([^>]*\bclass=['\"][^'\"]*\baw-bar__fill\b[^'\"]*['\"][^>]*)>",
    re.I,
)


def normalize_kind(value: str | None) -> str:
    raw = (value or "briefing").strip().lower()
    return raw if raw in CANVAS_KINDS else "briefing"


def strip_agent_css(html: str) -> str:
    """Drop author stylesheets. Keep a single width:% on .aw-bar__fill."""

    text = _STYLE_TAG_RE.sub("", html or "")
    widths: list[str | None] = []

    def capture_bar(match: re.Match[str]) -> str:
        tag = match.group(0)
        width_match = re.search(r"width\s*:\s*([0-9]{1,3}(?:\.[0-9]+)?%)", tag, re.I)
        widths.append(width_match.group(1) if width_match else None)
        return _STYLE_ATTR_RE.sub("", tag)

    text = _BAR_OPEN_RE.sub(capture_bar, text)
    text = _STYLE_ATTR_RE.sub("", text)
    index = 0

    def restore_bar(match: re.Match[str]) -> str:
        nonlocal index
        tag = match.group(0)
        width = widths[index] if index < len(widths) else None
        index += 1
        if not width:
            return tag
        if tag.endswith("/>"):
            return f'{tag[:-2]} style="width:{width}" />'
        return f'{tag[:-1]} style="width:{width}">'

    return _BAR_OPEN_RE.sub(restore_bar, text)


def _filter_class_attr(match: re.Match[str]) -> str:
    names = [part for part in match.group(1).split() if part in ALLOWED_CLASSES]
    if not names:
        return ""
    return f' class="{" ".join(names)}"'


def filter_unknown_classes(html: str) -> str:
    return _CLASS_ATTR_RE.sub(_filter_class_attr, html)


def extract_canvas_body(document: str) -> str:
    raw = (document or "").strip()
    body = _BODY_INNER_RE.search(raw)
    if body:
        return body.group(1).strip()
    return raw


def wrap_canvas_document(body_html: str) -> str:
    inner = body_html.strip()
    if not re.search(r"class=['\"][^'\"]*\baw\b", inner):
        inner = f'<div class="aw">{inner}</div>'
    css = CANVAS_KIT_CSS.replace("</", "<\\/")
    return (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/>"
        "<meta name=\"color-scheme\" content=\"dark\"/>"
        f"<style>{css}</style></head><body>{inner}</body></html>"
    )


def prepare_canvas_html(document: str) -> str:
    body = extract_canvas_body(document)
    body = strip_agent_css(body)
    body = filter_unknown_classes(body)
    if not body.strip():
        raise ValueError("document is empty after sanitization")
    return wrap_canvas_document(body)


def canvas_inventory(spec: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(spec, dict):
        return []
    components = spec.get("components")
    if not isinstance(components, list):
        return []
    out: list[dict[str, Any]] = []
    for item in components:
        if not isinstance(item, dict) or item.get("type") != "html-artifact":
            continue
        props = item.get("props") if isinstance(item.get("props"), dict) else {}
        out.append(
            {
                "id": item.get("id"),
                "kind": normalize_kind(str(props.get("kind") or "")),
                "title": str(props.get("title") or "Canvas").strip() or "Canvas",
            }
        )
    return out


def authoring_canvas_docs() -> dict[str, Any]:
    return {
        "version": CANVAS_KIT_VERSION,
        "kinds": list(CANVAS_KINDS),
        "kind_guide": CANVAS_KIND_GUIDE,
        "classes": CANVAS_CLASS_CATALOG,
        "rules": [
            "Do not write <style> or color/background inline styles. The kit is injected.",
            "Only aw-* classes from the catalog. Unknown classes are stripped.",
            "Exception: aw-bar__fill may use style='width:NN%'.",
            "No emoji, gradients, box-shadows, or rainbow date pills.",
            "One purpose per canvas. Add a second html-artifact for a second purpose.",
            "Call workspace_get_current, then workspace_update_html_artifact(component_id) to evolve an existing canvas.",
            "Live quotes/charts/feeds stay on first-party widgets, not in HTML.",
        ],
        "example": (
            "<div class='aw'><div class='aw-stack'>"
            "<p class='aw-kicker'>Timeline</p>"
            "<h2 class='aw-h'>Gabriel India — last 30 days</h2>"
            "<p class='aw-meta'>Source: Drishti MCP · as of 26 Aug 2026</p>"
            "<div class='aw-tl'><div class='aw-tl__item'>"
            "<div class='aw-tl__when'>28 Aug</div>"
            "<div class='aw-tl__body'>JV with HL Klemove for ADAS.</div>"
            "</div></div></div></div>"
        ),
    }
