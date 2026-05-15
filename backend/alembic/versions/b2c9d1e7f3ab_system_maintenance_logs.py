"""system maintenance logs

Revision ID: b2c9d1e7f3ab
Revises: 6d8b7f4a1c22
Create Date: 2026-05-15 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c9d1e7f3ab"
down_revision: Union[str, None] = "6d8b7f4a1c22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_maintenance_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_name", sa.String(length=64), nullable=False),
        sa.Column("trigger", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="running"),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("details_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("deleted_rows", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deleted_redis_keys", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rebuilt_redis_keys", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vacuum_performed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_system_maintenance_logs_task_name", "system_maintenance_logs", ["task_name"])
    op.create_index("ix_system_maintenance_logs_trigger", "system_maintenance_logs", ["trigger"])
    op.create_index("ix_system_maintenance_logs_status", "system_maintenance_logs", ["status"])
    op.create_index("ix_system_maintenance_logs_started_at", "system_maintenance_logs", ["started_at"])
    op.create_index("ix_system_maintenance_logs_finished_at", "system_maintenance_logs", ["finished_at"])


def downgrade() -> None:
    op.drop_index("ix_system_maintenance_logs_finished_at", table_name="system_maintenance_logs")
    op.drop_index("ix_system_maintenance_logs_started_at", table_name="system_maintenance_logs")
    op.drop_index("ix_system_maintenance_logs_status", table_name="system_maintenance_logs")
    op.drop_index("ix_system_maintenance_logs_trigger", table_name="system_maintenance_logs")
    op.drop_index("ix_system_maintenance_logs_task_name", table_name="system_maintenance_logs")
    op.drop_table("system_maintenance_logs")
