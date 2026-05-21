"""broker chat

Revision ID: 7c2b4e8f9a31
Revises: f3b6a2d1c9e8
Create Date: 2026-05-20 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "7c2b4e8f9a31"
down_revision: Union[str, None] = "f3b6a2d1c9e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_broker_chat_preferences",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("default_provider", sa.String(length=32), nullable=True),
        sa.Column("default_model", sa.String(length=256), nullable=True),
        sa.Column("event_visibility", sa.String(length=32), nullable=False, server_default="minimal"),
        sa.Column("include_tool_outputs", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("include_reasoning", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    op.create_table(
        "broker_chat_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=256), nullable=False, server_default="Broker chat"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_broker_chat_sessions_user_id", "broker_chat_sessions", ["user_id"])
    op.create_index("ix_broker_chat_sessions_created_at", "broker_chat_sessions", ["created_at"])
    op.create_index("ix_broker_chat_sessions_updated_at", "broker_chat_sessions", ["updated_at"])

    op.create_table(
        "broker_chat_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("job_id", sa.String(length=128), nullable=True),
        sa.Column("provider", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("model_id", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("event_visibility", sa.String(length=32), nullable=False, server_default="minimal"),
        sa.Column("include_tool_outputs", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("include_reasoning", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("queued_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["broker_chat_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_broker_chat_runs_session_id", ["session_id"]),
        ("ix_broker_chat_runs_user_id", ["user_id"]),
        ("ix_broker_chat_runs_status", ["status"]),
        ("ix_broker_chat_runs_job_id", ["job_id"]),
        ("ix_broker_chat_runs_queued_at", ["queued_at"]),
        ("ix_broker_chat_runs_started_at", ["started_at"]),
        ("ix_broker_chat_runs_completed_at", ["completed_at"]),
        ("ix_broker_chat_runs_created_at", ["created_at"]),
        ("ix_broker_chat_runs_updated_at", ["updated_at"]),
    ):
        op.create_index(name, "broker_chat_runs", columns)

    op.create_table(
        "broker_chat_events",
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
        sa.ForeignKeyConstraint(["run_id"], ["broker_chat_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["broker_chat_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_broker_chat_events_run_id", ["run_id"]),
        ("ix_broker_chat_events_session_id", ["session_id"]),
        ("ix_broker_chat_events_user_id", ["user_id"]),
        ("ix_broker_chat_events_sequence", ["sequence"]),
        ("ix_broker_chat_events_event_type", ["event_type"]),
        ("ix_broker_chat_events_created_at", ["created_at"]),
    ):
        op.create_index(name, "broker_chat_events", columns)


def downgrade() -> None:
    for name in (
        "ix_broker_chat_events_created_at",
        "ix_broker_chat_events_event_type",
        "ix_broker_chat_events_sequence",
        "ix_broker_chat_events_user_id",
        "ix_broker_chat_events_session_id",
        "ix_broker_chat_events_run_id",
    ):
        op.drop_index(name, table_name="broker_chat_events")
    op.drop_table("broker_chat_events")

    for name in (
        "ix_broker_chat_runs_updated_at",
        "ix_broker_chat_runs_created_at",
        "ix_broker_chat_runs_completed_at",
        "ix_broker_chat_runs_started_at",
        "ix_broker_chat_runs_queued_at",
        "ix_broker_chat_runs_job_id",
        "ix_broker_chat_runs_status",
        "ix_broker_chat_runs_user_id",
        "ix_broker_chat_runs_session_id",
    ):
        op.drop_index(name, table_name="broker_chat_runs")
    op.drop_table("broker_chat_runs")

    for name in (
        "ix_broker_chat_sessions_updated_at",
        "ix_broker_chat_sessions_created_at",
        "ix_broker_chat_sessions_user_id",
    ):
        op.drop_index(name, table_name="broker_chat_sessions")
    op.drop_table("broker_chat_sessions")
    op.drop_table("user_broker_chat_preferences")
