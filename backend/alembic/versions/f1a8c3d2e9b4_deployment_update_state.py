"""deployment update state

Revision ID: f1a8c3d2e9b4
Revises: e4b7c2d9a8f1
Create Date: 2026-06-24 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a8c3d2e9b4"
down_revision: Union[str, None] = "e4b7c2d9a8f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_deployment_state",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("running_version", sa.String(length=64), nullable=True),
        sa.Column("running_sha", sa.String(length=64), nullable=True),
        sa.Column("running_digest", sa.String(length=128), nullable=True),
        sa.Column("latest_digest", sa.String(length=128), nullable=True),
        sa.Column("update_available", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True),
        sa.Column("last_check_error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_system_deployment_state_last_checked_at",
        "system_deployment_state",
        ["last_checked_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_system_deployment_state_last_checked_at", table_name="system_deployment_state")
    op.drop_table("system_deployment_state")
