"""broker instrument master

Revision ID: 3b1f6d7c9a2e
Revises: f5ed572aacd8
Create Date: 2026-05-11 11:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "3b1f6d7c9a2e"
down_revision: Union[str, None] = "f5ed572aacd8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "broker_instrument_sync_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("broker_code", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_broker_instrument_sync_runs_broker_code",
        "broker_instrument_sync_runs",
        ["broker_code"],
    )
    op.create_index(
        "ix_broker_instrument_sync_runs_started_at",
        "broker_instrument_sync_runs",
        ["started_at"],
    )
    op.create_index(
        "ix_broker_instrument_sync_runs_status",
        "broker_instrument_sync_runs",
        ["status"],
    )

    op.create_table(
        "broker_instruments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("broker_code", sa.String(length=32), nullable=False),
        sa.Column("exchange", sa.String(length=32), nullable=True),
        sa.Column("segment", sa.String(length=64), nullable=True),
        sa.Column("symbol", sa.String(length=128), nullable=False),
        sa.Column("trading_symbol", sa.String(length=128), nullable=True),
        sa.Column("name", sa.String(length=256), nullable=True),
        sa.Column("isin", sa.String(length=64), nullable=True),
        sa.Column("instrument_type", sa.String(length=64), nullable=True),
        sa.Column("expiry", sa.DateTime(), nullable=True),
        sa.Column("strike", sa.String(length=64), nullable=True),
        sa.Column("option_type", sa.String(length=16), nullable=True),
        sa.Column("lot_size", sa.String(length=32), nullable=True),
        sa.Column("tick_size", sa.String(length=32), nullable=True),
        sa.Column("zerodha_instrument_token", sa.String(length=64), nullable=True),
        sa.Column("upstox_instrument_key", sa.String(length=128), nullable=True),
        sa.Column("angel_token", sa.String(length=64), nullable=True),
        sa.Column("dhan_security_id", sa.String(length=64), nullable=True),
        sa.Column("dhan_exchange_segment", sa.String(length=64), nullable=True),
        sa.Column("groww_exchange", sa.String(length=32), nullable=True),
        sa.Column("groww_segment", sa.String(length=32), nullable=True),
        sa.Column("groww_trading_symbol", sa.String(length=128), nullable=True),
        sa.Column("indmoney_scrip_code", sa.String(length=64), nullable=True),
        sa.Column("kotak_query", sa.String(length=256), nullable=True),
        sa.Column("kotak_segment", sa.String(length=64), nullable=True),
        sa.Column("kotak_psymbol", sa.String(length=128), nullable=True),
        sa.Column("searchable_text", sa.Text(), nullable=False),
        sa.Column("native_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("raw_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_broker_instruments_broker_code", ["broker_code"]),
        ("ix_broker_instruments_exchange", ["exchange"]),
        ("ix_broker_instruments_segment", ["segment"]),
        ("ix_broker_instruments_symbol", ["symbol"]),
        ("ix_broker_instruments_trading_symbol", ["trading_symbol"]),
        ("ix_broker_instruments_isin", ["isin"]),
        ("ix_broker_instruments_instrument_type", ["instrument_type"]),
        ("ix_broker_instruments_expiry", ["expiry"]),
        ("ix_broker_instruments_option_type", ["option_type"]),
        ("ix_broker_instruments_zerodha_instrument_token", ["zerodha_instrument_token"]),
        ("ix_broker_instruments_upstox_instrument_key", ["upstox_instrument_key"]),
        ("ix_broker_instruments_angel_token", ["angel_token"]),
        ("ix_broker_instruments_dhan_security_id", ["dhan_security_id"]),
        ("ix_broker_instruments_indmoney_scrip_code", ["indmoney_scrip_code"]),
        ("ix_broker_instruments_fetched_at", ["fetched_at"]),
    ):
        op.create_index(name, "broker_instruments", columns)


def downgrade() -> None:
    for name in (
        "ix_broker_instruments_fetched_at",
        "ix_broker_instruments_indmoney_scrip_code",
        "ix_broker_instruments_dhan_security_id",
        "ix_broker_instruments_angel_token",
        "ix_broker_instruments_upstox_instrument_key",
        "ix_broker_instruments_zerodha_instrument_token",
        "ix_broker_instruments_option_type",
        "ix_broker_instruments_expiry",
        "ix_broker_instruments_instrument_type",
        "ix_broker_instruments_isin",
        "ix_broker_instruments_trading_symbol",
        "ix_broker_instruments_symbol",
        "ix_broker_instruments_segment",
        "ix_broker_instruments_exchange",
        "ix_broker_instruments_broker_code",
    ):
        op.drop_index(name, table_name="broker_instruments")
    op.drop_table("broker_instruments")

    for name in (
        "ix_broker_instrument_sync_runs_status",
        "ix_broker_instrument_sync_runs_started_at",
        "ix_broker_instrument_sync_runs_broker_code",
    ):
        op.drop_index(name, table_name="broker_instrument_sync_runs")
    op.drop_table("broker_instrument_sync_runs")
