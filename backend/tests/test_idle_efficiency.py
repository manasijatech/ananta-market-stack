"""Idle regressions using the calendar's verified exchange history."""
import asyncio
import importlib
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest

from app.services.idle_backoff import IdleBackoff
from app.services import market_calendar as mc


def test_idle_backoff_bounds_and_resets():
    b = IdleBackoff(1, 5)
    assert [b.next_delay(busy=False) for _ in range(5)] == [2, 4, 5, 5, 5]
    assert b.next_delay(busy=True) == 1
    assert IdleBackoff(60, 30).next_delay(busy=False) == 60
    assert IdleBackoff(0).next_delay(busy=True) == 0.1


@pytest.mark.parametrize('day,hour,expected', [
    ('2026-11-10', 11, False), ('2026-11-14', 11, False),
    ('2026-11-11', 3, False), ('2026-11-11', 9, True),
    ('2026-11-11', 16, True), ('2026-11-11', 20, False),
    ('2025-10-21', 14, True),
])
def test_background_refresh_window(day, hour, expected):
    now = datetime.fromisoformat(day).replace(hour=hour, tzinfo=mc.IST)
    assert mc.background_refresh_allowed(now) is expected


def test_all_seeded_dates_keep_session_refresh_and_block_closed_days():
    day = datetime(2025, 1, 1, tzinfo=mc.IST)
    while day.year < 2027:
        windows = mc.session_windows(day.date())
        if not windows:
            assert not mc.background_refresh_allowed(day.replace(hour=11))
        for window in windows:
            hour, minute = map(int, window['start'].split(':'))
            from scripts.audit_idle_schedule import first_poll_at_session
            assert first_poll_at_session(day, window) <= day.replace(hour=hour, minute=minute)
        day += timedelta(days=1)


def test_unchanged_alpha_status_does_not_commit(monkeypatch):
    from app.services import alpha_websocket as alpha
    db = MagicMock()
    db.get.return_value.last_status = 'inactive'
    monkeypatch.setattr(alpha, 'SessionLocal', lambda: db)
    alpha._mark_config('user', last_status='inactive')
    db.commit.assert_not_called()
    db.close.assert_called_once()
    alpha._mark_config('user', last_status='connected')
    db.commit.assert_called_once()


@pytest.mark.parametrize('module_name,queue_name,reconcile_name', [
    ('app.services.broker_chat_worker_service', 'broker_chat_queue', 'reconcile_broker_chat_jobs_on_startup'),
    ('app.services.alert_workflow_chat.worker_service', 'alert_workflow_chat_queue', 'reconcile_alert_workflow_chat_jobs_on_startup'),
])
def test_empty_chat_queue_reuses_connection_and_never_runs_job(monkeypatch, module_name, queue_name, reconcile_name):
    module = importlib.import_module(module_name)
    queue = MagicMock()
    queue.count = 0
    factory = MagicMock(return_value=queue)
    monkeypatch.setattr(module, queue_name, factory)
    monkeypatch.setattr(module, reconcile_name, lambda: None)
    worker = MagicMock()
    name = 'BrokerChatSimpleWorker' if 'broker_chat_worker_service' in module_name else 'AlertWorkflowChatSimpleWorker'
    monkeypatch.setattr(module, name, worker)
    stop = asyncio.Event()
    waits = []
    async def wait_for(awaitable, timeout):
        awaitable.close()
        waits.append(timeout)
        if len(waits) == 4:
            stop.set()
            return True
        raise asyncio.TimeoutError
    monkeypatch.setattr(module.asyncio, 'wait_for', wait_for)
    target = module.run_broker_chat_worker if 'broker_chat_worker_service' in module_name else module.run_alert_workflow_chat_worker
    asyncio.run(target(stop))
    assert waits == [2, 4, 5, 5]
    factory.assert_called_once()
    worker.assert_not_called()


def test_alpha_failed_refresh_has_cooldown_without_losing_supervisor(monkeypatch):
    from types import SimpleNamespace
    from app.services import alpha_websocket as alpha
    db = MagicMock()
    credential = SimpleNamespace(user_id='u1', account_checked_at=None, api_key_cipher='cipher', is_enabled=True)
    db.scalars.return_value.all.side_effect = [[credential], [], [credential], [], [credential], []]
    monkeypatch.setattr(alpha, 'SessionLocal', lambda: db)
    monkeypatch.setattr(alpha, 'effective_subscription_for_user', lambda *_: None)
    monkeypatch.setattr(alpha, '_mark_config', lambda *a, **kw: None)
    clock = [0]
    monkeypatch.setattr(alpha, 'time', SimpleNamespace(monotonic=lambda: clock[0]))
    attempts = []
    async def refresh(user_id):
        attempts.append(user_id)
        raise RuntimeError('offline')
    monkeypatch.setattr(alpha, 'refresh_account_for_user', refresh)
    cycles = []
    async def wait(stop, delay):
        cycles.append(delay)
        clock[0] = 5 if len(cycles) == 1 else 905
        return len(cycles) == 3
    monkeypatch.setattr(alpha, '_wait_for_stop', wait)
    asyncio.run(alpha.run_alpha_websocket_worker(asyncio.Event()))
    assert attempts == ['u1', 'u1']
    assert cycles == [5, 5, 5]


