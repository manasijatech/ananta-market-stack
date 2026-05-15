from __future__ import annotations

import json
import logging
import sqlite3
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from common.datetime_compat import UTC
import redis
from sqlalchemy import delete, select

from app.config import get_settings
from db.models import (
    AlertWorkflow,
    AlertWorkflowRun,
    AlphaWebSocketEvent,
    BrokerNotification,
    LiveSymbolSubscription,
    SystemMaintenanceLog,
    User,
    UserAlertChannelDelivery,
    UserAlertNotification,
    UserAlphaWebSocketConfig,
)
from db.session import SessionLocal

logger = logging.getLogger(__name__)

REDIS_FULL_REBUILD_PATTERNS = (
    "quote:*",
    "live:quote:*",
    "live:ticks:*",
    "alert-live:session:*",
    "alert:notifications:*",
    "alpha:ws:*",
    "alert:workflow:last-tick:*",
)

_last_periodic_run_monotonic: float | None = None
_last_sqlite_vacuum_monotonic: float | None = None


@dataclass(frozen=True)
class TableCleanupPolicy:
    model: Any
    timestamp_column: Any
    retention_days: int
    soft_limit: int


def _settings():
    return get_settings()


def _utc_now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, default=str, separators=(",", ":"))


def _redis_client() -> redis.Redis | None:
    from broker.core.redis_cache import _redis_client as core_redis_client

    return core_redis_client()


def run_startup_maintenance() -> None:
    run_system_maintenance(
        trigger="startup",
        full_redis_rebuild=_settings().system_redis_rebuild_on_startup,
        force_vacuum=True,
    )


def run_scheduled_maintenance_once() -> None:
    global _last_periodic_run_monotonic
    interval = max(_settings().system_maintenance_interval_seconds, 60)
    now = time.monotonic()
    if _last_periodic_run_monotonic is not None and now - _last_periodic_run_monotonic < interval:
        return
    run_system_maintenance(trigger="interval", full_redis_rebuild=False, force_vacuum=False)
    _last_periodic_run_monotonic = now


def run_system_maintenance(
    *,
    trigger: str,
    full_redis_rebuild: bool,
    force_vacuum: bool,
) -> None:
    started_at = _utc_now()
    log_id = _create_maintenance_log(trigger=trigger, started_at=started_at)
    deleted_rows_total = 0
    deleted_redis_keys_total = 0
    rebuilt_redis_keys_total = 0
    vacuum_performed = False
    details: dict[str, Any] = {"sqlite": {}, "redis": {}}
    status = "completed"
    summary = "system maintenance completed"
    error_message: str | None = None

    try:
        _prune_old_maintenance_logs(exclude_log_id=log_id)

        sqlite_result = _cleanup_sqlite_tables(exclude_log_id=log_id)
        deleted_rows_total += sqlite_result["deleted_rows_total"]
        details["sqlite"]["prune"] = sqlite_result

        redis_result = _cleanup_redis(full_rebuild=full_redis_rebuild)
        deleted_redis_keys_total += redis_result["deleted_keys_total"]
        rebuilt_redis_keys_total += redis_result["rebuilt_keys_total"]
        details["redis"] = redis_result

        vacuum_result = _maybe_vacuum_sqlite(
            force=force_vacuum,
            deleted_rows=deleted_rows_total,
        )
        vacuum_performed = vacuum_result["performed"]
        details["sqlite"]["vacuum"] = vacuum_result

        summary = (
            "system maintenance completed: "
            f"{deleted_rows_total} sqlite rows pruned, "
            f"{deleted_redis_keys_total} redis keys removed, "
            f"{rebuilt_redis_keys_total} redis keys rebuilt"
        )
    except Exception as exc:
        status = "failed"
        error_message = str(exc)
        summary = "system maintenance failed"
        details["error_type"] = type(exc).__name__
        logger.exception("system maintenance failed")
    finally:
        _finish_maintenance_log(
            log_id=log_id,
            status=status,
            summary=summary,
            details=details,
            deleted_rows=deleted_rows_total,
            deleted_redis_keys=deleted_redis_keys_total,
            rebuilt_redis_keys=rebuilt_redis_keys_total,
            vacuum_performed=vacuum_performed,
            error=error_message,
            finished_at=_utc_now(),
        )


