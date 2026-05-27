"""alert workflow chat

Revision ID: d7a4f23c9e81
Revises: c4e9a7b2d1f6
Create Date: 2026-05-27 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d7a4f23c9e81"
down_revision: Union[str, None] = "c4e9a7b2d1f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _create_indexes(table_name: str, indexes: tuple[tuple[str, list[str]], ...]) -> None:
    for name, columns in indexes:
        op.create_index(name, table_name, columns)


def _drop_indexes(table_name: str, names: tuple[str, ...]) -> None:
    for name in names:
        op.drop_index(name, table_name=table_name)


def upgrade() -> None:
    op.create_table(
        "user_alert_workflow_chat_preferences",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("default_provider", sa.String(length=32), nullable=True),
        sa.Column("default_model", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "alert_workflow_chat_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("workflow_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=256), nullable=False, server_default="Workflow AI chat"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("active_snapshot_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_id"], ["alert_workflows.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_indexes(
        "alert_workflow_chat_sessions",
        (
            ("ix_alert_workflow_chat_sessions_user_id", ["user_id"]),
            ("ix_alert_workflow_chat_sessions_workflow_id", ["workflow_id"]),
            ("ix_alert_workflow_chat_sessions_status", ["status"]),
            ("ix_alert_workflow_chat_sessions_active_snapshot_id", ["active_snapshot_id"]),
            ("ix_alert_workflow_chat_sessions_created_at", ["created_at"]),
            ("ix_alert_workflow_chat_sessions_updated_at", ["updated_at"]),
        ),
    )

    op.create_table(
        "alert_workflow_chat_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("workflow_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("job_id", sa.String(length=128), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("model_id", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("queued_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["alert_workflow_chat_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_id"], ["alert_workflows.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_indexes(
        "alert_workflow_chat_runs",
        (
            ("ix_alert_workflow_chat_runs_session_id", ["session_id"]),
            ("ix_alert_workflow_chat_runs_user_id", ["user_id"]),
            ("ix_alert_workflow_chat_runs_workflow_id", ["workflow_id"]),
            ("ix_alert_workflow_chat_runs_status", ["status"]),
            ("ix_alert_workflow_chat_runs_job_id", ["job_id"]),
            ("ix_alert_workflow_chat_runs_queued_at", ["queued_at"]),
            ("ix_alert_workflow_chat_runs_started_at", ["started_at"]),
            ("ix_alert_workflow_chat_runs_completed_at", ["completed_at"]),
            ("ix_alert_workflow_chat_runs_created_at", ["created_at"]),
            ("ix_alert_workflow_chat_runs_updated_at", ["updated_at"]),
        ),
    )

    op.create_table(
        "alert_workflow_chat_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("public_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("full_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("redis_stream_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["alert_workflow_chat_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["alert_workflow_chat_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_indexes(
        "alert_workflow_chat_events",
        (
            ("ix_alert_workflow_chat_events_run_id", ["run_id"]),
            ("ix_alert_workflow_chat_events_session_id", ["session_id"]),
            ("ix_alert_workflow_chat_events_user_id", ["user_id"]),
            ("ix_alert_workflow_chat_events_sequence", ["sequence"]),
            ("ix_alert_workflow_chat_events_event_type", ["event_type"]),
            ("ix_alert_workflow_chat_events_created_at", ["created_at"]),
        ),
    )

    op.create_table(
        "alert_workflow_chat_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("workflow_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("label", sa.String(length=256), nullable=False, server_default="Workflow snapshot"),
        sa.Column("workflow_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("validation_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("compile_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("explanation_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("samples_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("diff_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("valid", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["alert_workflow_chat_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["alert_workflow_chat_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workflow_id"], ["alert_workflows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_indexes(
        "alert_workflow_chat_snapshots",
        (
            ("ix_alert_workflow_chat_snapshots_session_id", ["session_id"]),
            ("ix_alert_workflow_chat_snapshots_run_id", ["run_id"]),
            ("ix_alert_workflow_chat_snapshots_workflow_id", ["workflow_id"]),
            ("ix_alert_workflow_chat_snapshots_user_id", ["user_id"]),
            ("ix_alert_workflow_chat_snapshots_version", ["version"]),
            ("ix_alert_workflow_chat_snapshots_valid", ["valid"]),
            ("ix_alert_workflow_chat_snapshots_applied_at", ["applied_at"]),
            ("ix_alert_workflow_chat_snapshots_created_at", ["created_at"]),
        ),
    )


def downgrade() -> None:
    _drop_indexes(
        "alert_workflow_chat_snapshots",
        (
            "ix_alert_workflow_chat_snapshots_created_at",
            "ix_alert_workflow_chat_snapshots_applied_at",
            "ix_alert_workflow_chat_snapshots_valid",
            "ix_alert_workflow_chat_snapshots_version",
            "ix_alert_workflow_chat_snapshots_user_id",
            "ix_alert_workflow_chat_snapshots_workflow_id",
            "ix_alert_workflow_chat_snapshots_run_id",
            "ix_alert_workflow_chat_snapshots_session_id",
        ),
    )
    op.drop_table("alert_workflow_chat_snapshots")

    _drop_indexes(
        "alert_workflow_chat_events",
        (
            "ix_alert_workflow_chat_events_created_at",
            "ix_alert_workflow_chat_events_event_type",
            "ix_alert_workflow_chat_events_sequence",
            "ix_alert_workflow_chat_events_user_id",
            "ix_alert_workflow_chat_events_session_id",
            "ix_alert_workflow_chat_events_run_id",
        ),
    )
    op.drop_table("alert_workflow_chat_events")

    _drop_indexes(
        "alert_workflow_chat_runs",
        (
            "ix_alert_workflow_chat_runs_updated_at",
            "ix_alert_workflow_chat_runs_created_at",
            "ix_alert_workflow_chat_runs_completed_at",
            "ix_alert_workflow_chat_runs_started_at",
            "ix_alert_workflow_chat_runs_queued_at",
            "ix_alert_workflow_chat_runs_job_id",
            "ix_alert_workflow_chat_runs_status",
            "ix_alert_workflow_chat_runs_workflow_id",
            "ix_alert_workflow_chat_runs_user_id",
            "ix_alert_workflow_chat_runs_session_id",
        ),
    )
    op.drop_table("alert_workflow_chat_runs")

    _drop_indexes(
        "alert_workflow_chat_sessions",
        (
            "ix_alert_workflow_chat_sessions_updated_at",
            "ix_alert_workflow_chat_sessions_created_at",
            "ix_alert_workflow_chat_sessions_active_snapshot_id",
            "ix_alert_workflow_chat_sessions_status",
            "ix_alert_workflow_chat_sessions_workflow_id",
            "ix_alert_workflow_chat_sessions_user_id",
        ),
    )
    op.drop_table("alert_workflow_chat_sessions")
    op.drop_table("user_alert_workflow_chat_preferences")
