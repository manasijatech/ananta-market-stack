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
