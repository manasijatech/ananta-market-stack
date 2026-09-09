"""broker chat agent retry preferences

Revision ID: d4e8a1c7b902
Revises: c8d2f1a6b047
Create Date: 2026-08-31 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e8a1c7b902"
down_revision: Union[str, None] = "c8d2f1a6b047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _column_names(table_name: str) -> set[str]:
    if table_name not in _inspector().get_table_names():
        return set()
    return {column["name"] for column in _inspector().get_columns(table_name)}


def upgrade() -> None:
    if "retry_json" not in _column_names("user_broker_chat_preferences"):
        op.add_column(
            "user_broker_chat_preferences",
            sa.Column("retry_json", sa.Text(), nullable=False, server_default="{}"),
        )


def downgrade() -> None:
    if "retry_json" in _column_names("user_broker_chat_preferences"):
        op.drop_column("user_broker_chat_preferences", "retry_json")
