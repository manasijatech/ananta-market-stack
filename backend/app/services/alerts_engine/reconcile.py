from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from common.datetime_compat import UTC
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.broker import InstrumentRef
from app.services import broker_data_preferences
from app.schemas.alert import AlertWorkflowDsl
from app.services.alerts_engine.ast import ensure_workflow_ast
from app.services.alerts_engine.universes import ResolvedSymbol, resolve_universe
from db.models import (
    AlertWorkflow,
    BrokerAccount,
    LiveSymbolSubscription,
    SystemWatchlistPresetSymbol,
    UserWatchlist,
    UserWatchlistSymbol,
)


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
    return broker_data_preferences.get_effective_default_broker_account(db, user_id, broker_code)


def _resolve_account(
    db: Session,
    user_id: str,
    account_id: str | None,
    broker_code: str | None,
) -> tuple[str | None, str | None]:
    if account_id:
        account = db.get(BrokerAccount, account_id)
        if account and account.user_id == user_id and account.is_active:
            return account.id, account.broker_code
    account = _default_broker_account(db, user_id, broker_code)
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
        select(AlertWorkflow).where(AlertWorkflow.user_id == user_id, AlertWorkflow.status == "active")
    ).all()
    for workflow in workflows:
        try:
            dsl = AlertWorkflowDsl(**_json_loads(workflow.workflow_dsl_json))
            workflow_ast = ensure_workflow_ast(dsl)
            symbols = resolve_universe(db, user_id, workflow_ast.target_universe)
        except Exception:
            workflow.last_runtime_error = "Could not resolve workflow target universe"
            workflow.deployment_status = "error"
            db.add(workflow)
            continue
        account_id, broker_code = _resolve_account(db, user_id, workflow.account_id, workflow.broker_code)
        if account_id and (workflow.account_id != account_id or workflow.broker_code != broker_code):
            workflow.account_id = account_id
            workflow.broker_code = broker_code
            workflow.deployment_status = "healed"
            workflow.last_runtime_error = None
            workflow.updated_at = _now()
            db.add(workflow)
        elif not account_id:
            workflow.deployment_status = "action_required"
            workflow.last_runtime_error = "No verified active broker account is available for this workflow."
            workflow.updated_at = _now()
            db.add(workflow)
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
                    source_kind="workflow",
                    source_type=symbol.source_type,
                    source_id=symbol.source_id,
                    source_label=symbol.source_label,
                    owner_kind="workflow",
                    owner_id=workflow.id,
                )
            )
    return desired


def build_desired_subscriptions(db: Session, user_id: str) -> list[DesiredSubscription]:
    deduped: dict[tuple[str | None, str | None, str | None, str, str | None, str, str], DesiredSubscription] = {}
    for item in [*_watchlist_desired(db, user_id), *_workflow_desired(db, user_id)]:
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
    desired = build_desired_subscriptions(db, user_id)
    now = _now()
    created = restored = updated = deactivated = orphaned = errors = 0
    desired_keys = set()

    for item in desired:
        desired_keys.add((item.account_id, item.broker_code, item.workflow_id, item.symbol, item.exchange, item.owner_kind, item.owner_id))
        try:
            row = db.scalar(
                select(LiveSymbolSubscription).where(
                    LiveSymbolSubscription.user_id == user_id,
                    LiveSymbolSubscription.account_id == item.account_id,
                    LiveSymbolSubscription.broker_code == item.broker_code,
                    LiveSymbolSubscription.workflow_id == item.workflow_id,
                    LiveSymbolSubscription.symbol == item.symbol,
                    LiveSymbolSubscription.exchange == item.exchange,
                    LiveSymbolSubscription.owner_kind == item.owner_kind,
                    LiveSymbolSubscription.owner_id == item.owner_id,
                )
            )
            if row is None:
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
                created += 1
            elif row.status != "active":
                restored += 1
            else:
                updated += 1
            row.instrument_ref_json = _json_dumps(item.instrument_ref.model_dump(exclude_none=True))
            row.source_kind = item.source_kind
            row.source_type = item.source_type
            row.source_id = item.source_id
            row.source_label = item.source_label
            row.owner_kind = item.owner_kind
            row.owner_id = item.owner_id
            row.status = "active"
            row.reconciled_at = now
            row.health_status = "healthy"
            row.health_reason = ""
            row.updated_at = now
            db.add(row)
        except Exception:
            errors += 1

    managed_rows = db.scalars(
        select(LiveSymbolSubscription).where(
            LiveSymbolSubscription.user_id == user_id,
            LiveSymbolSubscription.source_kind.in_(["watchlist", "workflow"]),
        )
    ).all()
    for row in managed_rows:
        key = (row.account_id, row.broker_code, row.workflow_id, row.symbol, row.exchange, row.owner_kind, row.owner_id)
        if key in desired_keys:
            continue
        row.status = "inactive"
        row.reconciled_at = now
        row.health_status = "orphaned"
        row.health_reason = "No active watchlist or workflow currently owns this subscription."
        row.updated_at = now
        db.add(row)
        deactivated += 1
        orphaned += 1

    db.commit()
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
