"""llm telemetry cost tracking

Revision ID: e2b8f4c9a1d3
Revises: f1a8c3d2e9b4
Create Date: 2026-07-02 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2b8f4c9a1d3"
down_revision: Union[str, None] = "f1a8c3d2e9b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table_name in ("llm_usage_events", "llm_usage_daily_snapshots"):
        op.add_column(table_name, sa.Column("trace_id", sa.String(length=64), nullable=True))
        op.add_column(table_name, sa.Column("span_id", sa.String(length=32), nullable=True))
        op.add_column(table_name, sa.Column("source_kind", sa.String(length=64), nullable=True))
        op.add_column(table_name, sa.Column("source_id", sa.String(length=64), nullable=True))
        op.add_column(table_name, sa.Column("session_id", sa.String(length=64), nullable=True))
        op.add_column(table_name, sa.Column("workflow_run_id", sa.String(length=64), nullable=True))
        op.add_column(table_name, sa.Column("request_index", sa.Integer(), nullable=True))
        op.add_column(table_name, sa.Column("estimated_cost_usd", sa.Float(), nullable=True))
        op.add_column(table_name, sa.Column("display_cost_usd", sa.Float(), nullable=True))
        op.add_column(table_name, sa.Column("cost_source", sa.String(length=32), nullable=False, server_default="unpriced"))
        op.create_index(f"ix_{table_name}_trace_id", table_name, ["trace_id"], unique=False)
        op.create_index(f"ix_{table_name}_source_kind", table_name, ["source_kind"], unique=False)
        op.create_index(f"ix_{table_name}_source_id", table_name, ["source_id"], unique=False)
        op.create_index(f"ix_{table_name}_session_id", table_name, ["session_id"], unique=False)
        op.create_index(f"ix_{table_name}_workflow_run_id", table_name, ["workflow_run_id"], unique=False)
        op.create_index(f"ix_{table_name}_cost_source", table_name, ["cost_source"], unique=False)

    op.add_column(
        "llm_usage_daily_snapshots",
        sa.Column("estimated_cost_total_usd", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "llm_usage_daily_snapshots",
        sa.Column("display_cost_total_usd", sa.Float(), nullable=False, server_default="0"),
    )
    op.add_column(
        "llm_usage_daily_snapshots",
        sa.Column("estimated_cost_request_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "llm_usage_daily_snapshots",
        sa.Column("display_cost_request_count", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "llm_model_pricing",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model_id", sa.String(length=256), nullable=False),
        sa.Column("input_cost_per_1m_tokens", sa.Float(), nullable=True),
        sa.Column("output_cost_per_1m_tokens", sa.Float(), nullable=True),
        sa.Column("cached_input_cost_per_1m_tokens", sa.Float(), nullable=True),
        sa.Column("cache_write_cost_per_1m_tokens", sa.Float(), nullable=True),
        sa.Column("reasoning_cost_per_1m_tokens", sa.Float(), nullable=True),
        sa.Column("input_audio_cost_per_1m_tokens", sa.Float(), nullable=True),
        sa.Column("output_audio_cost_per_1m_tokens", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=False, server_default="manual"),
        sa.Column("source_url", sa.String(length=512), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("effective_from", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "provider", "model_id", name="uq_llm_model_pricing_user_provider_model"),
    )
    for name, columns in (
        ("ix_llm_model_pricing_user_id", ["user_id"]),
        ("ix_llm_model_pricing_provider", ["provider"]),
        ("ix_llm_model_pricing_model_id", ["model_id"]),
        ("ix_llm_model_pricing_source", ["source"]),
    ):
        op.create_index(name, "llm_model_pricing", columns, unique=False)


def downgrade() -> None:
    for name in (
        "ix_llm_model_pricing_source",
        "ix_llm_model_pricing_model_id",
        "ix_llm_model_pricing_provider",
        "ix_llm_model_pricing_user_id",
    ):
        op.drop_index(name, table_name="llm_model_pricing")
    op.drop_table("llm_model_pricing")

    for column_name in (
        "display_cost_request_count",
        "estimated_cost_request_count",
        "display_cost_total_usd",
        "estimated_cost_total_usd",
    ):
        op.drop_column("llm_usage_daily_snapshots", column_name)

    for table_name in ("llm_usage_daily_snapshots", "llm_usage_events"):
        for name in (
            f"ix_{table_name}_cost_source",
            f"ix_{table_name}_workflow_run_id",
            f"ix_{table_name}_session_id",
            f"ix_{table_name}_source_id",
            f"ix_{table_name}_source_kind",
            f"ix_{table_name}_trace_id",
        ):
            op.drop_index(name, table_name=table_name)
        for column_name in (
            "cost_source",
            "display_cost_usd",
            "estimated_cost_usd",
            "request_index",
            "workflow_run_id",
            "session_id",
            "source_id",
            "source_kind",
            "span_id",
            "trace_id",
        ):
            op.drop_column(table_name, column_name)