@pytest.mark.parametrize('snapshot,expected', [
    (None, True),
    ({'status': 'completed', 'fetched_at': datetime(2026, 11, 11), 'error': None}, False),
    ({'status': 'failed', 'fetched_at': datetime(2026, 11, 11), 'error': 'offline'}, True),
])
def test_holdings_offhours_bootstrap_and_recovery(monkeypatch, snapshot, expected):
    from types import SimpleNamespace
    from app.services import broker_data_preferences as prefs
    db = MagicMock()
    db.scalars.return_value.all.return_value = [SimpleNamespace(id='account')]
    db.get.return_value = SimpleNamespace(**snapshot) if snapshot else None
    monkeypatch.setattr(prefs, 'SessionLocal', lambda: db)
    refresh = MagicMock()
    monkeypatch.setattr(prefs, 'refresh_holdings_snapshot', refresh)
    prefs.run_holdings_refresh_cycle(now=datetime(2026, 11, 14, 22, tzinfo=mc.IST))
    assert refresh.called is expected


def test_calendar_replay_detects_delayed_special_session():
    from scripts.audit_idle_schedule import first_poll_at_session
    day = datetime(2025, 10, 21, tzinfo=mc.IST)
    window = mc.session_windows(day.date())[0]
    hour, minute = map(int, window['start'].split(':'))
    assert first_poll_at_session(day, window, closed_delay=lambda _: 3600) > day.replace(hour=hour, minute=minute)


@pytest.mark.parametrize('count,status,expected', [(0, 'pending', True), (50, 'unavailable', True), (50, 'ready', False)])
def test_presets_offhours_bootstrap_and_recovery(monkeypatch, count, status, expected):
    from types import SimpleNamespace
    from app.services import watchlist_presets as presets
    row = SimpleNamespace(constituent_count=count, sync_status=status, last_constituents_sync_at=None)
    db = MagicMock()
    db.scalars.return_value.all.return_value = [row]
    monkeypatch.setattr(presets, 'ensure_preset_catalog', lambda _: None)
    refresh = MagicMock()
    monkeypatch.setattr(presets, 'refresh_preset_constituents', refresh)
    presets.refresh_due_presets(db, now=datetime(2026, 11, 14, 22, tzinfo=mc.IST))
    assert refresh.called is expected


@pytest.mark.parametrize('change', ['key', 'config', 'removed'])
def test_alpha_refresh_recovers_on_change_and_prunes_removed_users(monkeypatch, change):
    from types import SimpleNamespace
    from app.services import alpha_websocket as alpha
    credential = SimpleNamespace(user_id='u1', account_checked_at=None, api_key_cipher='old', is_enabled=True)
    config = SimpleNamespace(user_id='u1', products_json='[]')
    db = MagicMock()
    cycle = [0]
    db.scalars.return_value.all.side_effect = lambda: (
        ([credential] if cycle[0] != 1 or change != 'removed' else [])
        if db.scalars.call_count % 2 else [config]
    )
    monkeypatch.setattr(alpha, 'SessionLocal', lambda: db)
    monkeypatch.setattr(alpha, 'effective_subscription_for_user', lambda *_: None)
    monkeypatch.setattr(alpha, '_mark_config', lambda *a, **kw: None)
    monkeypatch.setattr(alpha, 'time', SimpleNamespace(monotonic=lambda: cycle[0] * 5))
    attempts = []
    async def refresh(user_id):
        attempts.append(cycle[0])
        raise RuntimeError('offline')
    monkeypatch.setattr(alpha, 'refresh_account_for_user', refresh)
    async def wait(stop, delay):
        cycle[0] += 1
        if cycle[0] == 1:
            if change == 'key': credential.api_key_cipher = 'fixed'
            if change == 'config': config.products_json = '["news"]'
        return cycle[0] == 3
    monkeypatch.setattr(alpha, '_wait_for_stop', wait)
    asyncio.run(alpha.run_alpha_websocket_worker(asyncio.Event()))
    assert attempts == ([0, 2] if change == 'removed' else [0, 1])


