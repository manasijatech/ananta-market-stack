"""alerts v2 runtime metadata

Revision ID: a21d4c7f9b30
Revises: c7a9d2e4b681
Create Date: 2026-05-14 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a21d4c7f9b30"
down_revision: Union[str, None] = "c7a9d2e4b681"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("alert_workflows", sa.Column("deployment_status", sa.String(length=32), nullable=False, server_default="draft"))
    op.add_column("alert_workflows", sa.Column("deploy_version", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("alert_workflows", sa.Column("compiled_summary_json", sa.Text(), nullable=False, server_default="{}"))
    op.add_column("alert_workflows", sa.Column("last_validated_at", sa.DateTime(), nullable=True))
    op.add_column("alert_workflows", sa.Column("last_compiled_at", sa.DateTime(), nullable=True))
    op.add_column("alert_workflows", sa.Column("last_runtime_error", sa.Text(), nullable=True))
    op.create_index("ix_alert_workflows_deployment_status", "alert_workflows", ["deployment_status"])

    op.add_column("live_symbol_subscriptions", sa.Column("source_type", sa.String(length=64), nullable=True))
    op.add_column("live_symbol_subscriptions", sa.Column("source_id", sa.String(length=64), nullable=True))
    op.add_column("live_symbol_subscriptions", sa.Column("source_label", sa.String(length=128), nullable=True))
    op.add_column("live_symbol_subscriptions", sa.Column("owner_kind", sa.String(length=32), nullable=True))
    op.add_column("live_symbol_subscriptions", sa.Column("owner_id", sa.String(length=64), nullable=True))
    op.add_column("live_symbol_subscriptions", sa.Column("reconciled_at", sa.DateTime(), nullable=True))
    op.add_column("live_symbol_subscriptions", sa.Column("health_status", sa.String(length=32), nullable=False, server_default="unknown"))
    op.add_column("live_symbol_subscriptions", sa.Column("health_reason", sa.Text(), nullable=False, server_default=""))
    for name, columns in (
        ("ix_live_symbol_subscriptions_source_type", ["source_type"]),
        ("ix_live_symbol_subscriptions_source_id", ["source_id"]),
        ("ix_live_symbol_subscriptions_owner_kind", ["owner_kind"]),
        ("ix_live_symbol_subscriptions_owner_id", ["owner_id"]),
        ("ix_live_symbol_subscriptions_reconciled_at", ["reconciled_at"]),
        ("ix_live_symbol_subscriptions_health_status", ["health_status"]),
    ):
        op.create_index(name, "live_symbol_subscriptions", columns)


def downgrade() -> None:
    for name in (
        "ix_live_symbol_subscriptions_health_status",
        "ix_live_symbol_subscriptions_reconciled_at",
        "ix_live_symbol_subscriptions_owner_id",
        "ix_live_symbol_subscriptions_owner_kind",
        "ix_live_symbol_subscriptions_source_id",
        "ix_live_symbol_subscriptions_source_type",
    ):
        op.drop_index(name, table_name="live_symbol_subscriptions")
    for column in (
        "health_reason",
        "health_status",
        "reconciled_at",
        "owner_id",
        "owner_kind",
        "source_label",
        "source_id",
        "source_type",
    ):
        op.drop_column("live_symbol_subscriptions", column)

    op.drop_index("ix_alert_workflows_deployment_status", table_name="alert_workflows")
    for column in (
        "last_runtime_error",
        "last_compiled_at",
        "last_validated_at",
        "compiled_summary_json",
        "deploy_version",
        "deployment_status",
    ):
        op.drop_column("alert_workflows", column)
