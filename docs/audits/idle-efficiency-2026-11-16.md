# Idle/background efficiency audit — 2026-11-16

Scope: OSS `dev` at c4d7640, production/dev Compose, combined image,
API lifespan, every persistent worker, queue entrypoints, browser polling,
calendar integration, storage clients and optional embeddings.
No OSS-specific ledger ID was supplied. Ledger F4 belongs to the enterprise
workstream and is not changed here.

## Evidence and limits

This host serves production. Read-only Docker inventory showed enterprise,
Samvitti and evaluation projects; no running OSS Compose project. OSS defaults
are project `ananta-market-stack`, published ports 3000/8000; development uses
`ananta-market-stack-dev` with the same ports. Names alone do not isolate ports
or volumes. No containers were started, built, restarted or modified.
Swap was 40,862/40,959 MiB used. A new runtime would add pressure and would not
provide a controlled idle experiment. There are no OSS runtime documents/logs
to replay here. Validation instead replays every seeded exchange date offline.

Read-only enterprise snapshot during trading (not idle, not an OSS baseline):

| Container | CPU, one sample | Memory | PIDs |
|---|---:|---:|---:|
| backend-6 | 0.57% | 177.6 MiB | 14 |
| worker-6 | 0.43% | 939.7 MiB | 21 |
| live-market-data | 87.56% | 526.9 MiB | 10 |
| scheduler | 69.46% | 201 MiB | 4 |
| frontend-6 | 1.06% | 106.2 MiB | 24 |
| redis | 11.51% | 329.5 MiB | 6 |
| postgres | 63.36% | 626.3 MiB | 35 |

Matching host images report backend 652 MB and frontend 354 MB. Enterprise has
additional services and different concurrency; these observations cannot be
used to claim OSS idle memory/CPU savings.

## Findings

| Finding | Evidence | Impact | Fix or deferred |
|---|---|---|---|
| Closed quote worker wakes every minute | `alert_runtime.run_live_market_data_worker` took min(60, calendar backoff) | 60 wakes/hour even on holidays | Use calendar's up-to-300-second backoff with exact session boundaries, bounded below by active interval |
| Empty live worker scans every 0.5s | Same worker reads subscriptions each iteration | 7,200 empty scans/hour | Adaptive idle delay up to 2s during polling hours; active subscriptions reset it |
| Chat fallback polls Redis every second and creates a new client/pool each time | Both chat worker services | Two permanent loops; connection churn | Reuse queue connection; idle delay up to 5s, reset on queued work |
| Alpha feed scans empty SQL table every 2s | `run_alpha_feed_alert_worker` | 1,800 empty scans/hour | Back off to 5s; reset when events arrive; no market gate on news |
| Alpha supervisor scans every 5s when unconfigured | `run_alpha_websocket_worker` | Persistent empty SQL queries | Keep discovery bounded to 5s without live subscription tasks |
| Alpha inactive state commits every 5s/user | `_mark_config` always committed identical values | 720 redundant transactions/hour/user | Skip add/commit when every requested value is unchanged |
| Failed Alpha account refresh repeats every 5s | `account_checked_at` advances only on success | Up to 720 failed external requests/hour/credential | Monotonic 15-minute attempt cooldown; invalidate on key/config change and prune expired/removed entries |
| Holdings/preset calendar gate only tested the date | `broker_data_preferences`, `watchlist_presets` | Holdings fetched every 5m overnight on a trading date; stale preset downloads overnight | Calendar window plus one hour before/after for healthy data; missing/failed data bypass the gate; force/manual retained |
| Closed-day skip dedup lacked upper date bound and used wall clock for replay writes | `record_market_skip_for_closed_session`; existing regression failed | Later rows incorrectly suppress earlier-day replay records | Bound both day edges, persist supplied evaluation timestamp |
| Dedicated chat default is four workers | Settings + `app.workers.broker_chat` | Four resident worker interpreters for optional dedicated runner | Retain default four and forward count in Compose; configurable up to 32. API fallback remains one |
| Healthchecks spawn Python/Node/shell at 10/15/15s | Production Compose Redis/backend/frontend | 840 probe executions/hour | Retain 10/15/15s intervals and existing startup/readiness semantics |
| Docker logs unbounded by project | Neither Compose file specified logging limits | Persistent probe/retry/access logs can grow indefinitely | json-file rotation: 10 MB × 3 per service in both Compose files |
| Hidden tabs renew live demand and poll snapshots/chat metadata | Five frontend hooks | Unobserved quote traffic, demand stays alive indefinitely | Skip hidden demand/snapshot/queue/session refresh; demand/snapshots resume on visibility; disable React Query background member polling |
| Alert evaluator discovers streams every 2s and blocks XREAD for 1s | `run_alert_evaluator_worker` | SQL discovery even on quiet streams | Deferred: new streams initialize at latest offset; increasing discovery delay risks losing first ticks. Durable offsets/notification design needed |
| Pending delivery scans every 5s; reconciliation every 5m | `run_alert_delivery_worker`, `run_subscription_reconciler_worker` | Empty SQL work remains | Retained: timely delivery and subscription recovery; event-driven replacement deferred |
| Pools are created lazily, with SQLAlchemy defaults | `db/session.py`, queue and quote Redis factories | SQL pool default 5 retained + 10 overflow; Redis factory pools uncapped but no eager connections | Chat pool churn fixed. Global pool sizing deferred pending OSS peak/idle connection measurement; arbitrary caps can break threaded/SSE consumers. No OSS Postgres container by default (SQLite) |
| Heavy model loading | `session_embeddings._load_model`, settings | Optional embeddings can retain model RAM after use | Already opt-in false and lazy; no torch/transformer/model loaded by this work or tests. Broad SDK import splitting deferred |
| Images/startup | Slim Python, multistage combined image, standalone Next output; one uvicorn API | Disk size does not equal resident RAM | No build/package removal without measured benefit. Import-only measurements below; idle residency after model/chat use remains unmeasured |

