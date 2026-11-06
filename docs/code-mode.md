# Code mode

Code mode is an optional way to run broker chat. Instead of attaching every read-only MCP and broker tool schema to the model, the backend generates a typed Python API and gives the model one tool, `code_run`. The model writes a short script. The script runs in a separate process with no network. API calls inside the script are relayed back to the backend, which still holds broker credentials and the MCP connection. Only printed output returns to the model.

The default `CHAT_TOOL_MODE` is `auto`. Each turn uses code mode for data reads, and direct tools for derivatives, option-chain, and conceptual questions that need no data. The choice is recorded as a `tool_strategy_selected` event. The sandbox service is still behind a Compose profile. If that socket is missing, the turn falls back to direct tools and records `code_mode_unavailable`.

## Enable it

From the repository root:

```bash
docker compose --profile code-mode up -d --build
```

That starts an extra service, `code-sandbox`. With the default `auto` mode, data-read turns then use `code_run`. To force one strategy, set `CHAT_TOOL_MODE` to `code_mode`, `hybrid`, or `direct` and recreate the backend. You can leave the sandbox stopped; a missing socket falls back to direct tools and records a `code_mode_unavailable` event.

Relevant settings (also in `.env.example`):

| Variable | Default | Role |
| --- | --- | --- |
| `CHAT_TOOL_MODE` | `auto` | `auto` picks per turn: code mode for data reads, direct tools for derivatives and conceptual questions. `code_mode` always uses `code_run` for reads. `hybrid` does the same and also keeps document tools direct: `list_earnings`, `get_earnings_filing`, `get_concalls`, `search_concalls`, `get_announcements`, `search_announcements`, `search_news`. `direct` attaches tool schemas as usual. |
| `CHAT_TOOL_MODE_ALLOW_METADATA_OVERRIDE` | `false` | When `true`, a run's `metadata.chat_tool_mode` may be `auto`, `direct`, `code_mode`, or `hybrid`. Clients cannot select the mode while this is false. |
| `CODE_SANDBOX_SOCKET` | `/run/ananta-code/runner.sock` | Unix socket shared by the backend and the runner. |
| `CODE_SANDBOX_TOKEN_FILE` | `/run/ananta-code/token` | Token file on that same volume. |

The dev Compose file has the same profile: `docker compose -f docker-compose.dev.yml --profile code-mode up -d --build`.

## What the model sees

Read-only tools become functions on `ananta.api`. Admission is a declared-name allowlist, not a prefix guess:

- the broker, intel, web, and derivatives names in `CODE_MODE_API_TOOLS`
- declared Drishti data operations in `MCP_DATA_TOOL_NAMES` (for example `get_news`, `search_news`, `read_me`), matched by exact name
- names that start with `research_compare_`
- MCP tools whose names start with `nse_cm__` or `nse_bhavcopy__`

A name is not admitted because it starts with `get_`, `list_`, `search_`, `resolve_`, or `calc_`. Mutations, workspace and canvas publish, alert studio, skills, session memory, and approval-style tools stay attached directly. `describe_tools` and `execute_tool` are never exposed. When code mode is active the MCP servers themselves are not passed to the agent; the backend keeps those connections and invokes the wrapped tools.

There is no code-mode cache. Drishti MCP data operations are always read live from the MCP server: no result cache, no replay of an earlier result, and no merged concurrent call. `cache_tools_list` is only a tool-schema listing switch and stays off. Every call, including a repeat of the same arguments, goes through the wrapped tool, so a revocation or a source switch applies on the next call. The instructions tell the model to keep results in variables: Drishti calls always read live data, and repeated identical calls may be refused. Result shapes (`-> {...}`) are learned only for public market-data tools (quotes, history, instruments, option chains, web, Drishti data operations, and the NSE prefixes above). Portfolio, account, watchlist, profile, and book results are not learned.

`hybrid` uses the same sandbox and the same read API. The seven document tools above stay attached so the model can read filings, transcripts, announcements, and news search as prose. A failed `code_run` in hybrid mode includes a `fallback` note naming the API functions that failed, so the model can call an attached direct tool instead of rewriting the script. OSS has no `capability_load`, so reads outside that document set are not attached.

`api.earnings_rows(result)` flattens `list_earnings` / `get_earnings_filing` into one row per symbol, scope, and metric, keeps the latest filing per symbol, and adds `value_cr` / `previous_year_value_cr` in INR crore. Successful inner calls include `receipt_id` on the `calls` ledger (the persisted `tool_call_completed` event id). OSS has no finance canvas, so that id is not cited as a canvas source.

Inside the sandbox the script can call `api.list()`, `api.search(text)`, `api.describe(name)`, and `api.earnings_rows(result)` without a network round trip. `api.parallel([(name, args), ...])` batches up to 8 calls. Passing a wrapper object such as `query=` works even when the nested fields are required; omitting both the wrapper and a required field raises `TypeError` in the guest. Each inner call still emits `tool_call_started` and `tool_call_completed` with `parent_tool` set to `code_run`, so the chat timeline shows the reads. A budget stop (`stopped: true`, including `ok: true`) is an error, not data. Cancellation and timeout still record the ledger slot and a `tool_call_completed` event with `ok: false`.

## Isolation

