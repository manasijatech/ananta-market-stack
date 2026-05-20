from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
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


def test_create_watchlist_requires_alpha_api_key():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    try:
        with pytest.raises(HTTPException) as exc_info:
            watchlist_svc.create_watchlist(db, "u1", WatchlistCreateIn(name="Momentum"))

        assert exc_info.value.status_code == 400
        assert "Manasija Alpha API key is required" in str(exc_info.value.detail)
    finally:
        db.close()
