"""Plan 06: session compaction columns + FTS note (FTS created at runtime).

Revision ID: g7h8i9j0k1l2
Revises: e7c8d9a0b1c2
Create Date: 2026-09-03 13:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "g7h8i9j0k1l2"
down_revision: Union[str, None] = "e7c8d9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    cols = _column_names("broker_chat_sessions")
    if "compaction_summary_text" not in cols:
        op.add_column("broker_chat_sessions", sa.Column("compaction_summary_text", sa.Text(), nullable=True))
    if "compaction_summary_json" not in cols:
        op.add_column(
            "broker_chat_sessions",
            sa.Column("compaction_summary_json", sa.Text(), nullable=False, server_default="{}"),
        )
    if "compaction_first_kept_run_id" not in cols:
        op.add_column(
            "broker_chat_sessions",
            sa.Column("compaction_first_kept_run_id", sa.String(length=36), nullable=True),
        )
    if "compaction_model_id" not in cols:
        op.add_column(
            "broker_chat_sessions",
            sa.Column("compaction_model_id", sa.String(length=256), nullable=False, server_default=""),
        )
    if "compaction_chars_in" not in cols:
        op.add_column(
            "broker_chat_sessions",
            sa.Column("compaction_chars_in", sa.Integer(), nullable=False, server_default="0"),
        )
    if "compaction_chars_out" not in cols:
        op.add_column(
            "broker_chat_sessions",
            sa.Column("compaction_chars_out", sa.Integer(), nullable=False, server_default="0"),
        )
    if "compaction_updated_at" not in cols:
        op.add_column("broker_chat_sessions", sa.Column("compaction_updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    cols = _column_names("broker_chat_sessions")
    for name in (
        "compaction_updated_at",
        "compaction_chars_out",
        "compaction_chars_in",
        "compaction_model_id",
        "compaction_first_kept_run_id",
        "compaction_summary_json",
        "compaction_summary_text",
    ):
        if name in cols:
            op.drop_column("broker_chat_sessions", name)
