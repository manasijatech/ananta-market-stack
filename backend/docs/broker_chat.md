# Broker Chat Backend

The broker chat backend provides a durable, asynchronous chat surface for the broker-data tools in `app.agent_tools`.

## Runtime Shape

- API router: `app/api/v1/broker_chat.py`
- Durable state: `broker_chat_sessions`, `broker_chat_runs`, `broker_chat_events`, `user_broker_chat_preferences`, `user_mcp_server_configs`
- Runner: `app/services/broker_chat_runner.py`
- Queue: RQ queue automatically scoped from `BROKER_CHAT_QUEUE_NAME` (default `broker-chat`) plus a local database fingerprint.
- Worker entrypoint: `PYTHONPATH=. ./venv/bin/python -m app.workers.broker_chat`
- Built-in fallback: the API process starts a small fallback worker loop so simple installs do not need extra worker setup.
- Stream fanout: Redis stream `broker-chat:run:{run_id}:events`

The API process submits RQ jobs and returns immediately. The RQ worker runs the OpenAI Agents SDK agent, writes every streamed event to SQLite, and publishes lightweight markers to Redis so connected SSE clients can resume and tail the run.

## Worker Model

RQ workers are process based. One worker process handles one broker chat run at a time. **`BROKER_CHAT_WORKER_COUNT` (default 4)** starts that many processes from a single `python -m app.workers.broker_chat` entrypoint, so different users and sessions can run at once. One **session** still stays serial: a second send in the same chat is rejected until the active run finishes (canvas/spec would otherwise clobber). FIFO follow-ups inside one session are plan 04, not this change.

Current deployment options:

- Local/single-process: start only the FastAPI server. If no dedicated RQ worker is registered for the scoped queue, the backend fallback loop processes queued broker-chat jobs (one at a time).
- Higher throughput: run `PYTHONPATH=. ./venv/bin/python -m app.workers.broker_chat`. That process reconciles incomplete runs once, then spawns `BROKER_CHAT_WORKER_COUNT` RQ workers on the scoped queue. Raise the env var (1–32) instead of launching extra terminals.
- Preferred execution path: dedicated RQ workers win. When at least one dedicated worker is registered on the scoped queue, the backend fallback loop stays idle and does not consume jobs.
- Shared Redis safety: the effective queue name includes a local database fingerprint. Two local SQLite installs can share one Redis server without consuming each other's chat jobs.
- Restart repair: backend and dedicated-worker startup reconcile incomplete chat runs. Queued runs are re-enqueued on the scoped queue; running runs are requeued only when no active scoped RQ job exists.

Scaling guidance:

- Worker count is `BROKER_CHAT_WORKER_COUNT` (or more processes/replicas subscribed to the effective scoped queue name from `/api/v1/broker-chat/queue/health`).
- Autoscaling is still available outside RQ via the process manager. Scale up when queue depth or oldest queued age rises; scale down when queue depth remains zero.
- The queue health endpoint reports the base queue name, effective queue name, queue fingerprint, `queued_count`, `oldest_queued_seconds`, dedicated worker count, fallback worker count, and whether the fallback loop is available.
- A practical autoscaling policy is: desired workers = clamp(ceil(`queued_count` / target_jobs_per_worker), min_workers, max_workers), with an override to scale up immediately when `oldest_queued_seconds` crosses the acceptable chat startup latency.
- Broker chat jobs use live LLM and broker/MCP network calls, so keep worker counts within provider rate limits and broker session constraints. MCP, sandbox, and internal tools already accept concurrent calls; the previous bottleneck was a single RQ consumer.

## Configuration

Environment variables:

