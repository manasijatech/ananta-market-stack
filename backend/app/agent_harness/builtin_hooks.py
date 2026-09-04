"""Built-in context hooks shared by OSS and enterprise (plan 05)."""

from __future__ import annotations

from typing import Any

from app.agent_harness.hooks import HookContext, HookResult, register_hook
from app.agent_harness.hook_world import (
    broker_health_snapshot,
    holdings_snapshot,
    intel_pulse_snapshot,
    watchlists_snapshot,
)
from app.agent_harness.model_context import freeze_truncate, stable_json, strip_secrets


def _collect_symbols(value: Any, into: list[str], seen: set[str]) -> None:
    if isinstance(value, str):
        for part in value.replace(",", " ").split():
            symbol = part.strip().upper()
            if symbol and symbol not in seen and len(symbol) <= 32:
                seen.add(symbol)
                into.append(symbol)
        return
    if isinstance(value, dict):
        for key in ("symbol", "symbols", "ticker", "tickers", "underlying"):
            if key in value:
                _collect_symbols(value[key], into, seen)
        props = value.get("props")
        if isinstance(props, dict):
            _collect_symbols(props, into, seen)
        return
    if isinstance(value, list):
        for item in value[:40]:
            _collect_symbols(item, into, seen)


def compact_desk_spec(spec: dict[str, Any] | None, *, selected_component_id: str | None = None) -> dict[str, Any]:
    """Replace a full WorkspaceSpec dump with a compact, tool-friendly sketch."""
    if not isinstance(spec, dict):
        return {"components": [], "symbols": [], "watchlist_ids": []}

    components_in = spec.get("components") if isinstance(spec.get("components"), list) else []
    components: list[dict[str, Any]] = []
    symbols: list[str] = []
    watchlist_ids: list[str] = []
    seen_symbols: set[str] = set()
    seen_watchlists: set[str] = set()

    for item in components_in[:32]:
        if not isinstance(item, dict):
            continue
        entry = {
            "id": item.get("id"),
            "type": item.get("type"),
            "title": item.get("title"),
        }
        props = item.get("props") if isinstance(item.get("props"), dict) else {}
        local_symbols: list[str] = []
        _collect_symbols(props, local_symbols, set())
        _collect_symbols(item.get("symbol"), local_symbols, set(local_symbols))
        if local_symbols:
            entry["symbols"] = local_symbols[:8]
            for symbol in local_symbols:
                if symbol not in seen_symbols:
                    seen_symbols.add(symbol)
                    symbols.append(symbol)
        wl = props.get("watchlistId") or props.get("watchlist_id") or item.get("watchlist_id")
        if isinstance(wl, str) and wl.strip() and wl not in seen_watchlists:
            seen_watchlists.add(wl)
            watchlist_ids.append(wl)
            entry["watchlist_id"] = wl
        components.append(entry)

    omitted = max(0, len(components_in) - len(components))
    out: dict[str, Any] = {
        "components": components,
        "symbols": symbols[:40],
        "watchlist_ids": watchlist_ids[:16],
    }
    if selected_component_id:
        out["selected_component_id"] = selected_component_id
    if omitted:
        out["components_omitted"] = omitted
        out["truncated"] = True
    title = spec.get("title") or spec.get("name")
    if title:
        out["desk_title"] = title
    return strip_secrets(out)


def _json_hook_markdown(lead: str, payload: dict[str, Any], budget: int) -> tuple[str, bool]:
    encoded = stable_json(payload)
    clipped, truncated = freeze_truncate(encoded, max(120, budget - len(lead) - 20))
    markdown = f"{lead}\n```json\n{clipped}\n```"
    return markdown, truncated


class DeskSpecHook:
    id = "desk_spec"
    priority = 10

    def applies(self, ctx: HookContext) -> bool:
        return bool(ctx.adaptive_workspace and ctx.workspace_spec)

    def budget_chars(self) -> int:
        return 2_500

    def render(self, ctx: HookContext) -> HookResult | None:
        sketch = compact_desk_spec(ctx.workspace_spec, selected_component_id=ctx.selected_component_id)
        if not sketch.get("components") and not sketch.get("symbols"):
            markdown = "Desk: empty or no components yet."
            return HookResult(title="Desk", markdown=markdown, audit={"desk": sketch})
        markdown, truncated = _json_hook_markdown(
            "Current Adaptive Workspace desk (compact). Prefer patch_surface over rewriting the whole desk.",
            sketch,
            self.budget_chars(),
        )
        return HookResult(
            title="Desk",
            markdown=markdown,
            audit={"desk": sketch, "truncated": truncated},
            truncated=truncated,
        )


class SandboxStatusHook:
    id = "sandbox_status"
    priority = 15

    def applies(self, ctx: HookContext) -> bool:
        return bool(ctx.adaptive_workspace)

    def budget_chars(self) -> int:
        return 240

    def render(self, ctx: HookContext) -> HookResult | None:
        available = bool(ctx.sandbox_available)
        markdown = (
            f"calculator_available: {str(available).lower()}. "
            "Use sandbox_run_python for numeric work when true; never mention sandboxes or VMs to the user."
        )
        return HookResult(
            title="Calculator",
            markdown=markdown,
            audit={"calculator_available": available},
        )


