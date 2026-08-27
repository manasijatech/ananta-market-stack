"""Market intelligence and alert-read tools.

``intel_get_feed`` is attached to Broker Chat and Adaptive Workspace.
Alert-list tools stay Adaptive-only. These wrap Alpha feed cache and alert APIs
and never accept secrets.
"""

from __future__ import annotations

from typing import Any, Literal

from agents import RunContextWrapper, function_tool

from app.agent_tools.broker_tools import (
    BrokerAgentContext,
    _db,
    _error,
    _ok,
    _tool_call,
    _user_id,
)
from app.services import alerts as alert_svc
from app.services.alpha_feed_cache import ALPHA_FEED_PRODUCTS, list_cached_feed_items

AlphaProduct = Literal["news", "announcements", "earnings", "concalls", "alerts"]

_FEED_KEYS = (
    "symbol",
    "title",
    "headline",
    "specific_title",
    "summary",
    "published_at",
    "publishedAt",
    "source",
    "company_name",
    "reason",
    "date",
    "quarter",
    "url",
    "product",
)


def _summarize_feed_item(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {"value": str(item)[:240]}
    summary: dict[str, Any] = {}
    for key in _FEED_KEYS:
        value = item.get(key)
        if value is None or value == "":
            continue
        if isinstance(value, str):
            summary[key] = value[:400]
        else:
            summary[key] = value
    price = item.get("price_at_event")
    if isinstance(price, dict):
        summary["price_at_event"] = {
            "ltp": price.get("ltp"),
            "change_pct": price.get("change_pct"),
            "as_of": price.get("as_of"),
        }
    if "headline" not in summary and "title" not in summary:
        body = item.get("body") or item.get("content") or item.get("text")
        if isinstance(body, str) and body.strip():
            summary["summary"] = body.strip()[:400]
    return summary or {"keys": sorted(str(key) for key in item)[:12]}


def _is_adaptive(ctx: RunContextWrapper[BrokerAgentContext]) -> bool:
    context = getattr(ctx, "context", None)
    if isinstance(context, BrokerAgentContext):
        return bool(context.adaptive_workspace)
    if isinstance(context, dict):
        return bool(context.get("adaptive_workspace"))
    return bool(getattr(context, "adaptive_workspace", False))


def _dump(model: Any) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    if isinstance(model, dict):
        return model
    return {"value": str(model)}


@function_tool(strict_mode=False)
def intel_get_feed(
    ctx: RunContextWrapper[BrokerAgentContext],
    product: AlphaProduct,
    symbols: list[str],
    limit: int = 20,
    force_refresh: bool = True,
) -> dict[str, Any]:
    """Read Market Intelligence items (news, announcements, earnings, concalls, or alpha alerts).

    Pass watchlist symbols from broker_get_watchlist_symbols. Requires Alpha/Drishti
    to be configured. On Adaptive Workspace compose, keep ``force_refresh=true`` so
    Drishti is queried once and new rows are cached. Subsequent reads can pass
    force_refresh=false to reuse the DB cache.
    """

    def call() -> dict[str, Any]:
        cleaned = [str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()][:40]
        if product not in ALPHA_FEED_PRODUCTS:
            return _error(f"Unknown feed product {product!r}", code="invalid_product")
        if not cleaned:
            return _error("symbols are required", code="invalid_request")
        db = _db()
        try:
            payload = list_cached_feed_items(
                db,
                _user_id(ctx),
                product,
                cleaned,
                page=1,
                limit=max(1, min(limit, 50)),
                force_refresh=force_refresh,
            )
            items = payload.get("data") or []
            summarized = [_summarize_feed_item(item) for item in items[:30] if item]
            return _ok(
                product=product,
                symbols=cleaned,
                item_count=len(summarized),
                items=summarized,
                total=payload.get("total"),
                from_cache=payload.get("from_cache"),
                refreshed=bool(force_refresh or payload.get("synced_symbols")),
                has_next=payload.get("has_next"),
            )
        except ValueError as exc:
            return _error(str(exc), code="invalid_request")
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def intel_list_alert_workflows(
    ctx: RunContextWrapper[BrokerAgentContext],
    status: str | None = None,
) -> dict[str, Any]:
    """List this user's alert workflows (read-only). Use before composing alert widgets."""

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("intel_list_alert_workflows is only available on Adaptive Workspace runs")
        db = _db()
        try:
            rows = alert_svc.list_workflows(db, _user_id(ctx), status=status)
            summaries = []
            for row in rows[:40]:
                dumped = _dump(row)
                summaries.append(
                    {
                        "id": dumped.get("id"),
                        "name": dumped.get("name"),
                        "status": dumped.get("status"),
                        "symbol": dumped.get("symbol"),
                        "broker_code": dumped.get("broker_code"),
                        "updated_at": dumped.get("updated_at"),
                    }
                )
            return _ok(count=len(summaries), total=len(rows), workflows=summaries, truncated=len(rows) > 40)
        finally:
            db.close()

    return _tool_call(call)


@function_tool(strict_mode=False)
def intel_list_alert_notifications(
    ctx: RunContextWrapper[BrokerAgentContext],
    unread_only: bool = False,
    limit: int = 20,
) -> dict[str, Any]:
    """List recent alert notifications for this user (read-only)."""

    def call() -> dict[str, Any]:
        if not _is_adaptive(ctx):
            return _error("intel_list_alert_notifications is only available on Adaptive Workspace runs")
        db = _db()
        try:
            rows = alert_svc.list_alert_notifications(
                db,
                _user_id(ctx),
                unread_only=unread_only,
                limit=max(1, min(limit, 50)),
            )
            return _ok(
                count=len(rows),
                unread_only=unread_only,
                notifications=[
                    {
                        "id": dumped.get("id"),
                        "title": dumped.get("title"),
                        "message": dumped.get("message"),
                        "symbol": dumped.get("symbol"),
                        "level": dumped.get("level"),
                        "status": dumped.get("status"),
                        "is_read": dumped.get("is_read"),
                        "workflow_id": dumped.get("workflow_id"),
                        "created_at": dumped.get("created_at"),
                    }
                    for dumped in (_dump(row) for row in rows)
                ],
            )
        finally:
            db.close()

    return _tool_call(call)


INTEL_FEED_TOOLS = [intel_get_feed]
INTEL_TOOLS = [*INTEL_FEED_TOOLS, intel_list_alert_workflows, intel_list_alert_notifications]