- `BROKER_CHAT_QUEUE_NAME`: base RQ queue name. The backend automatically appends a database fingerprint.
- `BROKER_CHAT_WORKER_COUNT`: dedicated RQ worker processes started by `app.workers.broker_chat` (default **4**, range 1–32).
- `BROKER_CHAT_MAX_TOKENS`: generation cap passed to the model. **`0` (default) omits `max_tokens`** so canvas HTML and long sandbox artifacts are not cut off at 8k. Set a positive value only if you need a hard cap.
- `BROKER_CHAT_JOB_TIMEOUT_SECONDS`: wall-clock cap for one chat RQ job. **`0` (default) means no cap**. A positive value is a sliding window re-armed on each stream event. Cancel still stops the run.
- `BROKER_CHAT_STREAM_IDLE_SECONDS`: abort if the model stream emits **no events** for this long. **`0` (default) disables** that stall watchdog.
- `BROKER_CHAT_RESULT_TTL_SECONDS`: RQ result/failure retention.
- `BROKER_CHAT_STREAM_MAXLEN`: Redis stream approximate max length per run.
- `BROKER_CHAT_HISTORY_TURN_LIMIT`: prior completed turns included in the next agent call.
- `BROKER_CHAT_WORKER_POLL_SECONDS`: polling interval for the fallback worker loop.
- `BROKER_CHAT_AGENT_MAX_RETRIES`: agent-level provider retries after the first attempt (default 3, cap 8).
- `BROKER_CHAT_PROVIDER_MAX_RETRIES`: OpenAI SDK retries. Product default is **0** so Ananta classifies 429/quota/stream errors instead of waiting on a provider `Retry-After` of hours.
- `BROKER_CHAT_RETRY_BASE_DELAY_SECONDS` / `BROKER_CHAT_RETRY_MAX_DELAY_SECONDS`: exponential backoff with jitter for agent retries.
- `BROKER_CHAT_RETRY_MAX_SERVER_DELAY_SECONDS`: fail fast if the provider asks to wait longer than this (default 60s). Quota / spend-cap errors never retry.
- `BROKER_CHAT_PROVIDER_TIMEOUT_SECONDS`: HTTP timeout on the chat model client (default 60).
- `MODEL_TOOL_RESULT_CHARS`: per-tool cap for current-turn projections (default 4000; in-turn replacement is wave 2).
- `MODEL_PRIOR_TURN_TOOL_CHARS`: per-tool cap when projecting **previous** completed runs into the next LLM call (default 1200).
- `MODEL_INPUT_CHAR_BUDGET`: max characters of prior-turn + current user + status-bar messages (default 120000). Oldest turns drop first.
- `BROKER_CHAT_EMIT_MODEL_CONTEXT_EVENT`: write a debug `model_context_built` audit event (hidden from the default UI/SSE page).

User-level display defaults are managed through:

- `GET /api/v1/broker-chat/config`
- `PUT /api/v1/broker-chat/config`

The config payload includes a nested `retry` object (`enabled`, `max_retries`, `base_delay_seconds`, `max_delay_seconds`). Users cannot set `max_retries` above 8 and cannot change SDK retries or the server delay cap. Title generation and later compaction/eval clients must use a separate `AgentRetryPolicy.background()` client so they do not share the Chat run's retry budget.

Audit vs model context (plan 02): `broker_chat_events` stays the full audit. The next LLM call gets a bounded projection from `app.agent_harness.model_context` (tool summaries, `retrieval_key` when truncated, secrets stripped). Clock, WorkspaceSpec JSON, MCP inventory, evidence gaps, and **code-counted tool usage** sit in a last `user` harness status message, not in the frozen system prompt. Grounding SOP (never invent numbers, calculator for CAGR, canvas only after compose/publish) is frozen in the system prompt so the prefix/KV cache stays byte-stable. Continuations append a new status bar instead of rewriting the system string. Current-turn SDK tool outputs stay raw until wave 2.

Evidence-based done (plan 03): each run stores `evidence_json` (`contract`, `gaps`, `status`, `blockers`). After a stream attempt the harness checks **audit** `tool_call_completed` events. Missing required evidence continues with a hidden `harness_nudge` (cap 3, separate from provider retries). Typed blockers count as done. Exhausted gaps still `status=completed` with public `evidence_incomplete`. Calculation is optional on OSS when no calculator is attached. Research steps map to `evidence_todos` in the UI.

Queue health is available at:

- `GET /api/v1/broker-chat/queue/health`

Hosted MCP configuration is managed through System Config:

