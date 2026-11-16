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
            assert mc.background_refresh_allowed(day.replace(hour=hour, minute=minute))
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
    credential = SimpleNamespace(user_id='u1', account_checked_at=None)
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
    assert cycles == [10, 20, 30]


def test_holdings_offhours_does_not_open_database(monkeypatch):
    from app.services import broker_data_preferences as prefs
    db = MagicMock()
    monkeypatch.setattr(prefs, 'SessionLocal', db)
    prefs.run_holdings_refresh_cycle(now=datetime(2026, 11, 11, 22, tzinfo=mc.IST))
    db.assert_not_called()