## Scheduler and external-call inventory

There is no OSS beat/scheduler service. The API starts maintenance after 30s,
then checks every 300s: system cleanup every six hours, holiday master refresh
at most once per IST day, image update check at its configured interval, daily
broker session maintenance after 06:30, expiring-token checks, instrument master
sync after 08:30 plus gated startup sync, and holdings refresh. The separate
preset loop starts after 60s and runs hourly by default.

Instrument daily/startup jobs already honor `is_trading_day`; daily downloads
are deliberately date-bound rather than quote-session-bound, so a late startup
can still get today's master. Holdings/presets now use declared session windows
including special weekend/evening sessions. Unknown special-session times fail
closed for these refreshes. Calendar coverage limits remain visible.

Token renewal uses wall-clock expiry and must work on holidays. Calendar refresh,
cleanup, software update checks, pending delivery, news websocket/feed alerts
also remain available off-hours. Alpha account refresh requires an enabled stored
credential. News can trigger configured workflow analysis without a browser;
that is subscribed work, not an idle chat invocation. Chat model calls require
queued runs. No unconditional scheduled chat/embedding call was found. Disabling
news or token renewal solely because no browser is open would change product
semantics. Operators can disable the existing Alpha worker/update-check flags.

Websocket/SSE loops are connection/request scoped and use blocking reads,
heartbeats or sleeps. Active chat recovery and connected streams remain alive
in hidden tabs. Hidden UI demand expires under the existing five-minute TTL;
workflow-owned subscriptions remain active.

## Validation and before/after

`backend/scripts/audit_idle_schedule.py` replayed the complete 2025–2026 in-tree
NSE calendar: 730 dates, 495 trading dates, all 210,240 five-minute slots.
Eligible holdings refresh slots: **142,560 → 49,446** (65.3% fewer). Closed-day
false positives: **0**; missed declared session opens: **0**. These are eligibility
counts, not measured broker calls; account state and five-minute throttling can
reduce actual calls further. Every declared window is replayed with computed worker waits,
including the 2025 special session. Unknown 2026 muhurat times remain blocked.

Offline scheduling replay over one hour (includes initial ramp): chat empty
checks **3,600 → 721** per fallback; feed empty scans **1,800 → 721**;
live empty scans **7,200 → 1,801**. These counts execute the backoff helper with a
virtual clock; they are not observed production rates or CPU benchmarks.
Closed-market steady state is 12 instead of 60 checks/hour away from opening.
Unchanged Alpha state commits become zero after the initial state transition;
failed credential refresh attempts are bounded to roughly four/hour instead
of 720. Healthcheck counts are calculated from configured intervals.

Isolated import-only measurement, same existing Python environment and one
process each, no lifespan/services: origin/dev **3.105s / 150,412 KiB max RSS**;
changed code **3.009s / 151,984 KiB**. This is noise-level difference, not a
startup/RAM improvement claim. No model was loaded.

Focused backend gate: 122 tests (calendar runtime/refresh, presets, Alpha
entitlements, new idle regressions), py_compile and Alembic current, using
`scripts/check-local.py`. Frontend lint and production build passed. Compose
YAML parsing and `git diff --check` passed. Existing test environment dependencies
were reused; no full backend suite or Docker build ran. The OSS branch had no
continuation docs or local check runner; enterprise continuation/check runner
were read for comparison, and a focused temporary-state OSS runner is added.

## Risks, configuration and owner verification

