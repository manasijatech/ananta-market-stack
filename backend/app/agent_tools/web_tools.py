"""Public web lookup tools for Adaptive Workspace research.

Fetches happen on the API host, not inside the sandbox (sandbox has no network).
Pass extracted numbers into calculation tools when math is needed.
"""

from __future__ import annotations

import html
import ipaddress
import re
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import httpx
from agents import RunContextWrapper, function_tool

from app.agent_tools.broker_tools import BrokerAgentContext, _error, _ok

MAX_BYTES = 1_500_000
MAX_TEXT_CHARS = 24_000
MAX_HTML_CHARS = 12_000
MAX_SEARCHES_PER_RUN = 3
MAX_FETCHES_PER_RUN = 6
FETCH_TIMEOUT = 20.0
SEARCH_TIMEOUT = 15.0
USER_AGENT = (
    "Mozilla/5.0 (compatible; AnantaResearch/1.0; +https://ananta.local) "
    "AppleWebKit/537.36 Chrome/124.0.0.0"
)

_BLOCKED_NETWORKS = (
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip = 0
        self._chunks: list[str] = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.lower()
        if lowered in {"script", "style", "noscript", "svg", "iframe"}:
            self._skip += 1
            return
        if lowered == "title":
            self._in_title = True
        if lowered in {"p", "div", "tr", "li", "h1", "h2", "h3", "h4", "br", "table"}:
            self._chunks.append("\n")
        if lowered in {"td", "th", "span"}:
            self._chunks.append(" ")

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in {"script", "style", "noscript", "svg", "iframe"} and self._skip:
            self._skip -= 1
        if lowered == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        text = re.sub(r"\s+", " ", data).strip()
        if not text:
            return
        if self._in_title and not self.title:
            self.title = text
        self._chunks.append(text)

    def text(self) -> str:
        joined = " ".join(self._chunks)
        return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", joined)).strip()


def _host_is_blocked(hostname: str) -> bool:
    host = (hostname or "").strip().strip("[]").lower()
    if not host or host in {"localhost", "metadata.google.internal"}:
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if any(ip in network for network in _BLOCKED_NETWORKS):
            return True
    return False


def _validate_public_url(url: str) -> str:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("only http and https URLs are allowed")
    if not parsed.hostname:
        raise ValueError("URL host is required")
    if _host_is_blocked(parsed.hostname):
        raise ValueError("that host is not allowed")
    return parsed.geturl()


def _extract(html_body: str) -> tuple[str, str]:
    parser = _TextExtractor()
    try:
        parser.feed(html_body)
        parser.close()
    except Exception:
        pass
    text = html.unescape(parser.text())
    title = parser.title or ""
    return title, text


def _truncate(value: str, limit: int) -> tuple[str, bool]:
    if len(value) <= limit:
        return value, False
    return value[:limit].rstrip() + "\n…", True


def fetch_public_url(url: str) -> dict[str, Any]:
    try:
        target = _validate_public_url(url)
    except ValueError as exc:
        return _error(str(exc), code="url_blocked")
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"}
    try:
        with httpx.Client(follow_redirects=True, timeout=FETCH_TIMEOUT, headers=headers) as client:
            response = client.get(target)
            final = str(response.url)
            try:
                _validate_public_url(final)
            except ValueError as exc:
                return _error(str(exc), code="url_blocked")
            body = response.content[:MAX_BYTES].decode("utf-8", errors="replace")
            status_code = response.status_code
            content_type = response.headers.get("content-type", "")
    except httpx.TimeoutException:
        return _error("the page timed out", code="fetch_timeout")
    except httpx.HTTPError as exc:
        return _error(str(exc), code="fetch_failed")
    title, text = _extract(body)
    text, text_truncated = _truncate(text, MAX_TEXT_CHARS)
    html_snippet, html_truncated = _truncate(body, MAX_HTML_CHARS)
    return _ok(
        url=target,
        final_url=final,
        status_code=status_code,
        title=title,
        text=text,
        html=html_snippet,
        truncated=text_truncated or html_truncated,
        content_type=content_type,
    )


def _ddg_results(html_body: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    for match in re.finditer(
        r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        html_body,
        flags=re.I | re.S,
    ):
        href = html.unescape(match.group(1))
        title = re.sub(r"<[^>]+>", "", html.unescape(match.group(2)))
        parsed = urlparse(href)
        if parsed.path.endswith("/l/") and "uddg" in (parsed.query or ""):
            href = unquote(parse_qs(parsed.query).get("uddg", [href])[0])
        href = urljoin("https://duckduckgo.com", href)
        results.append({"title": re.sub(r"\s+", " ", title).strip(), "url": href})
        if len(results) >= 8:
            break
    return results


def search_public_web(query: str) -> dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return _error("query is required", code="query_required")
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html"}
    try:
        with httpx.Client(follow_redirects=True, timeout=SEARCH_TIMEOUT, headers=headers) as client:
            response = client.post("https://html.duckduckgo.com/html/", data={"q": q})
            body = response.content[:MAX_BYTES].decode("utf-8", errors="replace")
    except httpx.TimeoutException:
        return _error("search timed out", code="search_timeout")
    except httpx.HTTPError as exc:
        return _error(str(exc), code="search_failed")
    results = _ddg_results(body)
    return _ok(query=q, count=len(results), results=results)


def _usage(ctx: RunContextWrapper[BrokerAgentContext]) -> dict[str, int]:
    context = getattr(ctx, "context", None)
    if isinstance(context, dict):
        usage = context.setdefault("web_usage", {})
        if isinstance(usage, dict):
            return usage
        return {}
    usage = getattr(context, "web_usage", None)
    if not isinstance(usage, dict):
        usage = {}
        if context is not None:
            try:
                context.web_usage = usage
            except Exception:
                return {}
    return usage


def _bump(ctx: RunContextWrapper[BrokerAgentContext], key: str, limit: int) -> dict[str, Any] | None:
    usage = _usage(ctx)
    used = int(usage.get(key) or 0)
    if used >= limit:
        return _ok(
            stopped=True,
            reason="budget_exhausted",
            message=(
                f"Stop calling {key}. You already used {used} of {limit}. "
                "Write the answer from results you already have, or web_fetch remaining URLs if search budget is what ran out."
            ),
            used=used,
            limit=limit,
        )
    usage[key] = used + 1
    return None


@function_tool(strict_mode=False)
def web_fetch(
    ctx: RunContextWrapper[BrokerAgentContext],
    url: str,
) -> dict[str, Any]:
    """Open a public http(s) URL and return extracted text plus a truncated HTML snippet.

    Use when the user pastes a link (Screener, exchange filings, news, blogs).
    Login walls and private IPs are not supported. Do not mention the fetch
    implementation to the user.
    """
    blocked = _bump(ctx, "fetch", MAX_FETCHES_PER_RUN)
    if blocked:
        return blocked
    return fetch_public_url(url)


@function_tool(strict_mode=False)
def web_search(
    ctx: RunContextWrapper[BrokerAgentContext],
    query: str,
) -> dict[str, Any]:
    """Search the public web. Use for names, filings, or pages not in MCP/intel.

    Follow interesting result URLs with web_fetch. Do not mention the search
    engine to the user unless asked.
    """
    blocked = _bump(ctx, "search", MAX_SEARCHES_PER_RUN)
    if blocked:
        return blocked
    return search_public_web(query)


WEB_TOOLS = [web_search, web_fetch]
