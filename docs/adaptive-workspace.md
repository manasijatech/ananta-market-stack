# Adaptive Workspace

Preview surface for Ananta’s agentic desk. Conversation is the control layer. The main area is a persistent, editable canvas composed from trusted Ananta components. The agent emits a typed `WorkspaceSpec`, never React, HTML, or CSS.

This document is the implementation plan for branch `feat/adaptive-workspace`.

## Isolation rule

**Do not replace Broker Chat while this is incomplete.**

| Surface | Route | Status |
|---|---|---|
| Existing Broker Chat | `/broker-chat` | Unchanged. Keep look, behavior, and session UI as they are. |
| Adaptive Workspace preview | `/adaptive-workspace` | New page. Build the desk here until it is ready to become the default. |

The preview page may reuse the existing broker-chat **backend** (sessions, runs, SSE, broker tools). It must not change the existing `/broker-chat` frontend. Shared preference writes (`PUT /broker-chat/config`) stay owned by Broker Chat so preview toggles cannot rewrite that page’s settings.

When the preview is complete, a later change can:

1. Make `/adaptive-workspace` the Intelligence default.
2. Redirect `/broker-chat` to it, or keep Broker Chat as a legacy transcript view.

Until then, both routes stay in the sidebar.

## Product contract

```text
Conversation → Agent plan → Broker/data tools → Typed WorkspaceSpec
                                          ↓
                         Ananta component registry
                                          ↓
                    Editable, persistent personal workspace
```

- The model may choose registered component types, validated data-tool refs, limited variants, grid positions, and declared semantic actions.
- The model may not emit React, CSS, script URLs, SQL, credentials, or undeclared handlers.
- Financial widgets always show broker/account, as-of time, freshness, and whether a value is live, cached, or model-derived.
- Data-reading and UI composition are autonomous. Saving defaults, deploying alerts, changing sessions, and sharing require confirmation. Order mutations stay out until a HITL approval card exists.
- Personalization comes from layout, bindings, and explicit preferences. Behavioral inference may suggest. It must not silently rearrange the desk.

## Jobs for the first three phases

1. Portfolio review (holdings, funds, vs-index later).
2. Symbol research (quote + historical chart).
3. Broker health (session status / action-required).

Alert creation (workflow studio) waits until the same `WorkspaceSpec` exists on this page.

## Phases

### Phase 0 — Product contract (this branch start)

- [x] New preview route and nav entry, Broker Chat left alone.
- [x] `WorkspaceSpec` v1 schema in backend and frontend.
- [x] Allowlisted catalog, tools, actions, and forbidden prop keys.
- [x] Fail-closed validation tests.
- [x] Tool-name → catalog-type mapping for existing broker tools.

No database tables yet. No `compose_surface` agent tool yet.

### Phase 1 — Rich responses on the preview page

- [x] New `/adaptive-workspace` chrome: sessions | transcript | pin tray.
- [x] Map `broker_get_quotes` / `broker_get_cached_quotes` → `quote-ticker`.
- [x] Map `broker_get_portfolio` → `holdings-table` (holdings, positions, funds when present).
- [x] Map `broker_get_session_status` → `broker-health`.
- [x] Map `broker_get_historical` → `price-chart`.
- [x] Stream skeleton → data → error states.
- [x] **Pin to canvas** into a session-local tray (not persisted).
- [x] Always show mapped tool cards even when Broker Chat’s “Tools” toggle would hide raw JSON.

Success: a holdings or quote question on `/adaptive-workspace` is useful as cards. `/broker-chat` still shows the current transcript/tool-row UI.

### Phase 2 — Sidecar adaptive canvas (same route)

- [ ] Centre canvas becomes the primary pane; chat becomes a collapsible inspector.
- [ ] `compose_surface` / `patch_surface` tools that emit `WorkspaceSpec`.
- [ ] Drag, resize, remove, duplicate, refresh, undo on catalog widgets only.
- [ ] Versioned workspace snapshots, modeled on alert-workflow snapshots (`workflow_payload` → `workspace_payload`).
- [ ] Restore canvas independently of chat history.
- [ ] Component-scoped prompting: “change this chart.”

### Phase 3 — Personalization

- [ ] Named saved desks on this route.
- [ ] Explicit display preferences, inspectable and deletable.
- [ ] Templates: investor, trader, researcher, operations.
- [ ] Desk skills: morning brief, F&O desk, earnings week.
- [ ] Suggestions after repeated requests. No silent rearrangement.

### Phase 4 — Workflow studio on the same contract

- [ ] Alert draft, graph, validation, simulation, diff, deploy as catalog components on this canvas.
- [ ] Reuse existing alert snapshot fields. Do not invent a second snapshot system.

### Phase 5 — Interop, then cut over

- [ ] Optional AG-UI adapter. Do not replace current SSE first.
- [ ] Optional A2UI renderer after the internal schema is stable.
- [ ] Sandboxed micro-apps only after the curated registry works.
- [ ] Cut over: make this route the default Intelligence surface; keep `/broker-chat` as legacy or redirect.

## File map (Phase 0–1)

```text
docs/adaptive-workspace.md
backend/app/schemas/adaptive_workspace.py
backend/tests/test_adaptive_workspace_spec.py
frontend/app/(workspace)/adaptive-workspace/page.tsx
frontend/service/types/adaptive-workspace.ts
frontend/lib/adaptive-workspace/spec.ts
frontend/lib/adaptive-workspace/catalog.ts
frontend/lib/adaptive-workspace/tool-envelope.ts
frontend/lib/adaptive-workspace/chat-events.ts
frontend/hooks/use-adaptive-workspace-chat.ts
frontend/components/adaptive-workspace/*
frontend/components/workspace-shell.tsx   # nav entry only
```

Do not edit `frontend/components/broker-chat/broker-chat-workspace.tsx` for this feature.

`frontend/components/agent-elements/tools/tool-renderer.tsx` may accept custom renderers for the `broker` MCP namespace. That is backward compatible: Broker Chat does not pass `toolRenderers`.

## WorkspaceSpec v1

See `backend/app/schemas/adaptive_workspace.py` for the authoritative schema. Frontend validation must fail closed on the same rules.

Forbidden in `props`: `className`, `class`, `style`, `css`, `dangerouslySetInnerHTML`, `innerHTML`, `jsx`, `children`, `href`, `src`, `onClick` (use `actions` instead).

Grid: 12 columns. `x + w <= 12`. Unique component ids. Unknown `type` or `data.tool` is invalid.

## Safety

- Keep using existing broker tools. They never accept secrets.
- Preview page does not add order tools.
- Persist configuration separately from fetched market data (Phase 2+).
- Version every accepted workspace change (Phase 2+).

## Success signals (measure after Phase 1)

- Time from prompt to first useful component on `/adaptive-workspace`.
- Pin rate of generated cards.
- Follow-up prompts that are formatting requests (should fall).
- `/broker-chat` usage still works with no visual regressions.
