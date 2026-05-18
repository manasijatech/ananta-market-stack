"""alpha symbol metadata cache

Revision ID: e8f1a2b3c4d5
Revises: d91a3f7bc2e4
Create Date: 2026-05-18 10:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8f1a2b3c4d5"
down_revision: Union[str, None] = "d91a3f7bc2e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _column_names(table_name: str) -> set[str]:
    if not _table_exists(table_name):
        return set()
    return {column["name"] for column in _inspector().get_columns(table_name)}


def _index_names(table_name: str) -> set[str]:
    if not _table_exists(table_name):
        return set()
    return {index["name"] for index in _inspector().get_indexes(table_name)}


def upgrade() -> None:
    table_name = "alpha_symbol_metadata_cache"
    if not _table_exists(table_name):
        op.create_table(
            table_name,
            sa.Column("symbol", sa.String(length=128), nullable=False),
            sa.Column("company_name", sa.String(length=256), nullable=True),
            sa.Column("logo", sa.Text(), nullable=True),
            sa.Column("market_cap", sa.String(length=64), nullable=True),
            sa.Column("sector", sa.String(length=128), nullable=True),
            sa.Column("basic_industry", sa.String(length=128), nullable=True),
            sa.Column("industry", sa.String(length=128), nullable=True),
            sa.Column("macro_economic_indicator", sa.String(length=128), nullable=True),
            sa.Column("theme", sa.String(length=128), nullable=True),
            sa.Column("scrip_code", sa.String(length=64), nullable=True),
            sa.Column("raw_payload_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("fetched_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("symbol"),
        )
    columns = _column_names(table_name)
    if "raw_payload_json" not in columns:
        op.add_column(
            table_name,
            sa.Column("raw_payload_json", sa.Text(), nullable=False, server_default="{}"),
        )
    for name, columns in (
        ("ix_alpha_symbol_metadata_cache_sector", ["sector"]),
        ("ix_alpha_symbol_metadata_cache_basic_industry", ["basic_industry"]),
        ("ix_alpha_symbol_metadata_cache_industry", ["industry"]),
        ("ix_alpha_symbol_metadata_cache_scrip_code", ["scrip_code"]),
        ("ix_alpha_symbol_metadata_cache_fetched_at", ["fetched_at"]),
    ):
        if name not in _index_names(table_name):
            op.create_index(name, table_name, columns)


def downgrade() -> None:
    for name in (
        "ix_alpha_symbol_metadata_cache_fetched_at",
        "ix_alpha_symbol_metadata_cache_scrip_code",
        "ix_alpha_symbol_metadata_cache_industry",
        "ix_alpha_symbol_metadata_cache_basic_industry",
        "ix_alpha_symbol_metadata_cache_sector",
    ):
        op.drop_index(name, table_name="alpha_symbol_metadata_cache")
    op.drop_table("alpha_symbol_metadata_cache")
