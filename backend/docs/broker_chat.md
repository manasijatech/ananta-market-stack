# Broker Chat Backend

The broker chat backend provides a durable, asynchronous chat surface for the broker-data tools in `app.agent_tools`.

## Runtime Shape

- API router: `app/api/v1/broker_chat.py`
- Durable state: `broker_chat_sessions`, `broker_chat_runs`, `broker_chat_events`, `user_broker_chat_preferences`, `user_mcp_server_configs`
- Runner: `app/services/broker_chat_runner.py`
- Queue: RQ queue named by `BROKER_CHAT_QUEUE_NAME` (default `broker-chat`)
- Worker entrypoint: `PYTHONPATH=. ./venv/bin/python -m app.workers.broker_chat`
- Single-process fallback: `ENABLE_IN_PROCESS_BROKER_CHAT_WORKER=true` starts a small in-process RQ worker with the API process.
- Stream fanout: Redis stream `broker-chat:run:{run_id}:events`

The API process submits RQ jobs and returns immediately. The RQ worker runs the OpenAI Agents SDK agent, writes every streamed event to SQLite, and publishes lightweight markers to Redis so connected SSE clients can resume and tail the run.

## Worker Model

RQ workers are process based. One normal worker process handles one broker chat run at a time. Concurrency comes from running more worker processes against the same queue, not from one worker processing several jobs in parallel.

Current deployment options:

- Local/single-process: keep `ENABLE_IN_PROCESS_BROKER_CHAT_WORKER=true` and start only the FastAPI server. The backend starts a lightweight in-process `SimpleWorker` loop and processes one queued broker-chat job at a time.
- Production/dedicated workers: set `ENABLE_IN_PROCESS_BROKER_CHAT_WORKER=false` on API servers and run one or more dedicated RQ workers with `PYTHONPATH=. ./venv/bin/python -m app.workers.broker_chat`.
- Mixed mode is valid for development but should be avoided in production unless intentionally adding capacity, because every API process with the in-process worker enabled can consume jobs.

Scaling guidance:

- Worker count is the number of running worker processes subscribed to `BROKER_CHAT_QUEUE_NAME`.
- Autoscaling is controlled outside RQ by the process manager or platform. Scale up when queue depth or oldest queued age rises; scale down when queue depth remains zero.
- The queue health endpoint reports `queued_count`, `oldest_queued_seconds`, active RQ workers, and whether the in-process worker is enabled.
- A practical autoscaling policy is: desired workers = clamp(ceil(`queued_count` / target_jobs_per_worker), min_workers, max_workers), with an override to scale up immediately when `oldest_queued_seconds` crosses the acceptable chat startup latency.
- Broker chat jobs use live LLM and broker/MCP network calls, so keep worker counts within provider rate limits and broker session constraints.

## Configuration

Environment variables:

- `BROKER_CHAT_QUEUE_NAME`: RQ queue name.
- `BROKER_CHAT_JOB_TIMEOUT_SECONDS`: max runtime for one chat job.
- `BROKER_CHAT_RESULT_TTL_SECONDS`: RQ result/failure retention.
- `BROKER_CHAT_STREAM_MAXLEN`: Redis stream approximate max length per run.
- `BROKER_CHAT_HISTORY_TURN_LIMIT`: prior completed turns included in the next agent call.
- `ENABLE_IN_PROCESS_BROKER_CHAT_WORKER`: defaults to `true` so local/single-process installs do not leave runs permanently queued when no separate RQ worker is running. Set it to `false` in deployments that run dedicated RQ workers.
- `BROKER_CHAT_WORKER_POLL_SECONDS`: polling interval for the in-process worker.

User-level display defaults are managed through:

- `GET /api/v1/broker-chat/config`
- `PUT /api/v1/broker-chat/config`

Queue health is available at:

- `GET /api/v1/broker-chat/queue/health`

Hosted MCP configuration is managed through System Config:

- `GET /api/v1/system-config/mcp`
- `PUT /api/v1/system-config/mcp`
- `DELETE /api/v1/system-config/mcp/key`

MCP requires both the System Config MCP connection to be enabled and the broker-chat `use_mcp` run/config flag to be enabled. The MCP API key is stored encrypted and attached by the backend; users should not paste MCP secrets into chat messages.

## MCP Integration

Broker chat uses the OpenAI Agents SDK local MCP server integration. For hosted HTTP MCP services, prefer Streamable HTTP. SSE is supported only for legacy MCP servers.

Implementation notes:

- MCP connection setup lives in `app/services/broker_chat_mcp.py`.
- The runner passes connected servers through `Agent(..., mcp_servers=...)`.
- Agent-level MCP config enables strict-schema conversion and server-prefixed MCP tool names to reduce tool-name collisions with local broker tools.
- MCP connection failures are persisted as `mcp_connection_failed` events and do not fail the run; the agent continues with local broker tools.
- The current database shape supports one hosted MCP server per user. The helper uses `MCPServerManager`, so extending to multiple configured MCP servers later is a service-layer change rather than a runner rewrite.

Visibility modes:

- `minimal`: response tokens, tool names, arguments, and compact output metadata.
- `tool_calls`: full event payloads, but full tool outputs remain hidden unless `include_tool_outputs=true`.
- `full`: full stored payloads, with tool output and reasoning exposure controlled by `include_tool_outputs` and `include_reasoning`.

## API Flow

1. Configure an LLM provider/API key and at least one model through the existing system-config APIs.
2. Start an RQ worker, or keep the default in-process worker enabled for local/single-process installs:

```bash
PYTHONPATH=. ./venv/bin/python -m app.workers.broker_chat
```

3. Submit a run:

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

4. Stream the run:

```http
GET /api/v1/broker-chat/runs/{run_id}/stream
```

SSE `id` values are durable event sequence numbers. A frontend can reconnect with `Last-Event-ID` or `after_sequence` to resume from the last displayed event.

5. Fetch history:

```http
GET /api/v1/broker-chat/runs/{run_id}/events?visibility=tool_calls
GET /api/v1/broker-chat/sessions/{session_id}/runs
```

## Security Notes

The chat runner uses the same encrypted broker account and LLM provider helpers as the rest of the backend. Broker tools do not accept raw broker secrets. If a session is inactive, tool calls return action-required guidance or use stored automation only through the existing session maintenance helpers.

Order mutation tools are not part of the chat agent. Current chat capabilities are broker/account inspection, read-only market data, read-only portfolio data, instrument cache maintenance, session maintenance, and margin estimation.
