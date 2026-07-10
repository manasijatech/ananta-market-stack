"""broker market candle cache

Revision ID: a9f3c7d1e2b4
Revises: f1a8c3d2e9b4
Create Date: 2026-06-26 12:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9f3c7d1e2b4"
down_revision: Union[str, None] = "f1a8c3d2e9b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _index_names(table_name: str) -> set[str]:
    if not _table_exists(table_name):
        return set()
    return {index["name"] for index in _inspector().get_indexes(table_name)}


def upgrade() -> None:
    table_name = "broker_market_candle_cache"
    if not _table_exists(table_name):
        op.create_table(
            table_name,
            sa.Column("broker_code", sa.String(length=32), nullable=False),
            sa.Column("symbol", sa.String(length=128), nullable=False),
            sa.Column("exchange", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("interval", sa.String(length=32), nullable=False),
            sa.Column("candle_time", sa.DateTime(), nullable=False),
            sa.Column("open", sa.Float(), nullable=False),
            sa.Column("high", sa.Float(), nullable=False),
            sa.Column("low", sa.Float(), nullable=False),
            sa.Column("close", sa.Float(), nullable=False),
            sa.Column("volume", sa.Float(), nullable=True),
            sa.Column("source_payload_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("fetched_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("broker_code", "symbol", "exchange", "interval", "candle_time"),
            sa.UniqueConstraint(
                "broker_code",
                "symbol",
                "exchange",
                "interval",
                "candle_time",
                name="uq_broker_market_candle_cache_series_time",
            ),
        )
    for name, columns in (
        ("ix_broker_market_candle_cache_candle_time", ["candle_time"]),
        ("ix_broker_market_candle_cache_fetched_at", ["fetched_at"]),
        ("ix_broker_market_candle_cache_updated_at", ["updated_at"]),
    ):
        if name not in _index_names(table_name):
            op.create_index(name, table_name, columns)


def downgrade() -> None:
    for name in (
        "ix_broker_market_candle_cache_updated_at",
        "ix_broker_market_candle_cache_fetched_at",
        "ix_broker_market_candle_cache_candle_time",
    ):
        op.drop_index(name, table_name="broker_market_candle_cache")
    op.drop_table("broker_market_candle_cache")
