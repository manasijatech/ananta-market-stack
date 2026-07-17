from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from common.datetime_compat import UTC
import redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas.broker import InstrumentRef
from app.services import broker_data_preferences
from app.schemas.alert import AlertWorkflowDsl
from app.services.alerts_engine.ast import ensure_workflow_ast
from app.services.alerts_engine.universes import ResolvedSymbol, resolve_universe
from app.services.live_price_scope import publish_scope_change
from db.models import (
    AlertWorkflow,
    BrokerAccount,
    LiveSymbolSubscription,
    SystemWatchlistPresetSymbol,
    UserWatchlist,
    UserWatchlistSymbol,
)
from broker.core.redis_cache import _redis_client

def _ui_demand_subscription_ttl_seconds() -> int:
    return max(int(get_settings().live_ui_demand_ttl_seconds), 60)


@dataclass(frozen=True)
class DesiredSubscription:
    user_id: str
    account_id: str | None
    broker_code: str | None
    workflow_id: str | None
    symbol: str
    exchange: str | None
    instrument_ref: InstrumentRef
    source_kind: str
    source_type: str
    source_id: str | None
    source_label: str | None
    owner_kind: str
    owner_id: str


def _now() -> datetime:
    return datetime.now(tz=UTC).replace(tzinfo=None)


def _delete_quote_caches(
    redis_client: redis.Redis | None,
    rows: list[LiveSymbolSubscription],
) -> None:
    if redis_client is None:
        return
    keys = {
        f"live:quote:{row.user_id}:{row.account_id}:{row.broker_code}:{row.symbol}"
        for row in rows
        if row.account_id and row.broker_code and row.symbol
    }
    if not keys:
        return
    try:
        redis_client.delete(*keys)
    except redis.RedisError:
        return


def _json_dumps(value: Any) -> str:
    return json.dumps(value, default=str)