def _create_maintenance_log(*, trigger: str, started_at: datetime) -> str:
    log_id = str(uuid.uuid4())
    db = SessionLocal()
    try:
        row = SystemMaintenanceLog(
            id=log_id,
            task_name="system_cleanup",
            trigger=trigger,
            status="running",
            summary="system maintenance started",
            started_at=started_at,
        )
        db.add(row)
        db.commit()
    finally:
        db.close()
    return log_id


def _finish_maintenance_log(
    *,
    log_id: str,
    status: str,
    summary: str,
    details: dict[str, Any],
    deleted_rows: int,
    deleted_redis_keys: int,
    rebuilt_redis_keys: int,
    vacuum_performed: bool,
    error: str | None,
    finished_at: datetime,
) -> None:
    db = SessionLocal()
    try:
        row = db.get(SystemMaintenanceLog, log_id)
        if row is None:
            return
        row.status = status
        row.summary = summary
        row.details_json = _json_dumps(details)
        row.deleted_rows = deleted_rows
        row.deleted_redis_keys = deleted_redis_keys
        row.rebuilt_redis_keys = rebuilt_redis_keys
        row.vacuum_performed = vacuum_performed
        row.error = error
        row.finished_at = finished_at
        db.add(row)
        db.commit()
    finally:
        db.close()


