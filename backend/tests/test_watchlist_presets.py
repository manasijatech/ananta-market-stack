from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.schemas.watchlist import WatchlistCreateIn
from app.services import watchlists as watchlist_svc
from app.services import watchlist_presets as preset_svc
from db.models import SystemWatchlistPreset
from db.session import Base


def test_allowed_equity_index_codes_extract_only_supported_equity_groups():
    html = """
    <a href="/indices/equity/broad-based-indices/NIFTY--50">NIFTY 50</a>
    <a href="/indices/equity/sectoral-indices/nifty-auto">NIFTY AUTO</a>
    <a href="/indices/equity/thematic-indices/nifty-india-defence">Nifty India Defence</a>
    <a href="/indices/equity/strategy-indices/nifty100-quality-30">NIFTY100 QUALITY 30</a>
    <a href="/indices/debt/debt-indices/some-debt-index">Debt Index</a>
    """

    codes = preset_svc._allowed_equity_index_codes(html)

    assert "nifty50" in codes
    assert "niftyauto" in codes
    assert "niftyindiadefence" in codes
    assert "nifty100quality30" in codes
    assert "debtindex" not in codes


def test_symbol_normalization_preserves_valid_nse_ampersands():
    assert preset_svc._normalize_symbol(" M&M ") == "M&M"


def test_list_preset_catalog_hides_blacklisted_rows():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    try:
        now = datetime.utcnow()
        db.add_all(
            [
                SystemWatchlistPreset(
                    id="visible",
                    slug="nifty-50",
                    name="NIFTY 50",
                    trading_index_name="Nifty 50",
                    constituent_count=50,
                    search_text="nifty 50",
                    sync_status="ready",
                    last_catalog_sync_at=now,
                    created_at=now,
                    updated_at=now,
                ),
                SystemWatchlistPreset(
                    id="hidden",
                    slug="bad-index",
                    name="Bad Index",
                    trading_index_name="Bad Index",
                    constituent_count=0,
                    search_text="bad index",
                    sync_status="blacklisted",
                    last_catalog_sync_at=now,
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        db.commit()

        rows = preset_svc.list_preset_catalog(db, "u1", limit=20, offset=0)

        assert [row["id"] for row in rows] == ["visible"]
    finally:
        db.close()


def test_sync_preset_catalog_updates_existing_row_when_slug_changes(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    try:
        now = datetime.utcnow()
        db.add(
            SystemWatchlistPreset(
                id="healthcare",
                slug="nifty-healthcare-index",
                name="Nifty Healthcare INDEX",
                trading_index_name="NIFTY HEALTHCARE",
                constituent_count=20,
                search_text="nifty healthcare index",
                sync_status="ready",
                last_catalog_sync_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()

        monkeypatch.setattr(
            preset_svc,
            "_fetch_json",
            lambda _url: [
                {
                    "Trading_Index_Name": "NIFTY HEALTHCARE",
                    "Index_long_name": "Nifty Healthcare",
                }
            ],
        )
        monkeypatch.setattr(
            preset_svc,
            "_fetch_text",
            lambda _url: '<a href="/indices/equity/sectoral-indices/nifty-healthcare">Nifty Healthcare</a>',
        )

        updated = preset_svc.sync_preset_catalog(db, force=True)
        row = db.get(SystemWatchlistPreset, "healthcare")

        assert updated == 1
        assert row is not None
        assert row.slug == "nifty-healthcare"
        assert row.name == "Nifty Healthcare"
        assert row.trading_index_name == "NIFTY HEALTHCARE"
        assert row.sync_status == "ready"
        assert db.scalar(select(func.count()).select_from(SystemWatchlistPreset)) == 1
    finally:
        db.close()


def test_ensure_preset_catalog_serves_stale_rows_when_sync_fails(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    try:
        now = datetime.utcnow()
        db.add(
            SystemWatchlistPreset(
                id="visible",
                slug="nifty-50",
                name="NIFTY 50",
                trading_index_name="Nifty 50",
                constituent_count=50,
                search_text="nifty 50",
                sync_status="ready",
                last_catalog_sync_at=datetime(2020, 1, 1),
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()

        def boom(*_args, **_kwargs):
            raise HTTPException(status_code=502, detail="upstream down")

        monkeypatch.setattr(preset_svc, "sync_preset_catalog", boom)

        preset_svc.ensure_preset_catalog(db)
        rows = preset_svc.list_preset_catalog(db, "u1", limit=20, offset=0)

        assert [row["id"] for row in rows] == ["visible"]
    finally:
        db.close()


def test_list_preset_catalog_refreshes_missing_constituent_counts(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    try:
        now = datetime.utcnow()
        db.add(
            SystemWatchlistPreset(
                id="midcap",
                slug="nifty-midcap-100",
                name="NIFTY Midcap 100",
                trading_index_name="Nifty Midcap 100",
                constituent_count=0,
                search_text="nifty midcap 100",
                sync_status="pending",
                last_catalog_sync_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        db.commit()

        def fake_refresh(db, preset):
            preset.constituent_count = 100
            preset.sync_status = "ready"
            preset.last_constituents_sync_at = datetime.utcnow()
            db.add(preset)
            db.commit()
            return 100

        monkeypatch.setattr(preset_svc, "refresh_preset_constituents", fake_refresh)

        rows = preset_svc.list_preset_catalog(db, "u1", limit=20, offset=0)

        assert rows[0]["id"] == "midcap"
        assert rows[0]["constituent_count"] == 100
        assert rows[0]["sync_status"] == "ready"
    finally:
        db.close()


def test_create_watchlist_requires_alpha_api_key():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    try:
        with pytest.raises(HTTPException) as exc_info:
            watchlist_svc.create_watchlist(db, "u1", WatchlistCreateIn(name="Momentum"))

        assert exc_info.value.status_code == 400
        assert "Drishti API key is required" in str(exc_info.value.detail)
    finally:
        db.close()
