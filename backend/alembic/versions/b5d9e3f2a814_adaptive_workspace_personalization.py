"""adaptive workspace named desks and preferences

Revision ID: b5d9e3f2a814
Revises: a4c8d2e1f703
Create Date: 2026-08-19 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b5d9e3f2a814"
down_revision: Union[str, None] = "a4c8d2e1f703"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "adaptive_workspace_saved_desks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("workspace_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_adaptive_workspace_saved_desks_user_name"),
    )
    op.create_index("ix_adaptive_workspace_saved_desks_user_id", "adaptive_workspace_saved_desks", ["user_id"])
    op.create_index("ix_adaptive_workspace_saved_desks_name", "adaptive_workspace_saved_desks", ["name"])
    op.create_index("ix_adaptive_workspace_saved_desks_created_at", "adaptive_workspace_saved_desks", ["created_at"])
    op.create_index("ix_adaptive_workspace_saved_desks_updated_at", "adaptive_workspace_saved_desks", ["updated_at"])

    op.create_table(
        "adaptive_workspace_preferences",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("pref_key", sa.String(length=64), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=False, server_default="null"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "pref_key", name="uq_adaptive_workspace_preferences_user_key"),
    )
    op.create_index("ix_adaptive_workspace_preferences_user_id", "adaptive_workspace_preferences", ["user_id"])
    op.create_index("ix_adaptive_workspace_preferences_pref_key", "adaptive_workspace_preferences", ["pref_key"])
    op.create_index("ix_adaptive_workspace_preferences_updated_at", "adaptive_workspace_preferences", ["updated_at"])


def downgrade() -> None:
    op.drop_index("ix_adaptive_workspace_preferences_updated_at", table_name="adaptive_workspace_preferences")
    op.drop_index("ix_adaptive_workspace_preferences_pref_key", table_name="adaptive_workspace_preferences")
    op.drop_index("ix_adaptive_workspace_preferences_user_id", table_name="adaptive_workspace_preferences")
    op.drop_table("adaptive_workspace_preferences")
    op.drop_index("ix_adaptive_workspace_saved_desks_updated_at", table_name="adaptive_workspace_saved_desks")
    op.drop_index("ix_adaptive_workspace_saved_desks_created_at", table_name="adaptive_workspace_saved_desks")
    op.drop_index("ix_adaptive_workspace_saved_desks_name", table_name="adaptive_workspace_saved_desks")
    op.drop_index("ix_adaptive_workspace_saved_desks_user_id", table_name="adaptive_workspace_saved_desks")
    op.drop_table("adaptive_workspace_saved_desks")
