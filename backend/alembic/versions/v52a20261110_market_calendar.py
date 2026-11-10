"""market calendar snapshots

Revision ID: v52a20261110
Revises: o5p6q7r8s9t0
Create Date: 2026-11-10 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "v52a20261110"
down_revision: Union[str, None] = "o5p6q7r8s9t0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "market_calendar_snapshots"
SCOPE_INDEX = "ix_market_calendar_scope"


def _inspector():
    return sa.inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _index_names(table_name: str) -> set[str]:
    if not _table_exists(table_name):
        return set()
    return {index["name"] for index in _inspector().get_indexes(table_name)}


def upgrade() -> None:
    if not _table_exists(TABLE):
        op.create_table(
            TABLE,
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("exchange", sa.String(length=16), nullable=False),
            sa.Column("segment", sa.String(length=32), nullable=False),
            sa.Column("list_kind", sa.String(length=16), nullable=False),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("holidays_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("source_url", sa.Text(), nullable=False, server_default=""),
            sa.Column("provenance_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("fetched_at", sa.DateTime(), nullable=False),
            sa.Column("accepted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("rejection_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index(f"ix_{TABLE}_fetched_at", TABLE, ["fetched_at"])
        op.create_index(f"ix_{TABLE}_accepted", TABLE, ["accepted"])
    if SCOPE_INDEX not in _index_names(TABLE):
        op.create_index(
            SCOPE_INDEX,
            TABLE,
            ["exchange", "segment", "list_kind", "year", "accepted", "fetched_at"],
        )


def downgrade() -> None:
    if _table_exists(TABLE):
        op.drop_table(TABLE)
