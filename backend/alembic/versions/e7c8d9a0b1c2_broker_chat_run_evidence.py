"""broker chat run evidence json

Revision ID: e7c8d9a0b1c2
Revises: a1b2c3d4e5f6
Create Date: 2026-08-31 15:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e7c8d9a0b1c2"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    if "evidence_json" not in _column_names("broker_chat_runs"):
        op.add_column(
            "broker_chat_runs",
            sa.Column("evidence_json", sa.Text(), nullable=False, server_default="{}"),
        )


def downgrade() -> None:
    if "evidence_json" in _column_names("broker_chat_runs"):
        op.drop_column("broker_chat_runs", "evidence_json")