def _cleanup_sqlite_tables(*, exclude_log_id: str) -> dict[str, Any]:
    settings = _settings()
    policies = (
        TableCleanupPolicy(
            model=AlphaWebSocketEvent,
            timestamp_column=AlphaWebSocketEvent.received_at,
            retention_days=settings.system_runtime_retention_days,
            soft_limit=max(settings.system_runtime_soft_row_limit * 2, 1),
        ),
        TableCleanupPolicy(
            model=AlertWorkflowRun,
            timestamp_column=AlertWorkflowRun.created_at,
            retention_days=settings.system_runtime_retention_days,
            soft_limit=max(settings.system_runtime_soft_row_limit, 1),
        ),
        TableCleanupPolicy(
            model=UserAlertNotification,
            timestamp_column=UserAlertNotification.created_at,
            retention_days=settings.system_notification_retention_days,
            soft_limit=max(settings.system_notification_soft_row_limit, 1),
        ),
        TableCleanupPolicy(
            model=UserAlertChannelDelivery,
            timestamp_column=UserAlertChannelDelivery.created_at,
            retention_days=settings.system_notification_retention_days,
            soft_limit=max(settings.system_notification_soft_row_limit * 2, 1),
        ),
        TableCleanupPolicy(
            model=BrokerNotification,
            timestamp_column=BrokerNotification.created_at,
            retention_days=settings.system_notification_retention_days,
            soft_limit=max(settings.system_notification_soft_row_limit // 2, 1),
        ),
        TableCleanupPolicy(
            model=SystemMaintenanceLog,
            timestamp_column=SystemMaintenanceLog.started_at,
            retention_days=settings.system_maintenance_log_retention_days,
            soft_limit=max(settings.system_maintenance_log_soft_row_limit, 1),
        ),
    )
    db = SessionLocal()
    try:
        table_results: dict[str, dict[str, int]] = {}
        deleted_total = 0
        for policy in policies:
            table_deleted = 0
            cutoff = _utc_now() - timedelta(days=max(policy.retention_days, 1))
            delete_stmt = delete(policy.model).where(policy.timestamp_column < cutoff)
            if policy.model is SystemMaintenanceLog:
                delete_stmt = delete_stmt.where(SystemMaintenanceLog.id != exclude_log_id)
            deleted_by_age = db.execute(delete_stmt).rowcount or 0
            table_deleted += deleted_by_age

            overflow_ids = list(
                db.scalars(
                    select(policy.model.id)
                    .order_by(policy.timestamp_column.desc(), policy.model.id.desc())
                    .offset(policy.soft_limit)
                ).all()
            )
            deleted_by_limit = 0
            if overflow_ids:
                limit_stmt = delete(policy.model).where(policy.model.id.in_(overflow_ids))
                if policy.model is SystemMaintenanceLog:
                    limit_stmt = limit_stmt.where(SystemMaintenanceLog.id != exclude_log_id)
                deleted_by_limit = db.execute(limit_stmt).rowcount or 0
                table_deleted += deleted_by_limit

            table_results[policy.model.__tablename__] = {
                "deleted_by_age": deleted_by_age,
                "deleted_by_limit": deleted_by_limit,
                "deleted_total": table_deleted,
            }
            deleted_total += table_deleted
        db.commit()
        return {
            "deleted_rows_total": deleted_total,
            "tables": table_results,
        }
    finally:
        db.close()


def _prune_old_maintenance_logs(*, exclude_log_id: str) -> None:
    db = SessionLocal()
    try:
        cutoff = _utc_now() - timedelta(days=max(_settings().system_maintenance_log_retention_days, 1))
        db.execute(
            delete(SystemMaintenanceLog).where(
                SystemMaintenanceLog.id != exclude_log_id,
                SystemMaintenanceLog.started_at < cutoff,
            )
        )
        overflow_ids = list(
            db.scalars(
                select(SystemMaintenanceLog.id)
                .where(SystemMaintenanceLog.id != exclude_log_id)
                .order_by(SystemMaintenanceLog.started_at.desc(), SystemMaintenanceLog.id.desc())
                .offset(max(_settings().system_maintenance_log_soft_row_limit, 1))
            ).all()
        )
        if overflow_ids:
            db.execute(delete(SystemMaintenanceLog).where(SystemMaintenanceLog.id.in_(overflow_ids)))
        db.commit()
    finally:
        db.close()


def _cleanup_redis(*, full_rebuild: bool) -> dict[str, Any]:
    client = _redis_client()
    if client is None:
        return {
            "mode": "skipped",
            "reason": "redis unavailable",
            "deleted_keys_total": 0,
            "rebuilt_keys_total": 0,
        }
    if full_rebuild:
        deleted_by_pattern = _delete_keys_by_patterns(client, REDIS_FULL_REBUILD_PATTERNS)
        rebuilt = _rebuild_redis_state(client)
        return {
            "mode": "full_rebuild",
            "deleted_by_pattern": deleted_by_pattern,
            "deleted_keys_total": sum(deleted_by_pattern.values()),
            "rebuilt": rebuilt,
            "rebuilt_keys_total": rebuilt["rebuilt_keys_total"],
        }
    stale_cleanup = _delete_stale_redis_keys(client)
    return {
        "mode": "stale_cleanup",
        "deleted_by_pattern": stale_cleanup["deleted_by_pattern"],
        "deleted_keys_total": stale_cleanup["deleted_keys_total"],
        "rebuilt_keys_total": 0,
    }


def _delete_keys_by_patterns(client: redis.Redis, patterns: tuple[str, ...]) -> dict[str, int]:
    results: dict[str, int] = {}
    for pattern in patterns:
        count = 0
        for key in client.scan_iter(match=pattern, count=500):
            count += int(bool(client.delete(key)))
        results[pattern] = count
    return results


def _rebuild_redis_state(client: redis.Redis) -> dict[str, Any]:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(AlertWorkflowRun.workflow_id, AlertWorkflowRun.tick_json)
            .order_by(AlertWorkflowRun.workflow_id.asc(), AlertWorkflowRun.created_at.desc())
        ).all()
    finally:
        db.close()
    rebuilt = 0
    rebuilt_workflows = 0
    seen_workflow_ids: set[str] = set()
    ttl_seconds = 24 * 60 * 60
    for workflow_id, tick_json in rows:
        if workflow_id in seen_workflow_ids or not tick_json:
            continue
        seen_workflow_ids.add(workflow_id)
        try:
            payload = json.loads(tick_json)
        except json.JSONDecodeError:
            continue
        client.setex(f"alert:workflow:last-tick:{workflow_id}", ttl_seconds, _json_dumps(payload))
        rebuilt += 1
        rebuilt_workflows += 1
    return {
        "workflow_last_tick_cache": rebuilt_workflows,
        "rebuilt_keys_total": rebuilt,
    }


