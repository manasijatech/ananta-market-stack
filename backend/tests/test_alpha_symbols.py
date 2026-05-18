from datetime import datetime

from app.services import alpha_symbols
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
