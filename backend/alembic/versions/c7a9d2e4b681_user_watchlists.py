"""user watchlists

Revision ID: c7a9d2e4b681
Revises: 8c4f2aa91d72
Create Date: 2026-05-13 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7a9d2e4b681"
down_revision: Union[str, None] = "8c4f2aa91d72"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_watchlists",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_user_watchlists_user_name"),
    )
    op.create_index(op.f("ix_user_watchlists_user_id"), "user_watchlists", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_watchlists_updated_at"), "user_watchlists", ["updated_at"], unique=False)

    op.create_table(
        "user_watchlist_symbols",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("watchlist_id", sa.String(length=36), nullable=False),
        sa.Column("symbol", sa.String(length=64), nullable=False),
        sa.Column("exchange", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("instrument_ref_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["watchlist_id"], ["user_watchlists.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "watchlist_id",
            "symbol",
            "exchange",
            name="uq_user_watchlist_symbols_symbol_exchange",
        ),
    )
    op.create_index(
        op.f("ix_user_watchlist_symbols_watchlist_id"),
        "user_watchlist_symbols",
        ["watchlist_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_watchlist_symbols_symbol"),
        "user_watchlist_symbols",
        ["symbol"],
        unique=False,
    )
    op.create_index(
        op.f("ix_user_watchlist_symbols_sort_order"),
        "user_watchlist_symbols",
        ["sort_order"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_user_watchlist_symbols_sort_order"), table_name="user_watchlist_symbols")
    op.drop_index(op.f("ix_user_watchlist_symbols_symbol"), table_name="user_watchlist_symbols")
    op.drop_index(op.f("ix_user_watchlist_symbols_watchlist_id"), table_name="user_watchlist_symbols")
    op.drop_table("user_watchlist_symbols")
    op.drop_index(op.f("ix_user_watchlists_updated_at"), table_name="user_watchlists")
    op.drop_index(op.f("ix_user_watchlists_user_id"), table_name="user_watchlists")
    op.drop_table("user_watchlists")