def _delete_stale_redis_keys(client: redis.Redis) -> dict[str, Any]:
    db = SessionLocal()
    try:
        active_streams = {
            f"live:ticks:{user_id}:{account_id}:{broker_code}"
            for user_id, account_id, broker_code in db.execute(
                select(
                    LiveSymbolSubscription.user_id,
                    LiveSymbolSubscription.account_id,
                    LiveSymbolSubscription.broker_code,
                )
                .where(LiveSymbolSubscription.status == "active")
                .distinct()
            ).all()
            if user_id and account_id and broker_code
        }
        workflow_ids = set(db.scalars(select(AlertWorkflow.id)).all())
        user_ids = set(db.scalars(select(User.id)).all())
        alpha_enabled_users = set(
            db.scalars(
                select(UserAlphaWebSocketConfig.user_id).where(UserAlphaWebSocketConfig.is_enabled.is_(True))
            ).all()
        )
    finally:
        db.close()

    deleted_by_pattern = {
        "live:ticks:*": 0,
        "alert-live:session:*": 0,
        "alert:workflow:last-tick:*": 0,
        "alert:notifications:*": 0,
        "alpha:ws:*": 0,
    }

    for raw_key in client.scan_iter(match="live:ticks:*", count=500):
        key = raw_key.decode() if isinstance(raw_key, bytes) else str(raw_key)
        if key not in active_streams:
            deleted_by_pattern["live:ticks:*"] += int(bool(client.delete(key)))

    active_session_prefixes = {
        root.replace("live:ticks:", "alert-live:session:", 1) for root in active_streams
    }
    for raw_key in client.scan_iter(match="alert-live:session:*", count=500):
        key = raw_key.decode() if isinstance(raw_key, bytes) else str(raw_key)
        base = ":".join(key.split(":")[:5])
        if base not in active_session_prefixes:
            deleted_by_pattern["alert-live:session:*"] += int(bool(client.delete(key)))

    for raw_key in client.scan_iter(match="alert:workflow:last-tick:*", count=500):
        key = raw_key.decode() if isinstance(raw_key, bytes) else str(raw_key)
        workflow_id = key.rsplit(":", 1)[-1]
        if workflow_id not in workflow_ids:
            deleted_by_pattern["alert:workflow:last-tick:*"] += int(bool(client.delete(key)))

    for raw_key in client.scan_iter(match="alert:notifications:*", count=500):
        key = raw_key.decode() if isinstance(raw_key, bytes) else str(raw_key)
        user_id = key.rsplit(":", 1)[-1]
        if user_id not in user_ids:
            deleted_by_pattern["alert:notifications:*"] += int(bool(client.delete(key)))

    for raw_key in client.scan_iter(match="alpha:ws:*", count=500):
        key = raw_key.decode() if isinstance(raw_key, bytes) else str(raw_key)
        parts = key.split(":")
        user_id = parts[2] if len(parts) >= 4 else ""
        if user_id not in alpha_enabled_users:
            deleted_by_pattern["alpha:ws:*"] += int(bool(client.delete(key)))

    return {
        "deleted_by_pattern": deleted_by_pattern,
        "deleted_keys_total": sum(deleted_by_pattern.values()),
    }


def _maybe_vacuum_sqlite(*, force: bool, deleted_rows: int) -> dict[str, Any]:
    global _last_sqlite_vacuum_monotonic
    settings = _settings()
    db_path = _sqlite_path()
    if db_path is None:
        return {"performed": False, "reason": "non-sqlite database"}

    now_monotonic = time.monotonic()
    min_interval = max(settings.system_sqlite_vacuum_min_interval_seconds, 60)
    interval_elapsed = (
        _last_sqlite_vacuum_monotonic is None
        or now_monotonic - _last_sqlite_vacuum_monotonic >= min_interval
    )
    if not force and deleted_rows <= 0:
        return {"performed": False, "reason": "no sqlite churn"}
    if not force and not interval_elapsed:
        return {"performed": False, "reason": "vacuum interval not reached"}

    before_size = db_path.stat().st_size if db_path.exists() else 0
    wal_path = db_path.with_suffix(db_path.suffix + "-wal")
    wal_before_size = wal_path.stat().st_size if wal_path.exists() else 0

    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("VACUUM")
    finally:
        conn.close()

    _last_sqlite_vacuum_monotonic = now_monotonic
    after_size = db_path.stat().st_size if db_path.exists() else 0
    wal_after_size = wal_path.stat().st_size if wal_path.exists() else 0
    return {
        "performed": True,
        "db_path": str(db_path),
        "before_size_bytes": before_size,
        "after_size_bytes": after_size,
        "wal_before_size_bytes": wal_before_size,
        "wal_after_size_bytes": wal_after_size,
    }


def _sqlite_path() -> Path | None:
    database_url = _settings().database_url
    if not database_url.startswith("sqlite:///"):
        return None
    return Path(database_url.replace("sqlite:///", "", 1)).resolve()
