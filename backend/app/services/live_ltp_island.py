"""Closed grammar for Adaptive live LTP islands (canvas + copy flatten).

Keep in sync with frontend/lib/live-ltp-island.ts.
"""

from __future__ import annotations

import html
import re
from typing import Any

LIVE_LTP_MAX_ISLANDS = 24

_TOKEN_RE = re.compile(
    r"\{\{ltp:([A-Za-z0-9]+):([A-Za-z0-9._-]+)((?:\|[A-Za-z][A-Za-z0-9_]*=[^|}]+)+)?\}\}"
)
_TAG_RE = re.compile(r"<ananta-ltp\b([^>]*)(?:\/>|><\/ananta-ltp>|>)", re.I)
_SAFE_ATTR_KEYS = frozenset({"asOf", "chgPct", "kind", "ltp"})


def _parse_number(raw: str | None) -> float | None:
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value == value else None  # NaN check


def _parse_kind(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value in {"chgpct", "chg", "pct"}:
        return "chgPct"
    if value in {"ltp", "price"}:
        return "ltp"
    return "both"


def island_key(exchange: str, symbol: str) -> str:
    return f"{(exchange or 'NSE').strip().upper()}:{(symbol or '').strip().upper()}"


def _attrs_from_parts(exchange_raw: str, symbol_raw: str, pipe_attrs: str) -> dict[str, Any] | None:
    exchange = str(exchange_raw or "").strip().upper()
    symbol = str(symbol_raw or "").strip().upper()
    if not exchange or not symbol:
        return None
    if not re.fullmatch(r"[A-Z0-9]+", exchange) or not re.fullmatch(r"[A-Z0-9._-]+", symbol):
        return None
    bag: dict[str, str] = {}
    for part in (pipe_attrs or "").split("|"):
        if not part or "=" not in part:
            continue
        key, value = part.split("=", 1)
        key = key.strip()
        value = value.strip()
        if key not in _SAFE_ATTR_KEYS:
            continue
        if re.search(r"[<>\"'`]", value) or re.search(r"\bon\w+", value, re.I):
            continue
        bag[key] = value
    return {
        "asOf": bag.get("asOf"),
        "chgPct": _parse_number(bag.get("chgPct")),
        "exchange": exchange,
        "kind": _parse_kind(bag.get("kind")),
        "ltp": _parse_number(bag.get("ltp")),
        "symbol": symbol,
    }


def parse_live_ltp_token(token: str) -> dict[str, Any] | None:
    match = _TOKEN_RE.fullmatch(token.strip())
    if not match:
        return None
    return _attrs_from_parts(match.group(1), match.group(2), match.group(3) or "")


def parse_ananta_ltp_attribute_string(raw: str) -> dict[str, Any] | None:
    def get(name: str) -> str | None:
        match = re.search(rf'\bdata-{name}\s*=\s*["\']([^"\']*)["\']', raw or "", re.I)
        return match.group(1) if match else None

    symbol = (get("symbol") or "").strip().upper()
    exchange = (get("exchange") or "NSE").strip().upper()
    if not symbol or not re.fullmatch(r"[A-Z0-9._-]+", symbol) or not re.fullmatch(r"[A-Z0-9]+", exchange):
        return None
    return {
        "asOf": get("as-of"),
        "chgPct": _parse_number(get("chg-pct")),
        "exchange": exchange,
        "kind": _parse_kind(get("kind")),
        "ltp": _parse_number(get("ltp")),
        "symbol": symbol,
    }


def format_live_ltp_flatten(symbol: str, displayed: dict[str, float | None], kind: str = "both") -> str:
    sym = (symbol or "").strip().upper() or "—"
    ltp = displayed.get("ltp")
    chg = displayed.get("chgPct")
    ltp_text = f"{ltp:,.2f}" if ltp is not None else None
    chg_text = None
    if chg is not None:
        sign = "+" if chg >= 0 else ""
        chg_text = f"{sign}{chg:.2f}%"
    if kind == "ltp":
        return f"{sym} {ltp_text}" if ltp_text else sym
    if kind == "chgPct":
        return f"{sym} ({chg_text})" if chg_text else sym
    if ltp_text and chg_text:
        return f"{sym} {ltp_text} ({chg_text})"
    if ltp_text:
        return f"{sym} {ltp_text}"
    if chg_text:
        return f"{sym} ({chg_text})"
    return f"{sym} —"


def serialize_ananta_ltp_element(attrs: dict[str, Any]) -> str:
    parts = [
        f'data-symbol="{html.escape(str(attrs["symbol"]), quote=True)}"',
        f'data-exchange="{html.escape(str(attrs["exchange"]), quote=True)}"',
        f'data-kind="{html.escape(str(attrs.get("kind") or "both"), quote=True)}"',
    ]
    if attrs.get("ltp") is not None:
        parts.append(f'data-ltp="{attrs["ltp"]}"')
    if attrs.get("chgPct") is not None:
        parts.append(f'data-chg-pct="{attrs["chgPct"]}"')
    if attrs.get("asOf"):
        parts.append(f'data-as-of="{html.escape(str(attrs["asOf"]), quote=True)}"')
    return f'<ananta-ltp {" ".join(parts)}></ananta-ltp>'


def flatten_live_ltp_islands(
    text: str,
    displayed: dict[str, dict[str, float | None]] | None = None,
    max_islands: int = LIVE_LTP_MAX_ISLANDS,
) -> str:
    displayed = displayed or {}
    count = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal count
        attrs = _attrs_from_parts(match.group(1), match.group(2), match.group(3) or "")
        if not attrs:
            return match.group(0)
        count += 1
        key = island_key(attrs["exchange"], attrs["symbol"])
        live = displayed.get(key) or {}
        values = {
            "ltp": live.get("ltp", attrs.get("ltp")),
            "chgPct": live.get("chgPct", attrs.get("chgPct")),
        }
        return format_live_ltp_flatten(attrs["symbol"], values, attrs.get("kind") or "both")

    return _TOKEN_RE.sub(repl, text)


def live_ltp_tokens_to_elements(text: str, max_islands: int = LIVE_LTP_MAX_ISLANDS) -> str:
    count = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal count
        attrs = _attrs_from_parts(match.group(1), match.group(2), match.group(3) or "")
        if not attrs:
            return match.group(0)
        count += 1
        if count > max_islands:
            return format_live_ltp_flatten(
                attrs["symbol"],
                {"ltp": attrs.get("ltp"), "chgPct": attrs.get("chgPct")},
                attrs.get("kind") or "both",
            )
        return serialize_ananta_ltp_element(attrs)

    return _TOKEN_RE.sub(repl, text)


def sanitize_ananta_ltp_elements(html_text: str, max_islands: int = LIVE_LTP_MAX_ISLANDS) -> str:
    count = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal count
        attrs = parse_ananta_ltp_attribute_string(match.group(1) or "")
        if not attrs:
            return ""
        count += 1
        if count > max_islands:
            return format_live_ltp_flatten(
                attrs["symbol"],
                {"ltp": attrs.get("ltp"), "chgPct": attrs.get("chgPct")},
                attrs.get("kind") or "both",
            )
        return serialize_ananta_ltp_element(attrs)

    return _TAG_RE.sub(repl, html_text)


def prepare_live_ltp_in_html(document: str, max_islands: int = LIVE_LTP_MAX_ISLANDS) -> str:
    """Convert tokens then rewrite any ananta-ltp tags to allowlisted attrs only."""
    text = live_ltp_tokens_to_elements(document or "", max_islands=max_islands)
    return sanitize_ananta_ltp_elements(text, max_islands=max_islands)


def extract_live_ltp_symbols(document: str, max_islands: int = LIVE_LTP_MAX_ISLANDS) -> list[dict[str, str]]:
    prepared = prepare_live_ltp_in_html(document, max_islands=max_islands)
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for match in _TAG_RE.finditer(prepared):
        attrs = parse_ananta_ltp_attribute_string(match.group(1) or "")
        if not attrs:
            continue
        key = island_key(attrs["exchange"], attrs["symbol"])
        if key in seen:
            continue
        seen.add(key)
        out.append({"exchange": attrs["exchange"], "symbol": attrs["symbol"]})
        if len(out) >= max_islands:
            break
    return out
