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

- [x] Centre canvas becomes the primary pane; chat becomes a collapsible, resizable inspector. Conversation history is an inspector desk switcher, not a third column.
- [x] `compose_surface` / `patch_surface` tools that emit `WorkspaceSpec`.
- [x] Catalog, current-desk, and dry-run validate tools so the agent can self-correct instead of looping.
- [x] Drag, resize, remove, duplicate, refresh, undo on catalog widgets only.
- [x] Versioned workspace snapshots, modeled on alert-workflow snapshots (`workflow_payload` → `workspace_payload`).
- [x] Restore canvas independently of chat history.
- [x] Component-scoped prompting: “change this chart.”

### Phase 3 — Personalization

- [x] Named saved desks on this route.
- [x] Explicit display preferences, inspectable and deletable.
- [x] Templates: investor, trader, researcher, operations.
- [x] Desk skills: morning brief, F&O desk, earnings week.
- [x] Suggestions after repeated requests. No silent rearrangement.

### Phase 4 — Workflow studio on the same contract

- [x] Alert draft, graph, validation, simulation, diff, deploy as catalog components on this canvas.
- [x] Reuse existing alert snapshot fields. Do not invent a second snapshot system.

### Phase 5 — Interop, then cut over

- [x] Optional AG-UI adapter. Do not replace current SSE first.
- [x] Optional A2UI renderer after the internal schema is stable.
- [x] Sandboxed micro-apps only after the curated registry works.
- [ ] Cut over: make this route the default Intelligence surface; keep `/broker-chat` as legacy or redirect.

AG-UI is a derived view of existing broker-chat SSE (`token`, `tool_call_*`, `run_*`) plus a `STATE_SNAPSHOT` of the current `WorkspaceSpec`. The inspector Interop tab and `agent-timeline` widget show that mapping. Chat does not switch to an AG-UI transport.

A2UI v0.9 (`createSurface` + `updateComponents`, catalog `ananta-workspace-v1`) is a round-trip of the same spec. Import fails closed through `parse_workspace_spec`. The compose path remains `compose_surface` / `WorkspaceSpec`.

Sandboxed micro-apps are a catalog type (`micro-app`) bound to `workspace_get_micro_app`. Only `payoff-diagram` and `notes-scratch` are registered. The iframe is `sandbox="allow-scripts"` without `allow-same-origin`, with a server-owned `srcDoc` template and `postMessage` limited to `select` / `refresh`. Intelligence default and `/broker-chat` are unchanged so this preview can keep evolving.

## File map (Phase 0–2)

```text
docs/adaptive-workspace.md
backend/app/schemas/adaptive_workspace.py
backend/app/schemas/adaptive_workspace_api.py
backend/app/services/adaptive_workspace.py
backend/app/services/adaptive_workspace_alert_studio.py
backend/app/services/adaptive_workspace_interop.py
backend/app/agent_tools/workspace_tools.py
backend/app/agent_tools/alert_studio_tools.py
backend/app/api/v1/adaptive_workspace.py
backend/tests/test_adaptive_workspace_spec.py
backend/tests/test_adaptive_workspace_phase2.py
backend/tests/test_adaptive_workspace_phase3.py
backend/tests/test_adaptive_workspace_phase4.py
backend/tests/test_adaptive_workspace_phase5.py
frontend/app/(workspace)/adaptive-workspace/page.tsx
frontend/service/types/adaptive-workspace.ts
frontend/service/actions/adaptive-workspace.ts
frontend/lib/adaptive-workspace/spec.ts
frontend/lib/adaptive-workspace/catalog.ts
frontend/lib/adaptive-workspace/layout.ts
frontend/lib/adaptive-workspace/tool-envelope.ts
frontend/lib/adaptive-workspace/chat-events.ts
frontend/lib/adaptive-workspace/ag-ui.ts
frontend/lib/adaptive-workspace/a2ui.ts
frontend/lib/adaptive-workspace/micro-apps.ts
frontend/hooks/use-adaptive-workspace-chat.ts
frontend/hooks/use-alert-studio.ts
frontend/components/adaptive-workspace/*
frontend/components/workspace-shell.tsx   # nav entry only
```

Phase 3 adds named saved desks (`adaptive_workspace_saved_desks`), inspectable display preferences (`adaptive_workspace_preferences`), canned templates/skills, and suggestion chips. Applying a template or skill always requires an explicit confirm in the UI. The agent may list templates/skills and compose when the user asks; it must not rearrange because a request was repeated.

Phase 4 activates the reserved studio types (`alert-rule-draft` as a draft summary when `data.tool` is `alert_get_studio`, plus `workflow-graph`, `workflow-simulation`, `approval-card`). Studio payloads come from `GET/POST /adaptive-workspace/alert-studio*` and reuse `alert_workflow_chat_snapshots` (`workflow_payload_json`, `validation_json`, `compile_json`, `explanation_json`, `samples_json`, `diff_json`). `adaptive_workspace_snapshots` stays layout-only. Deploy requires `confirm=true`. Full rule authoring stays on `/alerts-workspace`.

Phase 5 adds AG-UI/A2UI adapters and a curated `micro-app` registry on this same contract. SSE and `WorkspaceSpec` stay authoritative. Cut-over of the Intelligence default is deferred.

`compose_surface`, `patch_surface`, and helper tools (`workspace_get_authoring_docs`, `workspace_get_current`, `workspace_validate_spec`) are attached only when a broker-chat run’s metadata includes `adaptive_workspace: true`. Invalid compose/patch returns `ok: true` with `applied: false` and `validation.errors` so the model can self-correct without a retry loop. The preview page sends that flag. `/broker-chat` does not, so Broker Chat never sees the canvas tools.

Snapshots live in `adaptive_workspace_snapshots` (`workspace_payload_json`), keyed by the existing broker-chat session. Canvas restore uses the latest applied snapshot, not chat history.

Do not edit `frontend/components/broker-chat/broker-chat-workspace.tsx` for this feature.

`frontend/components/agent-elements/tools/tool-renderer.tsx` may accept custom renderers for the `broker` MCP namespace. That is backward compatible: Broker Chat does not pass `toolRenderers`.

## WorkspaceSpec v1

See `backend/app/schemas/adaptive_workspace.py` for the authoritative schema. Frontend validation must fail closed on the same rules.

Forbidden in `props`: `className`, `class`, `style`, `css`, `dangerouslySetInnerHTML`, `innerHTML`, `jsx`, `children`, `href`, `src`, `onClick` (use `actions` instead).

Grid: 12 columns. `x + w <= 12`. Unique component ids. Unknown `type` or `data.tool` is invalid.

## Safety

- Keep using existing broker tools. They never accept secrets.
- Preview page does not add order tools.
- Persist configuration separately from fetched market data.
- Version every accepted workspace change.

## Success signals (measure after Phase 1)

- Time from prompt to first useful component on `/adaptive-workspace`.
- Pin rate of generated cards.
- Follow-up prompts that are formatting requests (should fall).
- `/broker-chat` usage still works with no visual regressions.
