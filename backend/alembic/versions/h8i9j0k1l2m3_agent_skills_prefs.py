"""Plan 07: agent skill prefs + session agent_instructions.

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-09-04 11:50:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "h8i9j0k1l2m3"
down_revision: Union[str, None] = "g7h8i9j0k1l2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    cols = _column_names("broker_chat_sessions")
    if "agent_instructions" not in cols:
        op.add_column(
            "broker_chat_sessions",
            sa.Column("agent_instructions", sa.Text(), nullable=False, server_default=""),
        )
    if "agent_skill_prefs" not in _table_names():
        op.create_table(
            "agent_skill_prefs",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("skill_id", sa.String(length=128), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column("markdown", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("user_id", "skill_id", name="uq_agent_skill_prefs_user_skill"),
        )
        op.create_index("ix_agent_skill_prefs_user_id", "agent_skill_prefs", ["user_id"])
        op.create_index("ix_agent_skill_prefs_skill_id", "agent_skill_prefs", ["skill_id"])


def downgrade() -> None:
    if "agent_skill_prefs" in _table_names():
        op.drop_table("agent_skill_prefs")
    cols = _column_names("broker_chat_sessions")
    if "agent_instructions" in cols:
        op.drop_column("broker_chat_sessions", "agent_instructions")
