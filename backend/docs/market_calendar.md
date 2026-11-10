# Market calendar

The backend models the NSE/BSE trading calendar so scheduled work, live quote
polling, alert triggers and chat answers agree on whether the market is open and
which session's data is authoritative.

- Module: `app/services/market_calendar.py`
- Read-only endpoint: `GET /api/v1/market/status`
- Store: `market_calendar_snapshots` (`v52a20261110`)
- Chat tool: `market_status`

## What it answers

```python
from app.services import market_calendar as mc

mc.is_trading_day(date(2026, 11, 10))           # False — verified NSE holiday
mc.previous_trading_day(date(2026, 11, 11))     # 2026-11-09
mc.next_trading_day(date(2026, 11, 10))         # 2026-11-11
mc.shift_expiry_to_trading_day(date(2026, 11, 10))  # 2026-11-09
mc.last_completed_session()                     # session whose close is official
mc.market_session_state().phase                 # continuous, holiday, preopen_*, ...
mc.market_status_now().label                    # "NSE closed · holiday: … · opens …"
mc.market_session_context()                     # prompt block for chat
mc.poll_backoff_seconds()                       # 0 while trading, else 5..300
mc.session_closed_reason("NSE", "cash", now)    # ("skipped: market holiday (…)", details)
```

`market_session_state`, `market_status_now` and the helpers accept
`exchange="BSE"`, `segment="equity_derivatives" | "currency" | "commodity"`.
`NFO`/`BFO` map to NSE/BSE equity derivatives automatically.

## Segments

| Segment | NSE master key | Notes |
|---|---|---|
| `cash` | `CM` | Modelled fully, including CAS |
| `equity_derivatives` | `FO` | Closes 15:40 from 2026-08-03 |
| `currency` | `CD` | Stored, but the session clock is not modelled |
| `commodity` | `COM` | Stored, but the session clock is not modelled |

`list_kind` is `trading` or `clearing`. Only `trading` closes a session; clearing
lists close settlement windows and are stored without the session rules.

## Phase coverage and honesty about it

Phases are effective-dated, mirroring the exchange rule changes:

| Change | Effective |
|---|---|
| Closing Auction Session (CAS) for cash | 2026-08-03 |
| Revised pre-open windows | 2026-09-07 |

`calendar_coverage` on every state says how much is actually known:

| Value | Meaning |
|---|---|
| `verified_seed_<year>` | Complete in-tree list (NSE cash and F&O, 2025 and 2026) |
| `verified_refresh_<year>` | An accepted store row for that scope and year |
| `operator_verified_override` | Override file with a complete, in-window provenance block |
| `operator_override_unverified` | Override file present but not trusted |
| `caller_supplied` | `holidays=` passed into `market_session_state` |
| `weekday_only_unverified_holidays` | No verified list. Weekdays are sessions, holidays are not invented |

BSE and every year after 2026 report `weekday_only_unverified_holidays` until a
refresh or an override covers them.

## Special sessions

A declared special session trades on a day the regular list calls closed:

- the weekend Budget session (1 Feb),
- the muhurat evening session (21 Oct 2025, 13:45–14:45).

`session_windows(day)` returns the windows, and `is_trading_day` is `True` for
those days. `2026-11-08` reports `special_session_times_unverified` because its
window was never confirmed against a circular.

## Operator override

```json
{
  "NSE:cash": {
    "holidays": ["2026-11-11"],
    "holiday_names": {"2026-11-11": "Festival closure"},
    "special_sessions": {"2026-12-05": [{"phase": "continuous", "start": "09:15", "end": "15:30"}]},
    "provenance": {
      "source_url": "https://www.nseindia.com/static/products-services/holidays",
      "exchange": "NSE",
      "segment": "cash",
      "complete_holiday_list": true,
      "valid_from": "2026-01-01",
      "valid_until": "2026-12-31",
      "reviewed_at": "2026-01-05T10:00:00+05:30"
    }
  }
}
```

Point `ANANTA_MARKET_CALENDAR_FILE` at the file. The override always wins over a
refresh, and is only trusted when all of these hold:

- the source is an `https` URL on the exchange's own domain,
- `exchange` and `segment` match the scope key,
- `complete_holiday_list` is `true` (a partial list would hide real holidays),
- the current date falls inside `valid_from`..`valid_until`,
- `reviewed_at` is timezone-aware and not in the future.

An untrusted override is still applied (the operator asked for it) but reports
`operator_override_unverified` and carries no sources. An **empty** `holidays`
list falls through to the seeds: a truncated file must not erase every holiday.

## Refresh job

`run_calendar_refresh(client=None, db=None, now=None)` fetches, validates and
stores the official holiday masters:

1. `GET https://www.nseindia.com/` for cookies,
2. `GET /api/holiday-master?type=trading` and `?type=clearing`,
3. BSE's holiday JSON (stored only when the payload parses).

`validate_holiday_batch` rejects a batch for: wrong exchange, unknown segment,
unknown list kind, a date outside the year, a duplicate, an empty list, more than
40 dates, a seeded year that **drops a seed date** (`missing_seed:YYYY-MM-DD`),
or an unseeded year with fewer than 5 dates.

Rejected rows are stored with `accepted=false` and a `rejection_reason`, so the
previous accepted list keeps serving. A newer rejected row never hides an older
accepted one. A fetch failure leaves the seeds in place and never raises into the
scheduler.

The effective list is the latest **accepted trading** row for
`(exchange, segment, year)`. Reads are cached for 60 seconds;
`clear_calendar_cache()` drops the cache after a write.

It runs from the existing interval maintenance cycle
(`system_maintenance.run_system_maintenance`), at most once per IST day, and the
result lands in the maintenance log under `details["market_calendar"]`.

## Where the calendar gates behaviour

| Area | Behaviour |
|---|---|
| Alert active periods | Holidays and weekends inactive; `calendar_phase="continuous"` also blocks pre-open and the closing auction |
| Live quote polling | Paused while closed; `poll_backoff_seconds()` instead of a 0.5 s loop |
| Closed-day run history | One `skipped: market holiday (<name>)` entry per market-bound workflow per closed day |
| Backfill | Returns 0 without touching Redis or a broker when closed |
| Heatmap / market chart | No broker round trip while closed; responses carry `prices_are_live` and the session date |
| Alpha event prices | No REST snapshot after hours; events keep their own published data |
| Instrument sync | Not scheduled on non-trading days (an explicit Verify still works) |
| Holdings refresh | Skipped on non-trading days |
| Watchlist preset refresh | Skipped on non-trading days |
| Broker session refresh | **Still runs** — tokens expire on wall-clock time, and a lapsed session would greet users with errors on the next trading morning |
| Alpha news websocket | **Still runs** — news is published overnight and on holidays and cannot be recovered |
| Alert feed triggers | **Not** calendar-gated — a holiday announcement is real information |

## Chat

`market_session_context()` is injected into chat as a **per-run volatile block**,
never into the static system prompt, so prefix caching is unaffected. It carries
IST now, the cash status label and phase, whether today is a trading day and the
holiday name, the F&O label and phase, the last completed cash session, the next
cash open, and whether live quotes are expected.

The instructions tell the model to say the market is closed and answer from the
last completed session, labelled with that session's date — never to refuse. A
read-only `market_status` tool is on every chat run for the exact phase, holiday
name and next open.

## Frontend

`components/market-status-indicator.tsx` renders one line in the workspace header
("NSE closed · holiday: Diwali-Balipratipada · opens 11 Nov, 09:15"), one cached
request per minute via `useMarketStatus`. `lib/market-status.ts` holds the copy
and formatting and is unit tested independently of React.