- Empty chat fallback can discover work up to 5s later. Empty live quotes are
  capped at 2s during polling hours; feed and Alpha discovery at 5s. Explicitly
  configured active intervals remain lower bounds. Active work resets backoff.
- Healthy holdings/presets refresh near sessions. Missing/failed data can recover
  off-hours, subject to existing throttles. Alpha refresh failures keep their
  15-minute cooldown until expiry or a user-controlled credential/config change.
- Dedicated chat retains four workers by default. Healthchecks retain 10/15/15s.
- Explicit json-file logging with rotation remains an ops-visible change:
  10 MB × 3 files per service. Operators needing longer retention should ship logs
  externally; the owner must recreate services to apply Compose logging settings.
- No migration, deployment or enterprise edit is included. Owner deploys through
  the normal release procedure, recreating OSS services to apply Compose settings.

Before deployment, run (from repository root, Python with test dependencies):

```sh
python scripts/check-local.py tests/test_idle_efficiency.py tests/test_market_calendar_runtime.py tests/test_market_calendar.py tests/test_watchlist_presets.py tests/test_alpha_websocket_entitlements.py tests/test_market_calendar_refresh.py
PYTHONPATH=backend python backend/scripts/audit_idle_schedule.py
```

After owner deployment, collect a genuinely idle weekday-night and holiday window
plus a regular market-open transition; use read-only commands:

```sh
docker compose -p ananta-market-stack stats --no-stream
docker compose -p ananta-market-stack logs --since 30m backend
```

Verify no broker quote fetches overnight and healthy cached holdings/presets skip refresh, no repeated unchanged
Alpha writes, successful queued chat/notification delivery, live subscriptions
resuming near session start, and visible-tab demand renewal. Pool tuning, resident
RAM after chat use, image slimming and evaluator/delivery redesign remain deferred
until that measurement. F4's enterprise idle-in-transaction investigation and the
high active enterprise scheduler/live-data CPU sample belong to the other workstream.

## Review fixes

Applied all eight review findings. Restored active-use responsiveness and default
chat concurrency, bounded new-work discovery (live 2s, Alpha feed/supervisor 5s),
invalidated/pruned Alpha cooldown entries, and allowed missing/failed background
data to bootstrap or recover on closed days. Hidden-tab chat metadata refreshes
immediately on visibility; snapshots retain loading until the first visible
request and stop automatic retries after auth failure. Healthchecks retain the
previous intervals. json-file log rotation (10 MB × 3 per service) is retained.

Replaced the calendar tautology with a worker-wake replay starting 31m17s before
every declared window across all 730 seeded 2025–2026 dates. It exposed three
late special-session pre-open polls. Including declared pre-open boundaries and
honoring exact remaining time near the open reduces missed opens **3 → 0**.
A deliberately hour-late wake function makes the regression check fail.
Mid-backoff regressions execute both chat worker loops and the quote worker;
new jobs/quotes are picked up within 5s/2s. Alpha tests cover failure cooldown,
key/config edits, removed-user pruning, and the 5s discovery cap.

Validation used a new throwaway `/home/ubuntu/worktrees/oss-review-venv`:

```sh
python3 -m venv /home/ubuntu/worktrees/oss-review-venv
/home/ubuntu/worktrees/oss-review-venv/bin/pip install -r backend/requirements.txt pytest
/home/ubuntu/worktrees/oss-review-venv/bin/python scripts/check-local.py tests/test_idle_efficiency.py tests/test_market_calendar_runtime.py tests/test_market_calendar.py tests/test_watchlist_presets.py tests/test_alpha_websocket_entitlements.py tests/test_market_calendar_refresh.py
```

The runner copies backend sources into temporary storage, excludes env/data files,
uses temporary SQLite and Redis port 1, then runs py_compile, Alembic current and
pytest: **122 passed** (deprecation warnings only). No model loading or production
service access. Offline calendar audit uses an isolated scratch SQLite URL and
reports 730 dates, 495 trading dates, zero missed opens, zero closed-day healthy
refresh-window false positives, and 142,560 → 49,446 eligible healthy refresh slots.
Bootstrap/failure exceptions are verified separately.

Frontend `npm run lint` and `npm run build` passed, including TypeScript and
standalone preparation. Build used an ephemeral generated auth secret, scratch
`AUTH_DATABASE_PATH`, localhost auth URL, and `CIRCLE_NODE_TOTAL=2` (one worker)
to limit host memory. No production credentials were used. Both Compose files
parse and `git diff --check` passes. No Docker build, deployment, merge, full
backend suite, or measured production idle CPU claim is included. No OSS ledger
ID applies; enterprise F4 remains outside scope. Owner verification: run the
focused gate and offline audit above, then after owner deployment check new
workspace quotes, concurrent chats, key repair, and off-hours first-connect data.