@pytest.mark.parametrize('module_name,queue_name,reconcile_name', [
    ('app.services.broker_chat_worker_service', 'broker_chat_queue', 'reconcile_broker_chat_jobs_on_startup'),
    ('app.services.alert_workflow_chat.worker_service', 'alert_workflow_chat_queue', 'reconcile_alert_workflow_chat_jobs_on_startup'),
])
def test_chat_job_arriving_mid_backoff_runs_within_cap(monkeypatch, module_name, queue_name, reconcile_name):
    module = importlib.import_module(module_name)
    queue = MagicMock(count=0)
    monkeypatch.setattr(module, queue_name, lambda: queue)
    monkeypatch.setattr(module, reconcile_name, lambda: None)
    if hasattr(module, 'broker_chat_external_worker_available'):
        monkeypatch.setattr(module, 'broker_chat_external_worker_available', lambda: False)
    clock = [0.0]
    arrived = []
    picked = []
    stop = asyncio.Event()
    worker = MagicMock()
    def work(**kwargs):
        picked.append(clock[0])
        stop.set()
    worker.return_value.work.side_effect = work
    name = 'BrokerChatSimpleWorker' if 'broker_chat_worker_service' in module_name else 'AlertWorkflowChatSimpleWorker'
    monkeypatch.setattr(module, name, worker)
    async def wait_for(awaitable, timeout):
        awaitable.close()
        if clock[0] >= 6 and not arrived:
            arrived.append(clock[0] + .1)
            queue.count = 1
        clock[0] += timeout
        if stop.is_set(): return True
        raise asyncio.TimeoutError
    monkeypatch.setattr(module.asyncio, 'wait_for', wait_for)
    target = module.run_broker_chat_worker if 'broker_chat_worker_service' in module_name else module.run_alert_workflow_chat_worker
    asyncio.run(target(stop))
    assert len(picked) == 1
    assert 0 <= picked[0] - arrived[0] <= 5


def test_live_subscription_arriving_mid_backoff_is_quoted_within_two_seconds(monkeypatch):
    from types import SimpleNamespace
    from app.services import alert_runtime as runtime
    db = MagicMock()
    subscription = SimpleNamespace(user_id='u', account_id='a', broker_code='test', symbol='TEST', exchange='NSE')
    clock = [0.0]
    rows = []
    db.scalars.return_value.all.side_effect = lambda: list(rows)
    db.get.return_value = SimpleNamespace(broker_code='test')
    monkeypatch.setattr(runtime, 'SessionLocal', lambda: db)
    monkeypatch.setattr(runtime, '_redis', lambda: MagicMock())
    monkeypatch.setattr(runtime, '_market_polling_open', lambda: True)
    monkeypatch.setattr(runtime, 'cleanup_expired_ui_subscriptions', lambda *a, **kw: None)
    monkeypatch.setattr(runtime, '_should_skip_account_until_retry', lambda _: False)
    monkeypatch.setattr(runtime, 'get_live_price_adapter', lambda _: None)
    monkeypatch.setattr(runtime, '_order_duplicate_group', lambda rows: rows)
    monkeypatch.setattr(runtime, '_subscription_priority', lambda _: 0)
    monkeypatch.setattr(runtime, 'select_live_capacity_groups', lambda groups, **kw: (groups, []))
    monkeypatch.setattr(runtime, '_instrument_for_group', lambda _: {})
    monkeypatch.setattr(runtime, '_rest_poll_allowed', lambda _: True)
    monkeypatch.setattr(runtime, '_schedule_rest_poll', lambda _: None)
    monkeypatch.setattr(runtime, '_record_market_data_success', lambda *a: None)
    monkeypatch.setattr(runtime, '_apply_quote_results', lambda *a, **kw: True)
    picked = []
    stop = asyncio.Event()
    def fetch(*args):
        picked.append(clock[0])
        stop.set()
        return []
    monkeypatch.setattr(runtime.broker_data, 'fetch_quotes', fetch)
    arrived = []
    async def wait(stop, delay):
        if clock[0] >= 7 and not arrived:
            arrived.append(clock[0] + .1)
            rows.append(subscription)
        clock[0] += delay
        assert clock[0] < 20, 'worker did not poll new subscription'
        return stop.is_set()
    monkeypatch.setattr(runtime, '_wait_for_stop', wait)
    asyncio.run(runtime.run_live_market_data_worker(stop))
    assert len(picked) == 1
    assert 0 <= picked[0] - arrived[0] <= 2


def test_alpha_feed_idle_delay_is_capped_at_five_seconds(monkeypatch):
    from app.services import alert_runtime as runtime
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    monkeypatch.setattr(runtime, 'SessionLocal', lambda: db)
    delays = []
    async def wait(stop, delay):
        delays.append(delay)
        if len(delays) == 5:
            stop.set()
        return stop.is_set()
    monkeypatch.setattr(runtime, '_wait_for_stop', wait)
    asyncio.run(runtime.run_alpha_feed_alert_worker(asyncio.Event()))
    assert delays == [4, 5, 5, 5, 5]