def _json_loads(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {}


def _default_broker_account(db: Session, user_id: str, broker_code: str | None = None) -> BrokerAccount | None:
    return broker_data_preferences.get_stream_default_broker_account(db, user_id, broker_code)


def _resolve_account(
    db: Session,
    user_id: str,
    account_id: str | None,
    broker_code: str | None,
) -> tuple[str | None, str | None]:
    accessible_accounts = broker_data_preferences.get_accessible_data_accounts(db, user_id, broker_code)
    if account_id:
        account = next((row for row in accessible_accounts if row.id == account_id), None)
        if account:
            return account.id, account.broker_code
    account = accessible_accounts[0] if accessible_accounts else _default_broker_account(db, user_id, broker_code)
    if account:
        return account.id, account.broker_code
    return account_id, broker_code


def _watchlist_desired(db: Session, user_id: str) -> list[DesiredSubscription]:
    desired: list[DesiredSubscription] = []
    watchlists = db.scalars(select(UserWatchlist).where(UserWatchlist.user_id == user_id)).all()
    account_id, broker_code = _resolve_account(db, user_id, None, None)
    for watchlist in watchlists:
        if watchlist.kind == "preset" and watchlist.system_preset_id:
            rows = db.scalars(
                select(SystemWatchlistPresetSymbol).where(
                    SystemWatchlistPresetSymbol.preset_id == watchlist.system_preset_id
                )
            ).all()
            source_type = "preset_watchlist"
        else:
            rows = db.scalars(select(UserWatchlistSymbol).where(UserWatchlistSymbol.watchlist_id == watchlist.id)).all()
            source_type = "watchlist"
        for row in rows:
            ref = InstrumentRef(**_json_loads(getattr(row, "instrument_ref_json", None)))
            ref.symbol = ref.symbol or row.symbol
            ref.exchange = ref.exchange or row.exchange or None
            desired.append(
                DesiredSubscription(
                    user_id=user_id,
                    account_id=account_id,
                    broker_code=broker_code,
                    workflow_id=None,
                    symbol=row.symbol,
                    exchange=row.exchange or None,
                    instrument_ref=ref,
                    source_kind="watchlist",
                    source_type=source_type,
                    source_id=watchlist.id,
                    source_label=watchlist.name,
                    owner_kind="watchlist",
                    owner_id=watchlist.id,
                )
            )
    return desired


def _workflow_desired(db: Session, user_id: str) -> list[DesiredSubscription]:
    desired: list[DesiredSubscription] = []
    workflows = db.scalars(
        select(AlertWorkflow).where(AlertWorkflow.user_id == user_id, AlertWorkflow.status.in_(["active", "inactive"]))
    ).all()
    for workflow in workflows:
        try:
            dsl = AlertWorkflowDsl(**_json_loads(workflow.workflow_dsl_json))
            if workflow.status != "active" and dsl.workflow_type != "market_data":
                continue
            workflow_ast = ensure_workflow_ast(dsl)
            symbols = resolve_universe(db, user_id, workflow_ast.target_universe)
        except Exception:
            if workflow.status == "active":
                workflow.last_runtime_error = "Could not resolve workflow target universe"
                workflow.deployment_status = "error"
                db.add(workflow)
            continue
        account_id, broker_code = _resolve_account(db, user_id, workflow.account_id, workflow.broker_code)
        if workflow.status == "active" and account_id and (workflow.account_id != account_id or workflow.broker_code != broker_code):
            workflow.account_id = account_id
            workflow.broker_code = broker_code
            workflow.deployment_status = "healed"
            workflow.last_runtime_error = None
            workflow.updated_at = _now()
            db.add(workflow)
        elif workflow.status == "active" and not account_id:
            workflow.deployment_status = "action_required"
            workflow.last_runtime_error = "No verified active broker account is available for this workflow."
            workflow.updated_at = _now()
            db.add(workflow)
        source_kind = "workflow" if workflow.status == "active" else "background_workflow"
        for symbol in symbols:
            ref = symbol.instrument_ref or InstrumentRef(symbol=symbol.symbol, exchange=symbol.exchange)
            desired.append(
                DesiredSubscription(
                    user_id=user_id,
                    account_id=account_id,
                    broker_code=broker_code,
                    workflow_id=workflow.id,
                    symbol=symbol.symbol,
                    exchange=symbol.exchange,
                    instrument_ref=ref,
                    source_kind=source_kind,
                    source_type=symbol.source_type if workflow.status == "active" else "inactive_workflow",
                    source_id=symbol.source_id,
                    source_label=symbol.source_label if workflow.status == "active" else f"{workflow.name} (inactive)",
                    owner_kind="workflow",
                    owner_id=workflow.id,
                )
            )
    return desired


def build_desired_subscriptions(db: Session, user_id: str) -> list[DesiredSubscription]:
    deduped: dict[tuple[str | None, str | None, str | None, str, str | None, str, str], DesiredSubscription] = {}
    for item in [*_workflow_desired(db, user_id), *_watchlist_desired(db, user_id)]:
        key = (
            item.account_id,
            item.broker_code,
            item.workflow_id,
            item.symbol,
            item.exchange,
            item.owner_kind,
            item.owner_id,
        )
        deduped.setdefault(key, item)
    return list(deduped.values())


def reconcile_user_subscriptions(db: Session, user_id: str) -> dict[str, Any]:
    cleanup_expired_ui_subscriptions(db, user_id=user_id, commit=False)
    desired = build_desired_subscriptions(db, user_id)
    now = _now()
    created = restored = updated = deactivated = orphaned = errors = 0
    desired_keys: set[tuple[str | None, str | None, str | None, str, str | None, str | None, str | None]] = set()
    redis_client = _redis_client()
    managed_rows = list(
        db.scalars(
            select(LiveSymbolSubscription).where(
                LiveSymbolSubscription.user_id == user_id,
                LiveSymbolSubscription.source_kind.in_(["watchlist", "workflow", "background_workflow"]),
            )
        ).all()
    )
    existing_by_key: dict[
        tuple[str | None, str | None, str | None, str, str | None, str | None, str | None],
        LiveSymbolSubscription,
    ] = {}
    for row in managed_rows:
        key = (
            row.account_id,
            row.broker_code,
            row.workflow_id,
            row.symbol,
            row.exchange,
            row.owner_kind,
            row.owner_id,
        )
        existing_by_key.setdefault(key, row)

    for item in desired:
        key = (
            item.account_id,
            item.broker_code,
            item.workflow_id,
            item.symbol,
            item.exchange,
            item.owner_kind,
            item.owner_id,
        )
        desired_keys.add(key)
        try:
            row = existing_by_key.get(key)
            is_new = row is None
            instrument_ref_json = _json_dumps(item.instrument_ref.model_dump(exclude_none=True))
            if is_new:
                row = LiveSymbolSubscription(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    workflow_id=item.workflow_id,
                    account_id=item.account_id,
                    broker_code=item.broker_code,
                    symbol=item.symbol,
                    exchange=item.exchange,
                    source_kind=item.source_kind,
                    created_at=now,
                )
                managed_rows.append(row)
                existing_by_key[key] = row
                created += 1
            elif row.status != "active":
                restored += 1
            else:
                updated += 1

            was_inactive = not is_new and row.status != "active"
            metadata_changed = any(
                (
                    row.instrument_ref_json != instrument_ref_json,
                    row.source_kind != item.source_kind,
                    row.source_type != item.source_type,
                    row.source_id != item.source_id,
                    row.source_label != item.source_label,
                    row.owner_kind != item.owner_kind,
                    row.owner_id != item.owner_id,
                )
            )
            if not is_new and not was_inactive and not metadata_changed:
                continue

            row.instrument_ref_json = instrument_ref_json
            row.source_kind = item.source_kind
            row.source_type = item.source_type
            row.source_id = item.source_id
            row.source_label = item.source_label
            row.owner_kind = item.owner_kind
            row.owner_id = item.owner_id
            row.status = "active"
            row.reconciled_at = now
            if is_new or was_inactive or row.last_received_at is None:
                row.health_status = "pending"
                row.health_reason = "Waiting for the live price worker to fetch this subscription."
            row.updated_at = now
            db.add(row)
        except Exception:
            errors += 1

    deactivated_rows: list[LiveSymbolSubscription] = []
    for row in managed_rows:
        key = (row.account_id, row.broker_code, row.workflow_id, row.symbol, row.exchange, row.owner_kind, row.owner_id)
        if key in desired_keys or row.status != "active":
            continue
        deactivated_rows.append(row)
        row.status = "inactive"
        row.reconciled_at = now
        row.health_status = "orphaned"
        row.health_reason = "No active watchlist or workflow currently owns this subscription."
        row.updated_at = now
        db.add(row)
        deactivated += 1
        orphaned += 1

    _delete_quote_caches(redis_client, deactivated_rows)
    db.commit()
    if created or restored or deactivated or orphaned:
        publish_scope_change(user_id, reason="reconciled")
    return {
        "user_id": user_id,
        "created": created,
        "restored": restored,
        "updated": updated,
        "deactivated": deactivated,
        "orphaned": orphaned,
        "errors": errors,
        "desired": len(desired),
        "ran_at": now.isoformat(),
    }


def cleanup_expired_ui_subscriptions(
    db: Session,
    *,
    user_id: str | None = None,
    commit: bool = True,
) -> int:
    cutoff = _now() - timedelta(seconds=_ui_demand_subscription_ttl_seconds())
    stmt = select(LiveSymbolSubscription).where(
        LiveSymbolSubscription.source_kind == "ui",
        LiveSymbolSubscription.updated_at < cutoff,
    )
    if user_id:
        stmt = stmt.where(LiveSymbolSubscription.user_id == user_id)
    rows = db.scalars(stmt).all()
    if not rows:
        return 0
    affected_user_ids = {row.user_id for row in rows if row.user_id}
    redis_client = _redis_client()
    _delete_quote_caches(redis_client, rows)
    for row in rows:
        db.delete(row)
    if commit:
        db.commit()
    for affected_user_id in affected_user_ids:
        publish_scope_change(affected_user_id, reason="ui_expired")
    return len(rows)


def reconcile_all_users(db: Session) -> dict[str, Any]:
    user_ids = {
        *[row[0] for row in db.execute(select(AlertWorkflow.user_id).distinct()).all()],
        *[row[0] for row in db.execute(select(UserWatchlist.user_id).distinct()).all()],
    }
    totals = {"users": len(user_ids), "created": 0, "restored": 0, "updated": 0, "deactivated": 0, "orphaned": 0, "errors": 0, "desired": 0}
    reports = []
    for user_id in sorted(user_ids):
        report = reconcile_user_subscriptions(db, user_id)
        reports.append(report)
        for key in ("created", "restored", "updated", "deactivated", "orphaned", "errors", "desired"):
            totals[key] += int(report.get(key) or 0)
    totals["reports"] = reports
    totals["ran_at"] = _now().isoformat()
    return totals
