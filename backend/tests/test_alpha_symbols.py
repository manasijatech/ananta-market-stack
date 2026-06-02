from datetime import datetime

from drishti_sdk import DrishtiApiError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.services import alpha_symbols
from db.session import Base
from db.models import AlphaSymbolMetadataCache


def test_alpha_symbol_normalization_dedupes_and_uppercases():
    assert alpha_symbols._normalize_symbols([" reliance ", "RELIANCE", "", "tcs"]) == [
        "RELIANCE",
        "TCS",
    ]


def test_alpha_symbol_payload_maps_logo_and_scrip_code():
    row = alpha_symbols._payload_to_schema(
        {
            "symbol": "reliance",
            "company_name": "Reliance Industries",
            "logo": "https://example.test/logo.png",
            "market_cap": 123,
            "sector": "Energy",
            "scrip_code": 500325,
        },
        "RELIANCE",
    )

    assert row.symbol == "RELIANCE"
    assert row.company_name == "Reliance Industries"
    assert row.logo == "https://example.test/logo.png"
    assert row.market_cap == 123
    assert row.sector == "Energy"
    assert row.scrip_code == "500325"


def test_cached_symbol_rows_do_not_expire_by_age():
    row = AlphaSymbolMetadataCache(
        symbol="RELIANCE",
        company_name="Reliance Industries",
        fetched_at=datetime(2000, 1, 1),
        created_at=datetime(2000, 1, 1),
        updated_at=datetime(2000, 1, 1),
    )

    schema = alpha_symbols._row_to_schema(row)

    assert schema.symbol == "RELIANCE"
    assert schema.company_name == "Reliance Industries"


def test_missing_symbol_metadata_falls_back_when_alpha_lookup_is_unavailable(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()

    def fail_fetch(_api_key, _symbols):
        raise DrishtiApiError(403, {"error": {"code": "forbidden"}})

    monkeypatch.setattr(alpha_symbols.alpha_config, "get_alpha_api_key", lambda _db, _user_id: "test-key")
    monkeypatch.setattr(alpha_symbols, "_fetch_alpha_symbol_metadata", fail_fetch)

    try:
        rows = alpha_symbols.get_symbol_metadata(db, "u1", ["HALDYNGL"])
        cached = db.get(AlphaSymbolMetadataCache, "HALDYNGL")
    finally:
        db.close()

    assert [row.symbol for row in rows] == ["HALDYNGL"]
    assert rows[0].company_name is None
    assert cached is not None
    assert "metadata_status" in cached.raw_payload_json