class BrokerHealthHook:
    id = "broker_health"
    priority = 20

    def applies(self, ctx: HookContext) -> bool:
        return bool(ctx.adaptive_workspace)

    def budget_chars(self) -> int:
        return 1_200

    def render(self, ctx: HookContext) -> HookResult | None:
        snapshot = broker_health_snapshot(ctx.db, ctx.user_id)
        if snapshot is None:
            return None
        markdown, truncated = _json_hook_markdown(
            "Connected brokers (session hint). If action_required, guide the user to refresh — do not ask for secrets in chat.",
            snapshot,
            self.budget_chars(),
        )
        return HookResult(
            title="Brokers",
            markdown=markdown,
            audit={"broker_health": snapshot, "truncated": truncated},
            truncated=truncated,
        )


class WatchlistsHook:
    id = "watchlists"
    priority = 25

    def applies(self, ctx: HookContext) -> bool:
        return bool(ctx.adaptive_workspace)

    def budget_chars(self) -> int:
        return 1_600

    def render(self, ctx: HookContext) -> HookResult | None:
        snapshot = watchlists_snapshot(ctx.db, ctx.user_id)
        if snapshot is None:
            return None
        markdown, truncated = _json_hook_markdown(
            "User watchlists (preview). Use broker_get_watchlist_symbols for the full list.",
            snapshot,
            self.budget_chars(),
        )
        return HookResult(
            title="Watchlists",
            markdown=markdown,
            audit={"watchlists": {"count": snapshot.get("count"), "truncated": truncated}},
            truncated=truncated,
        )


class HoldingsSnapshotHook:
    id = "holdings_snapshot"
    priority = 30

    def applies(self, ctx: HookContext) -> bool:
        return bool(ctx.adaptive_workspace and ctx.inject_holdings)

    def budget_chars(self) -> int:
        return 1_800

    def render(self, ctx: HookContext) -> HookResult | None:
        snapshot = holdings_snapshot(
            ctx.db,
            ctx.user_id,
            preferred_account_id=ctx.default_account_id,
        )
        if snapshot is None:
            return None
        markdown, truncated = _json_hook_markdown(
            "Holdings snapshot (as-of now). Hint only — broker_get_portfolio wins if numbers disagree.",
            snapshot,
            self.budget_chars(),
        )
        return HookResult(
            title="Holdings",
            markdown=markdown,
            audit={
                "holdings": {
                    "account_id": snapshot.get("account_id"),
                    "count": snapshot.get("holdings_count") or len(snapshot.get("holdings") or []),
                    "action_required": snapshot.get("action_required"),
                    "from_cache": snapshot.get("from_cache"),
                    "truncated": truncated or snapshot.get("truncated"),
                }
            },
            truncated=truncated or bool(snapshot.get("truncated")),
        )


class IntelPulseHook:
    id = "intel_pulse"
    priority = 40

    def applies(self, ctx: HookContext) -> bool:
        return bool(ctx.adaptive_workspace)

    def budget_chars(self) -> int:
        return 1_400

    def render(self, ctx: HookContext) -> HookResult | None:
        desk = compact_desk_spec(ctx.workspace_spec, selected_component_id=ctx.selected_component_id)
        symbols = list(desk.get("symbols") or [])
        if not symbols:
            # Fall back to a few symbols from the watchlists preview when desk is empty.
            wl = watchlists_snapshot(ctx.db, ctx.user_id)
            if wl:
                for item in wl.get("lists") or []:
                    for symbol in item.get("symbols") or []:
                        if symbol not in symbols:
                            symbols.append(symbol)
                        if len(symbols) >= 8:
                            break
                    if len(symbols) >= 8:
                        break
        snapshot = intel_pulse_snapshot(
            ctx.db,
            ctx.user_id,
            symbols,
            mcp_enabled=ctx.mcp_enabled,
        )
        if snapshot is None:
            return None
        markdown, truncated = _json_hook_markdown(
            "Recent intel headlines for desk/watchlist symbols (cache hints).",
            snapshot,
            self.budget_chars(),
        )
        return HookResult(
            title="Intel",
            markdown=markdown,
            audit={
                "intel_pulse": {
                    "headline_count": len(snapshot.get("headlines") or []),
                    "symbols": snapshot.get("symbols"),
                    "from_cache": snapshot.get("from_cache"),
                }
            },
            truncated=truncated,
        )


def register_builtin_hooks() -> None:
    register_hook(DeskSpecHook())
    register_hook(SandboxStatusHook())
    register_hook(BrokerHealthHook())
    register_hook(WatchlistsHook())
    register_hook(HoldingsSnapshotHook())
    register_hook(IntelPulseHook())
