"""watchlist presets

Revision ID: 6d8b7f4a1c22
Revises: 4f7a2e9c1b65
Create Date: 2026-05-14 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "6d8b7f4a1c22"
down_revision: Union[str, None] = "4f7a2e9c1b65"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return inspect(op.get_bind())


def _is_sqlite() -> bool:
    return op.get_bind().dialect.name == "sqlite"


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


def _foreign_key_names(table_name: str) -> set[str]:
    if not _table_exists(table_name):
        return set()
    names: set[str] = set()
    for foreign_key in _inspector().get_foreign_keys(table_name):
        name = foreign_key.get("name")
        if name:
            names.add(name)
    return names


def upgrade() -> None:
    if not _table_exists("system_watchlist_presets"):
        op.create_table(
            "system_watchlist_presets",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("slug", sa.String(length=160), nullable=False),
            sa.Column("name", sa.String(length=256), nullable=False),
            sa.Column("trading_index_name", sa.String(length=256), nullable=False),
            sa.Column("constituent_csv_url", sa.String(length=512), nullable=True),
            sa.Column("constituent_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("search_text", sa.Text(), nullable=False, server_default=""),
            sa.Column("sync_status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("sync_error", sa.Text(), nullable=True),
            sa.Column("is_popular", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("auto_sync_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("last_catalog_sync_at", sa.DateTime(), nullable=True),
            sa.Column("last_constituents_sync_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("slug", name="uq_system_watchlist_presets_slug"),
            sa.UniqueConstraint("trading_index_name", name="uq_system_watchlist_presets_trading_index_name"),
        )
    preset_index_names = _index_names("system_watchlist_presets")
    for index_name, column_name in [
        (op.f("ix_system_watchlist_presets_slug"), "slug"),
        (op.f("ix_system_watchlist_presets_name"), "name"),
        (op.f("ix_system_watchlist_presets_sync_status"), "sync_status"),
        (op.f("ix_system_watchlist_presets_is_popular"), "is_popular"),
        (op.f("ix_system_watchlist_presets_auto_sync_enabled"), "auto_sync_enabled"),
        (op.f("ix_system_watchlist_presets_last_catalog_sync_at"), "last_catalog_sync_at"),
        (op.f("ix_system_watchlist_presets_last_constituents_sync_at"), "last_constituents_sync_at"),
        (op.f("ix_system_watchlist_presets_updated_at"), "updated_at"),
    ]:
        if index_name not in preset_index_names:
            op.create_index(index_name, "system_watchlist_presets", [column_name], unique=False)

    if not _table_exists("system_watchlist_preset_symbols"):
        op.create_table(
            "system_watchlist_preset_symbols",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("preset_id", sa.String(length=36), nullable=False),
            sa.Column("symbol", sa.String(length=64), nullable=False),
            sa.Column("exchange", sa.String(length=32), nullable=False, server_default="NSE"),
            sa.Column("company_name", sa.String(length=256), nullable=True),
            sa.Column("industry", sa.String(length=256), nullable=True),
            sa.Column("isin", sa.String(length=64), nullable=True),
            sa.Column("series", sa.String(length=32), nullable=True),
            sa.Column("weight", sa.String(length=64), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("raw_row_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["preset_id"], ["system_watchlist_presets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "preset_id",
                "symbol",
                "exchange",
                name="uq_system_watchlist_preset_symbols_symbol_exchange",
            ),
        )
    preset_symbol_index_names = _index_names("system_watchlist_preset_symbols")
    for index_name, column_name in [
        (op.f("ix_system_watchlist_preset_symbols_preset_id"), "preset_id"),
        (op.f("ix_system_watchlist_preset_symbols_symbol"), "symbol"),
        (op.f("ix_system_watchlist_preset_symbols_sort_order"), "sort_order"),
    ]:
        if index_name not in preset_symbol_index_names:
            op.create_index(index_name, "system_watchlist_preset_symbols", [column_name], unique=False)

    user_watchlist_columns = _column_names("user_watchlists")
    if "kind" not in user_watchlist_columns:
        op.add_column(
            "user_watchlists",
            sa.Column("kind", sa.String(length=32), nullable=False, server_default="manual"),
        )
    if "system_preset_id" not in user_watchlist_columns:
        op.add_column(
            "user_watchlists",
            sa.Column("system_preset_id", sa.String(length=36), nullable=True),
        )
    user_watchlist_index_names = _index_names("user_watchlists")
    if op.f("ix_user_watchlists_kind") not in user_watchlist_index_names:
        op.create_index(op.f("ix_user_watchlists_kind"), "user_watchlists", ["kind"], unique=False)
    if op.f("ix_user_watchlists_system_preset_id") not in user_watchlist_index_names:
        op.create_index(
            op.f("ix_user_watchlists_system_preset_id"),
            "user_watchlists",
            ["system_preset_id"],
            unique=False,
        )
    if not _is_sqlite() and "fk_user_watchlists_system_preset_id" not in _foreign_key_names("user_watchlists"):
        op.create_foreign_key(
            "fk_user_watchlists_system_preset_id",
            "user_watchlists",
            "system_watchlist_presets",
            ["system_preset_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    op.drop_constraint("fk_user_watchlists_system_preset_id", "user_watchlists", type_="foreignkey")
    op.drop_index(op.f("ix_user_watchlists_system_preset_id"), table_name="user_watchlists")
    op.drop_index(op.f("ix_user_watchlists_kind"), table_name="user_watchlists")
    op.drop_column("user_watchlists", "system_preset_id")
    op.drop_column("user_watchlists", "kind")

    op.drop_index(op.f("ix_system_watchlist_preset_symbols_sort_order"), table_name="system_watchlist_preset_symbols")
    op.drop_index(op.f("ix_system_watchlist_preset_symbols_symbol"), table_name="system_watchlist_preset_symbols")
    op.drop_index(op.f("ix_system_watchlist_preset_symbols_preset_id"), table_name="system_watchlist_preset_symbols")
    op.drop_table("system_watchlist_preset_symbols")

    op.drop_index(op.f("ix_system_watchlist_presets_updated_at"), table_name="system_watchlist_presets")
    op.drop_index(op.f("ix_system_watchlist_presets_last_constituents_sync_at"), table_name="system_watchlist_presets")
    op.drop_index(op.f("ix_system_watchlist_presets_last_catalog_sync_at"), table_name="system_watchlist_presets")
    op.drop_index(op.f("ix_system_watchlist_presets_auto_sync_enabled"), table_name="system_watchlist_presets")
    op.drop_index(op.f("ix_system_watchlist_presets_is_popular"), table_name="system_watchlist_presets")
    op.drop_index(op.f("ix_system_watchlist_presets_sync_status"), table_name="system_watchlist_presets")
    op.drop_index(op.f("ix_system_watchlist_presets_name"), table_name="system_watchlist_presets")
    op.drop_index(op.f("ix_system_watchlist_presets_slug"), table_name="system_watchlist_presets")
    op.drop_table("system_watchlist_presets")
