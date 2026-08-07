"""alpha feed cache and websocket event prices

Revision ID: c3d8e1f4a902
Revises: 1a7e4c9d2b60
Create Date: 2026-08-06 16:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3d8e1f4a902"
down_revision: Union[str, None] = "1a7e4c9d2b60"
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
    events_table = "alpha_websocket_events"
    if _table_exists(events_table):
        columns = _column_names(events_table)
        for name, column in (
            ("price_ltp", sa.Column("price_ltp", sa.Float(), nullable=True)),
            ("price_change_pct", sa.Column("price_change_pct", sa.Float(), nullable=True)),
            ("price_as_of", sa.Column("price_as_of", sa.DateTime(), nullable=True)),
            ("price_source", sa.Column("price_source", sa.String(length=32), nullable=True)),
            ("price_broker_code", sa.Column("price_broker_code", sa.String(length=32), nullable=True)),
        ):
            if name not in columns:
                op.add_column(events_table, column)

    if not _table_exists("alpha_feed_items"):
        op.create_table(
            "alpha_feed_items",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("product", sa.String(length=32), nullable=False),
            sa.Column("symbol", sa.String(length=128), nullable=True),
            sa.Column("item_key", sa.String(length=256), nullable=False),
            sa.Column("source", sa.String(length=16), nullable=False, server_default="rest"),
            sa.Column("published_at", sa.DateTime(), nullable=True),
            sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("price_ltp", sa.Float(), nullable=True),
            sa.Column("price_change_pct", sa.Float(), nullable=True),
            sa.Column("price_as_of", sa.DateTime(), nullable=True),
            sa.Column("price_source", sa.String(length=32), nullable=True),
            sa.Column("price_broker_code", sa.String(length=32), nullable=True),
            sa.Column("fetched_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "product", "item_key", name="uq_alpha_feed_items_user_product_item"),
        )
    for name, columns in (
        ("ix_alpha_feed_items_user_id", ["user_id"]),
        ("ix_alpha_feed_items_product", ["product"]),
        ("ix_alpha_feed_items_symbol", ["symbol"]),
        ("ix_alpha_feed_items_published_at", ["published_at"]),
        ("ix_alpha_feed_items_fetched_at", ["fetched_at"]),
    ):
        if _table_exists("alpha_feed_items") and name not in _index_names("alpha_feed_items"):
            op.create_index(name, "alpha_feed_items", columns)

    if not _table_exists("alpha_feed_symbol_sync"):
        op.create_table(
            "alpha_feed_symbol_sync",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("product", sa.String(length=32), nullable=False),
            sa.Column("symbol", sa.String(length=128), nullable=False),
            sa.Column("last_synced_at", sa.DateTime(), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "product", "symbol", name="uq_alpha_feed_symbol_sync"),
        )
    for name, columns in (
        ("ix_alpha_feed_symbol_sync_user_id", ["user_id"]),
        ("ix_alpha_feed_symbol_sync_product", ["product"]),
        ("ix_alpha_feed_symbol_sync_symbol", ["symbol"]),
        ("ix_alpha_feed_symbol_sync_last_synced_at", ["last_synced_at"]),
    ):
        if _table_exists("alpha_feed_symbol_sync") and name not in _index_names("alpha_feed_symbol_sync"):
            op.create_index(name, "alpha_feed_symbol_sync", columns)

    # Expand legacy alert-only WS configs so watchlist Market Intelligence receives live events.
    if _table_exists("user_alpha_websocket_configs"):
        op.execute(
            sa.text(
                """
                UPDATE user_alpha_websocket_configs
                SET scope_mode = 'alerts_and_watchlists',
                    include_all_watchlists = 1
                WHERE scope_mode = 'alert_subscriptions'
                """
            )
        )


def downgrade() -> None:
    if _table_exists("alpha_feed_symbol_sync"):
        op.drop_table("alpha_feed_symbol_sync")
    if _table_exists("alpha_feed_items"):
        op.drop_table("alpha_feed_items")
    events_table = "alpha_websocket_events"
    if _table_exists(events_table):
        columns = _column_names(events_table)
        for name in (
            "price_broker_code",
            "price_source",
            "price_as_of",
            "price_change_pct",
            "price_ltp",
        ):
            if name in columns:
                op.drop_column(events_table, name)
