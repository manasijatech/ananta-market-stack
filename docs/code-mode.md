# Code mode

Code mode is an optional way to run broker chat. Instead of attaching every read-only MCP and broker tool schema to the model, the backend generates a typed Python API and gives the model one tool, `code_run`. The model writes a short script. The script runs in a separate process with no network. API calls inside the script are relayed back to the backend, which still holds broker credentials and the MCP connection. Only printed output returns to the model.

The default install does not use this. `CHAT_TOOL_MODE` stays `direct`, and the sandbox service is behind a Compose profile.

## Enable it

From the repository root:

```bash
CHAT_TOOL_MODE=code_mode docker compose --profile code-mode up -d --build
```

That starts an extra service, `code-sandbox`, and sets the backend to code mode. To turn it off, set `CHAT_TOOL_MODE=direct` and recreate the backend. You can leave the sandbox stopped; a missing socket falls back to direct tools and records a `code_mode_unavailable` event.

Relevant settings (also in `.env.example`):

| Variable | Default | Role |
| --- | --- | --- |
| `CHAT_TOOL_MODE` | `direct` | `code_mode` switches chat to the single `code_run` tool. |
| `CHAT_TOOL_MODE_ALLOW_METADATA_OVERRIDE` | `false` | When `true`, a run's `metadata.chat_tool_mode` may be `direct` or `code_mode`. Clients cannot select the mode while this is false. |
| `CODE_SANDBOX_SOCKET` | `/run/ananta-code/runner.sock` | Unix socket shared by the backend and the runner. |
| `CODE_SANDBOX_TOKEN_FILE` | `/run/ananta-code/token` | Token file on that same volume. |

The dev Compose file has the same profile: `docker compose -f docker-compose.dev.yml --profile code-mode up -d --build`.

## What the model sees

Read-only tools become functions on `ananta.api`:

- broker reads: accounts, session status, capabilities, instruments, quotes, OHLC, historical, option chain, greeks, portfolio, profile, watchlist reads, stream status
- intel reads
- `web_search` and `web_fetch`
- Drishti and other MCP data tools whose names start with `get_`, `list_`, `search_`, `resolve_`, or `calc_`, plus known Drishti reads such as `read_me`

Mutations, workspace and canvas publish, alert studio, skills, session memory, and approval-style tools stay attached directly. `describe_tools` and `execute_tool` are never exposed. When code mode is active the MCP servers themselves are not passed to the agent; the backend keeps those connections and invokes the wrapped tools.

Inside the sandbox the script can call `api.list()`, `api.search(text)`, and `api.describe(name)` without a network round trip. `api.parallel([(name, args), ...])` batches up to 8 calls. Each inner call still emits `tool_call_started` and `tool_call_completed` with `parent_tool` set to `code_run`, so the chat timeline shows the reads.

## Isolation

```
model -- code_run(code) --> backend (credentials, MCP, broker sessions)
                              |
                              |  Unix socket NDJSON on a shared volume
                              v
                         code-sandbox runner (no network, no secrets)
                              |
                              |  stdout: @@ANANTA_RPC {id, calls}
                              |  stdin:  {id, results}
                              v
                         guest Python (nobody, cleared env, rlimits)
```

The sandbox container:

- uses `network_mode: none`
- does not receive backend environment variables or secret files
- has a read-only root filesystem and a tmpfs for `/tmp`
- is limited in memory, CPU, and pids
- drops capabilities except `SETUID`, `SETGID`, `CHOWN`, and `KILL`

The only channel is a Unix socket at `/run/ananta-code/runner.sock` on the `ananta_code_run` volume, plus a token file on that volume. The directory is mode `0700` and the socket mode `0600`, both owned by root. The runner checks the token with a constant-time compare. The guest is started as `nobody` when the runner is root, so it cannot traverse the socket directory. Its environment is replaced with a fixed `PATH`, `HOME`, `TMPDIR`, and Python flags. Resource limits are applied in the guest before user code runs: `RLIMIT_AS` 512 MiB, `RLIMIT_CPU` at least 10 seconds so the interpreter can start, `RLIMIT_NPROC` when the guest is nobody, `RLIMIT_FSIZE` 1 MiB, and `RLIMIT_NOFILE` 32. The requested wall-clock timeout still stops a script that only sleeps.

Socket messages are one JSON object per line:

- backend to runner: `{"type":"exec","token","exec_id","code","api_source","timeout_seconds"}` or `{"type":"ping","token"}` or `{"type":"rpc_reply","exec_id","reply"}`
- runner to backend: `{"type":"pong"}`, `{"type":"rpc","exec_id","frame"}`, `{"type":"result",...}`, or `{"type":"error",...}`

`frame` uses the same shape as the enterprise bridge: `{"id": <int>, "calls": [{"name", "args"}]}`. The guest writes `@@ANANTA_RPC ` plus that JSON on stdout and reads one JSON reply line from stdin. The runner does not execute tools. The backend dispatches each call through the tool's `on_invoke_tool`, so the same wrappers the agent would have used still run.

## Limits

Per `code_run`:

- timeout default 60 seconds, capped at 120
- at most 40 API calls, and at most 8 calls in one `parallel` batch
- RPC frames larger than 256 KiB are rejected
- each tool result is capped at 1 MB
- stdout and stderr returned to the model are capped at 8000 characters
- the calls ledger contains the name, an arguments digest, ok or error, milliseconds, and result size. Raw tool payloads stay in the guest and in the timeline events, not in the model-facing ledger

If the socket is down, chat uses direct tools and emits `code_mode_unavailable` with `fallback: direct`.

## Local runner without Docker

The runner is stdlib Python:

```bash
python code_sandbox/main.py --socket /tmp/ananta-code/runner.sock --token-file /tmp/ananta-code/token
```

`--allow-same-uid` skips the nobody drop. Use it only for tests. A production container must not set it.
