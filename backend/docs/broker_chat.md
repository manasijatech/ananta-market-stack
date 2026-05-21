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
