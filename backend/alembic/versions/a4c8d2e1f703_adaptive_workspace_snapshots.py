"""adaptive workspace snapshots

Revision ID: a4c8d2e1f703
Revises: e5a1b7c3d902
Create Date: 2026-08-18 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a4c8d2e1f703"
down_revision: Union[str, None] = "e5a1b7c3d902"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "adaptive_workspace_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("label", sa.String(length=256), nullable=False, server_default="Workspace snapshot"),
        sa.Column("workspace_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("validation_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("valid", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["broker_chat_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "version", name="uq_adaptive_workspace_snapshots_session_version"),
    )
    op.create_index("ix_adaptive_workspace_snapshots_session_id", "adaptive_workspace_snapshots", ["session_id"])
    op.create_index("ix_adaptive_workspace_snapshots_user_id", "adaptive_workspace_snapshots", ["user_id"])
    op.create_index("ix_adaptive_workspace_snapshots_version", "adaptive_workspace_snapshots", ["version"])
    op.create_index("ix_adaptive_workspace_snapshots_valid", "adaptive_workspace_snapshots", ["valid"])
    op.create_index("ix_adaptive_workspace_snapshots_applied_at", "adaptive_workspace_snapshots", ["applied_at"])
    op.create_index("ix_adaptive_workspace_snapshots_created_at", "adaptive_workspace_snapshots", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_adaptive_workspace_snapshots_created_at", table_name="adaptive_workspace_snapshots")
    op.drop_index("ix_adaptive_workspace_snapshots_applied_at", table_name="adaptive_workspace_snapshots")
    op.drop_index("ix_adaptive_workspace_snapshots_valid", table_name="adaptive_workspace_snapshots")
    op.drop_index("ix_adaptive_workspace_snapshots_version", table_name="adaptive_workspace_snapshots")
    op.drop_index("ix_adaptive_workspace_snapshots_user_id", table_name="adaptive_workspace_snapshots")
    op.drop_index("ix_adaptive_workspace_snapshots_session_id", table_name="adaptive_workspace_snapshots")
    op.drop_table("adaptive_workspace_snapshots")