- `GET /api/v1/system-config/mcp`
- `PUT /api/v1/system-config/mcp`
- `DELETE /api/v1/system-config/mcp`
- `POST /api/v1/system-config/mcp/oauth/start`
- `POST /api/v1/system-config/mcp/oauth/complete`
- `GET /api/v1/system-config/mcp/oauth/callback`
- `DELETE /api/v1/system-config/mcp/oauth`
- `POST /api/v1/system-config/mcp/inventory/refresh`
- `DELETE /api/v1/system-config/mcp/key`

MCP requires both the System Config MCP connection to be enabled and the broker-chat `use_mcp` run/config flag to be enabled. Remote MCP OAuth is the preferred authentication path for HTTP MCP servers. Direct bearer/API-key headers are still supported as a fallback for private servers or older deployments. Stored MCP OAuth tokens and fallback API keys are encrypted and attached by the backend; users should not paste MCP secrets into chat messages.

## MCP Integration

Broker chat uses the OpenAI Agents SDK local MCP server integration. For hosted HTTP MCP services, prefer Streamable HTTP. SSE is supported only for legacy MCP servers.

Implementation notes:

- MCP connection setup lives in `app/services/broker_chat_mcp.py`.
- MCP OAuth discovery, dynamic client registration, callback token exchange, fallback bearer headers, full config deletion, and tool/prompt/resource inventory refresh live in `app/services/mcp_config.py`.
- The browser-facing OAuth callback should normally terminate at the frontend (`/api/mcp/oauth/callback`), which forwards code/state to `/api/v1/system-config/mcp/oauth/complete` through the existing authenticated SSR backend bridge. The backend HTML callback remains as a compatibility fallback.
- The runner passes connected servers through `Agent(..., mcp_servers=...)`.
- Agent-level MCP config enables strict-schema conversion and server-prefixed MCP tool names to reduce tool-name collisions with local broker tools.
- System Config refreshes and caches the full MCP tools, prompts, and resources advertised by the configured server, with per-capability inventory notes when a server does not expose a capability. Broker chat also refreshes stale MCP inventory at run start, then injects the complete cached MCP context into the agent instructions when MCP is connected.
- MCP connection failures are persisted as `mcp_connection_failed` events and do not fail the run; the agent continues with local broker tools.
- The database supports multiple hosted MCP servers per user. Broker chat connects the enabled default servers unless the run metadata includes an explicit `mcp_server_ids` selection.

Visibility modes:

- `minimal`: response tokens, tool names, arguments, and compact output metadata.
- `tool_calls`: full event payloads, but full tool outputs remain hidden unless `include_tool_outputs=true`.
- `full`: full stored payloads, with tool output and reasoning exposure controlled by `include_tool_outputs` and `include_reasoning`.

## API Flow

1. Configure an LLM provider/API key and at least one model through the existing system-config APIs.
2. For more parallelism, start additional RQ workers:

```bash
PYTHONPATH=. ./venv/bin/python -m app.workers.broker_chat
```

1. Submit a run:

```http
POST /api/v1/broker-chat/runs
X-User-Id: local-dev-user
Content-Type: application/json

{
  "message": "Show my Reliance holding and latest quote",
  "provider": "openai",
  "model": "your-configured-model",
  "use_mcp": false
}
```

1. Stream the run:

```http
GET /api/v1/broker-chat/runs/{run_id}/stream
```

SSE `id` values are durable event sequence numbers. A frontend can reconnect with `Last-Event-ID` or `after_sequence` to resume from the last displayed event.

1. Fetch history:

```http
GET /api/v1/broker-chat/runs/{run_id}/events?visibility=tool_calls
GET /api/v1/broker-chat/sessions/{session_id}/runs
```

## Security Notes

The chat runner uses the same encrypted broker account and LLM provider helpers as the rest of the backend. Broker tools do not accept raw broker secrets. If a session is inactive, tool calls return action-required guidance or use stored automation only through the existing session maintenance helpers.

Order mutation tools are not part of the chat agent. Current chat capabilities are broker/account inspection, read-only market data, read-only portfolio data, instrument cache maintenance, session maintenance, and margin estimation.
