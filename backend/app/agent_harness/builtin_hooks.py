"""Built-in context hooks shared by OSS and enterprise (plan 05 wave 1+)."""

from __future__ import annotations

from typing import Any

from app.agent_harness.hooks import ContextHook, HookContext, HookResult, register_hook
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
            # Still useful to say the desk is empty/minimal.
            markdown = "Desk: empty or no components yet."
            return HookResult(title="Desk", markdown=markdown, audit={"desk": sketch})
        encoded = stable_json(sketch)
        clipped, truncated = freeze_truncate(encoded, self.budget_chars() - 80)
        markdown = (
            "Current Adaptive Workspace desk (compact). Prefer patch_surface over "
            "rewriting the whole desk.\n"
            f"```json\n{clipped}\n```"
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


def register_builtin_hooks() -> None:
    register_hook(DeskSpecHook())
    register_hook(SandboxStatusHook())