```
model -- code_run(code) --> backend (credentials, MCP, broker sessions)
                              |
                              |  Unix socket NDJSON on a shared volume
                              v
                         code-sandbox runner (no network, no secrets)
                              |
                              |  stdout: @@ANANTA_RPC:<nonce> {id, calls}
                              |  stdin:  {id, results}
                              v
                         guest Python (per-slot uid, private work dir, rlimits)
```

The sandbox container:

- uses `network_mode: none`
- does not receive backend environment variables or secret files
- has a read-only root filesystem
- mounts a small `/tmp` and a separate `/var/ananta-guests` tmpfs (root, mode `0711`, not world-listable)
- is limited in memory, CPU, and pids
- drops capabilities except `SETUID`, `SETGID`, `CHOWN`, and `KILL`

The guest has no network. `web_search` and `web_fetch` are still outbound: the guest only sends an RPC frame, and the backend performs the HTTP call. Treat them as a network channel even though the container is `network_mode: none`.

Two execs may run at once (`SLOT_COUNT` is 2). They do not share a uid. The image creates `ananta-slot0` and `ananta-slot1` as uids/gids `61001` and `61002`, one per slot. Each guest gets a `0700` directory owned by that uid, under the root-owned parent, and `HOME` / `TMPDIR` point there. The bootstrap program (user source, API module, and the per-exec nonce) is written to a pipe the child inherits. It is not stored in a file another uid can read.

`/proc` hidepid would stop a guest from seeing another guest's process entries. Remounting `/proc` needs `CAP_SYS_ADMIN`, which this container drops, so the entrypoint only tries the remount and continues if it fails. The uid split is what blocks file-descriptor access: `/proc/<pid>/fd` is mode `0500` and `/proc/<pid>/environ` is mode `0400`, both owned by the other guest. A guest cannot open them. After every exec (success, error, timeout, cancel, or backend disconnect) the runner SIGKILLs every process with that slot's uid before it releases the slot, including `setsid` grandchildren. Stdin is aborted if the guest stops reading, so a full pipe cannot hold the slot past the deadline.

The only channel is a Unix socket at `/run/ananta-code/runner.sock` on the `ananta_code_run` volume, plus a token file on that volume. The directory is mode `0700` and the socket mode `0600`, both owned by root. The runner checks the token with a constant-time compare. A guest uid cannot traverse that directory. Its environment is replaced with a fixed `PATH`, `HOME`, `TMPDIR`, and Python flags. Resource limits are applied in the guest before user code runs: `RLIMIT_AS` 512 MiB, `RLIMIT_CPU` at least 10 seconds so the interpreter can start, `RLIMIT_NPROC` when the guest has its own uid, `RLIMIT_FSIZE` 1 MiB, and `RLIMIT_NOFILE` 32. The requested wall-clock timeout still stops a script that only sleeps. A hard deadline around the slot hold reaps the uid even if cleanup stalls, and the backend applies its own deadline (`timeout + 20s`) across the socket read and the inner tool call.

## Protocol

Socket messages are one JSON object per line. The nonce is 32 hex characters (`secrets.token_hex(16)`), chosen per exec. Printed text that does not carry that nonce is ordinary stdout, so a page or filing cannot forge a frame.

- backend to runner: `{"type":"exec","token","exec_id","code","api_source","timeout_seconds"}` or `{"type":"ping","token"}` or `{"type":"rpc_reply","exec_id","reply"}`
- runner to backend: `{"type":"pong"}`, `{"type":"rpc","exec_id","frame"}`, `{"type":"result",...}`, or `{"type":"error",...}`

`frame` is `{"id": <int>, "calls": [{"name", "args"}]}`. The guest writes `@@ANANTA_RPC:<nonce> ` plus that JSON on stdout and reads one JSON reply line from stdin. The runner does not execute tools. The backend dispatches each call through the tool's `on_invoke_tool`. If the serialized reply would exceed the transport limit, the backend sends an explicit size error instead and the guest sees `ApiError`. A reader failure on the runner fails the pending call instead of waiting out the timeout. If the backend socket closes, the runner cancels the exec, kills the slot uid, and releases the slot.

## Limits

Per `code_run`:

- timeout default 60 seconds, capped at 120. A missing, null, or non-numeric `timeout_seconds` becomes 60. The backend bridge deadline is that timeout plus 20 seconds and covers tool dispatch
- at most 40 API calls, and at most 8 calls in one `parallel` batch
- RPC frames larger than 256 KiB are rejected
- each tool result is capped at 1 MiB of JSON
- the Unix socket accepts one line of `8 * 1 MiB + 64 KiB` so a full batch, including JSON escaping already counted in the per-result cap, fits. A larger batch is rejected with `API batch exceeds the transport size limit`
- stdout and stderr returned to the model are capped at 8000 characters
- the calls ledger contains the name, an arguments digest, ok or error, milliseconds, and result size. Raw tool payloads stay in the guest and in the timeline events, not in the model-facing ledger

If the socket is down, chat uses direct tools and emits `code_mode_unavailable` with `fallback: direct`.

## Local runner without Docker

The runner is stdlib Python:

```bash
python code_sandbox/main.py --socket /tmp/ananta-code/runner.sock --token-file /tmp/ananta-code/token
```

`--allow-same-uid` skips the per-slot uid drop. Use it only for tests. A production container must not set it. Without root the guest shares the runner uid, so the isolation above does not hold.
