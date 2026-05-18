from datetime import datetime

from common.datetime_compat import UTC
from app.services import alerts as alert_svc
from app.schemas.alert import AlertWorkflowActivePeriod
from app.services.alerts_engine.active_period import evaluate_active_period
from app.services.alerts_engine.ast import ensure_workflow_ast
from app.services.alerts_engine.conditions import evaluate_logic
from app.services.alerts_engine.dsl import validate_dsl_text
from app.services.alerts_engine.reconcile import reconcile_user_subscriptions
from db.models import BrokerAccount, LiveSymbolSubscription, User, UserWatchlist, UserWatchlistSymbol
from db.session import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def test_legacy_rule_payload_migrates_to_ast():
    ast = ensure_workflow_ast(
        {
            "combine": "all",
            "cooldown_seconds": 120,
            "conditions": [{"field": "ltp", "operator": "gte", "value": 100}],
            "targeting": {
                "mode": "symbol_list",
                "entries": [{"symbol": "RELIANCE", "exchange": "NSE", "instrument_ref": {}}],
            },
        }
    )

    assert ast.version == 2
    assert ast.cooldown_seconds == 120
    assert ast.target_universe.kind == "static_symbols"
    assert ast.target_universe.symbols[0]["symbol"] == "RELIANCE"
    assert ast.logic.children[0].operator == "gte"


def test_condition_registry_evaluates_nested_logic():
    ast = ensure_workflow_ast(
        {
            "workflow_ast": {
                "target_universe": {"kind": "static_symbols", "symbols": []},
                "logic": {
                    "kind": "all",
                    "children": [
                        {"kind": "condition", "field": "ltp", "operator": "gte", "value": 100},
                        {"kind": "condition", "field": "volume", "operator": "volume_spike", "value": 2, "compare_to": "avg_volume"},
                    ],
                },
            }
        }
    )

    result = evaluate_logic(ast.logic, {"ltp": 101, "volume": 250, "avg_volume": 100}, {})

    assert result.matched is True
    assert "ltp" in result.reason


def test_dsl_validation_returns_ast_for_safe_expression():
    result = validate_dsl_text("all(ltp >= 100, volume_spike(volume, value=2, compare_to=avg_volume))")

    assert result["valid"] is True
    assert result["workflow_ast"]["logic"]["kind"] == "all"


def test_condition_registry_evaluates_practical_operator_families():
    ast = ensure_workflow_ast(
        {
            "workflow_ast": {
                "target_universe": {"kind": "static_symbols", "symbols": []},
                "logic": {
                    "kind": "all",
                    "children": [
                        {"kind": "condition", "field": "ltp", "operator": "breaks_day_high"},
                        {"kind": "condition", "field": "open", "operator": "gap_up_pct_gte", "value": 2, "compare_to": "close"},
                        {"kind": "condition", "field": "open_interest", "operator": "oi_change_gte", "value": 1000},
                    ],
                },
            }
        }
    )

    result = evaluate_logic(
        ast.logic,
        {"ltp": 105, "high": 105, "open": 104, "close": 100, "open_interest": 25000},
        {"open_interest": 23000},
    )

    assert result.matched is True
    assert "breaks_day_high" in result.reason


def test_dsl_validation_rejects_unknown_field():
    result = validate_dsl_text("unknown_field >= 100")

    assert result["valid"] is False
    assert "Unknown field" in result["errors"][0]


def test_reconcile_creates_and_deactivates_watchlist_subscription():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    try:
        db.add(User(id="u1", display_name="User"))
        db.add(BrokerAccount(id="b1", user_id="u1", broker_code="zerodha", label="Zerodha", is_active=True))
        db.add(UserWatchlist(id="w1", user_id="u1", name="Core"))
        db.add(
            UserWatchlistSymbol(
                id="s1",
                watchlist_id="w1",
                symbol="RELIANCE",
                exchange="NSE",
                instrument_ref_json="{}",
                sort_order=0,
            )
        )
        db.commit()

        created_report = reconcile_user_subscriptions(db, "u1")
        row = db.query(LiveSymbolSubscription).one()
        assert created_report["created"] == 1
        assert row.source_type == "watchlist"
        assert row.owner_kind == "watchlist"
        assert row.status == "active"

        db.query(UserWatchlistSymbol).delete()
        db.commit()
        removed_report = reconcile_user_subscriptions(db, "u1")
        db.refresh(row)
        assert removed_report["deactivated"] == 1
        assert row.status == "inactive"
        assert row.health_status == "orphaned"
    finally:
        db.close()


def test_live_stream_status_excludes_inactive_subscriptions_from_desired_tracking():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    try:
        db.add(User(id="u1", display_name="User"))
        db.add(
            BrokerAccount(
                id="b1",
                user_id="u1",
                broker_code="zerodha",
                label="Zerodha",
                is_active=True,
                session_status="active",
            )
        )
        db.add_all(
            [
                LiveSymbolSubscription(
                    id="sub-active",
                    user_id="u1",
                    workflow_id=None,
                    account_id="b1",
                    broker_code="zerodha",
                    symbol="RELIANCE",
                    exchange="NSE",
                    source_kind="watchlist",
                    source_type="watchlist",
                    owner_kind="watchlist",
                    owner_id="w1",
                    status="active",
                    instrument_ref_json="{}",
                    last_quote_json="{}",
                    health_status="healthy",
                    health_reason="",
                ),
                LiveSymbolSubscription(
                    id="sub-inactive",
                    user_id="u1",
                    workflow_id=None,
                    account_id="b1",
                    broker_code="zerodha",
                    symbol="INFY",
                    exchange="NSE",
                    source_kind="watchlist",
                    source_type="watchlist",
                    owner_kind="watchlist",
                    owner_id="w1",
                    status="inactive",
                    instrument_ref_json="{}",
                    last_quote_json="{}",
                    health_status="orphaned",
                    health_reason="No active watchlist or workflow currently owns this subscription.",
                ),
            ]
        )
        db.commit()

        status = alert_svc.live_stream_status(db, "u1")

        assert [item.symbol for item in status.desired_subscriptions] == ["RELIANCE"]
        assert [item.symbol for item in status.inactive_subscriptions] == ["INFY"]
        assert status.active_sessions[0].symbols == ["RELIANCE"]
        assert status.broker_statuses[0].desired_symbol_count == 1
    finally:
        db.close()


def test_active_period_blocks_market_data_after_close():
    result = evaluate_active_period(
        AlertWorkflowActivePeriod(),
        {"exchange": "NSE", "segment": "NSE", "instrument_type": "EQ"},
        now=datetime(2026, 5, 15, 11, 0, tzinfo=UTC),
    )

    assert result.active is False
    assert result.reason == "outside active market hours"


def test_active_period_scope_only_applies_to_matching_segment():
    config = AlertWorkflowActivePeriod(segments=["NFO"])
    outside_equity = evaluate_active_period(
        config,
        {"exchange": "NSE", "segment": "NSE", "instrument_type": "EQ"},
        now=datetime(2026, 5, 15, 11, 0, tzinfo=UTC),
    )
    matching_derivative = evaluate_active_period(
        config,
        {"exchange": "NFO", "segment": "NFO", "instrument_type": "FUT"},
        now=datetime(2026, 5, 15, 11, 0, tzinfo=UTC),
    )

    assert outside_equity.active is True
    assert outside_equity.reason == "active period scope does not apply"
    assert matching_derivative.active is False
