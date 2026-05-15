"""llm usage tracking

Revision ID: d91a3f7bc2e4
Revises: b2c9d1e7f3ab
Create Date: 2026-05-15 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d91a3f7bc2e4"
down_revision: Union[str, None] = "b2c9d1e7f3ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "llm_usage_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.String(length=256), nullable=False),
        sa.Column("api_surface", sa.String(length=64), nullable=False, server_default="chat_completions"),
        sa.Column("request_kind", sa.String(length=64), nullable=False, server_default="generic"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="success"),
        sa.Column("provider_response_id", sa.String(length=128), nullable=True),
        sa.Column("workflow_ref", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("workflow_id", sa.String(length=36), nullable=True),
        sa.Column("workflow_name", sa.String(length=128), nullable=True),
        sa.Column("workflow_status", sa.String(length=32), nullable=True),
        sa.Column("workflow_type", sa.String(length=32), nullable=True),
        sa.Column("template_id", sa.String(length=36), nullable=True),
        sa.Column("account_id", sa.String(length=36), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cached_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_write_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reasoning_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_audio_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_audio_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("image_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("video_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider_cost", sa.Float(), nullable=True),
        sa.Column("provider_cost_currency", sa.String(length=32), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("is_byok", sa.Boolean(), nullable=True),
        sa.Column("usage_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("cost_details_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_llm_usage_events_user_id", ["user_id"]),
        ("ix_llm_usage_events_provider", ["provider"]),
        ("ix_llm_usage_events_model_id", ["model_id"]),
        ("ix_llm_usage_events_api_surface", ["api_surface"]),
        ("ix_llm_usage_events_request_kind", ["request_kind"]),
        ("ix_llm_usage_events_status", ["status"]),
        ("ix_llm_usage_events_provider_response_id", ["provider_response_id"]),
        ("ix_llm_usage_events_workflow_ref", ["workflow_ref"]),
        ("ix_llm_usage_events_workflow_id", ["workflow_id"]),
        ("ix_llm_usage_events_workflow_status", ["workflow_status"]),
        ("ix_llm_usage_events_workflow_type", ["workflow_type"]),
        ("ix_llm_usage_events_template_id", ["template_id"]),
        ("ix_llm_usage_events_account_id", ["account_id"]),
        ("ix_llm_usage_events_started_at", ["started_at"]),
        ("ix_llm_usage_events_completed_at", ["completed_at"]),
        ("ix_llm_usage_events_created_at", ["created_at"]),
    ):
        op.create_index(name, "llm_usage_events", columns, unique=False)

    op.create_table(
        "llm_usage_daily_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("bucket_date", sa.Date(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.String(length=256), nullable=False),
        sa.Column("api_surface", sa.String(length=64), nullable=False, server_default="chat_completions"),
        sa.Column("request_kind", sa.String(length=64), nullable=False, server_default="generic"),
        sa.Column("workflow_ref", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("workflow_id", sa.String(length=36), nullable=True),
        sa.Column("workflow_name", sa.String(length=128), nullable=True),
        sa.Column("workflow_status", sa.String(length=32), nullable=True),
        sa.Column("workflow_type", sa.String(length=32), nullable=True),
        sa.Column("template_id", sa.String(length=36), nullable=True),
        sa.Column("account_id", sa.String(length=36), nullable=True),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cached_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_write_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reasoning_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_audio_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_audio_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("image_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("video_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider_cost_total", sa.Float(), nullable=False, server_default="0"),
        sa.Column("priced_request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_request_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "bucket_date",
            "provider",
            "model_id",
            "api_surface",
            "request_kind",
            "workflow_ref",
            name="uq_llm_usage_daily_snapshot_dimensions",
        ),
    )
    for name, columns in (
        ("ix_llm_usage_daily_snapshots_user_id", ["user_id"]),
        ("ix_llm_usage_daily_snapshots_bucket_date", ["bucket_date"]),
        ("ix_llm_usage_daily_snapshots_provider", ["provider"]),
        ("ix_llm_usage_daily_snapshots_model_id", ["model_id"]),
        ("ix_llm_usage_daily_snapshots_api_surface", ["api_surface"]),
        ("ix_llm_usage_daily_snapshots_request_kind", ["request_kind"]),
        ("ix_llm_usage_daily_snapshots_workflow_ref", ["workflow_ref"]),
        ("ix_llm_usage_daily_snapshots_workflow_id", ["workflow_id"]),
        ("ix_llm_usage_daily_snapshots_workflow_status", ["workflow_status"]),
        ("ix_llm_usage_daily_snapshots_workflow_type", ["workflow_type"]),
        ("ix_llm_usage_daily_snapshots_template_id", ["template_id"]),
        ("ix_llm_usage_daily_snapshots_account_id", ["account_id"]),
        ("ix_llm_usage_daily_snapshots_last_request_at", ["last_request_at"]),
    ):
        op.create_index(name, "llm_usage_daily_snapshots", columns, unique=False)


def downgrade() -> None:
    for name in (
        "ix_llm_usage_daily_snapshots_last_request_at",
        "ix_llm_usage_daily_snapshots_account_id",
        "ix_llm_usage_daily_snapshots_template_id",
        "ix_llm_usage_daily_snapshots_workflow_type",
        "ix_llm_usage_daily_snapshots_workflow_status",
        "ix_llm_usage_daily_snapshots_workflow_id",
        "ix_llm_usage_daily_snapshots_workflow_ref",
        "ix_llm_usage_daily_snapshots_request_kind",
        "ix_llm_usage_daily_snapshots_api_surface",
        "ix_llm_usage_daily_snapshots_model_id",
        "ix_llm_usage_daily_snapshots_provider",
        "ix_llm_usage_daily_snapshots_bucket_date",
        "ix_llm_usage_daily_snapshots_user_id",
    ):
        op.drop_index(name, table_name="llm_usage_daily_snapshots")
    op.drop_table("llm_usage_daily_snapshots")

    for name in (
        "ix_llm_usage_events_created_at",
        "ix_llm_usage_events_completed_at",
        "ix_llm_usage_events_started_at",
        "ix_llm_usage_events_account_id",
        "ix_llm_usage_events_template_id",
        "ix_llm_usage_events_workflow_type",
        "ix_llm_usage_events_workflow_status",
        "ix_llm_usage_events_workflow_id",
        "ix_llm_usage_events_workflow_ref",
        "ix_llm_usage_events_provider_response_id",
        "ix_llm_usage_events_status",
        "ix_llm_usage_events_request_kind",
        "ix_llm_usage_events_api_surface",
        "ix_llm_usage_events_model_id",
        "ix_llm_usage_events_provider",
        "ix_llm_usage_events_user_id",
    ):
        op.drop_index(name, table_name="llm_usage_events")
    op.drop_table("llm_usage_events")
