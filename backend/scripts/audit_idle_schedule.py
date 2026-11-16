"""Offline replay of seeded NSE dates; no brokers, models or service startup."""
import json
from datetime import datetime, timedelta
from app.services import market_calendar as mc
from app.services.idle_backoff import IdleBackoff


def wakeups(base, cap):
    backoff = IdleBackoff(base, cap)
    elapsed = count = 0
    while elapsed < 3600:
        count += 1
        elapsed += backoff.next_delay(busy=False)
    return count


if __name__ == '__main__':
    day = datetime(2025, 1, 1, tzinfo=mc.IST)
    days = trading = before = after = false_positive = missed_open = 0
    while day.year < 2027:
        days += 1
        is_trading = mc.is_trading_day(day.date())
        trading += is_trading
        for slot in range(288):
            allowed = mc.background_refresh_allowed(day + timedelta(minutes=slot * 5))
            before += is_trading
            after += allowed
            false_positive += allowed and not is_trading
        for window in mc.session_windows(day.date()):
            hour, minute = map(int, window['start'].split(':'))
            missed_open += not mc.background_refresh_allowed(day.replace(hour=hour, minute=minute))
        day += timedelta(days=1)
    print(json.dumps(dict(days=days, trading_days=trading,
        holdings_five_minute_slots_before=before, holdings_five_minute_slots_after=after,
        closed_day_false_positives=false_positive, missed_session_opens=missed_open,
        chat_empty_checks_per_hour_before=3600, chat_empty_checks_per_hour_after=wakeups(1, 5),
        feed_empty_scans_per_hour_before=1800, feed_empty_scans_per_hour_after=wakeups(2, 30),
        live_empty_scans_per_hour_before=7200, live_empty_scans_per_hour_after=wakeups(.5, 30)), indent=2))
