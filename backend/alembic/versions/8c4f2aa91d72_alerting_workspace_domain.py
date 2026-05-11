"""alerting workspace domain

Revision ID: 8c4f2aa91d72
Revises: 3b1f6d7c9a2e
Create Date: 2026-05-11 18:45:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "8c4f2aa91d72"
down_revision: Union[str, None] = "3b1f6d7c9a2e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "alert_workflow_templates",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=64), nullable=False, server_default="general"),
        sa.Column("workflow_dsl_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("graph_dsl_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alert_workflow_templates_slug", "alert_workflow_templates", ["slug"], unique=True)

    op.create_table(
        "alert_workflows",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("template_id", sa.String(length=36), nullable=True),
        sa.Column("account_id", sa.String(length=36), nullable=True),
        sa.Column("broker_code", sa.String(length=32), nullable=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("symbol", sa.String(length=128), nullable=True),
        sa.Column("exchange", sa.String(length=32), nullable=True),
        sa.Column("instrument_ref_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("workflow_dsl_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("graph_dsl_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("editor_mode", sa.String(length=32), nullable=False, server_default="rule"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("channel_override_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("last_triggered_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["broker_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["template_id"], ["alert_workflow_templates.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_alert_workflows_user_id", ["user_id"]),
        ("ix_alert_workflows_template_id", ["template_id"]),
        ("ix_alert_workflows_account_id", ["account_id"]),
        ("ix_alert_workflows_broker_code", ["broker_code"]),
        ("ix_alert_workflows_symbol", ["symbol"]),
        ("ix_alert_workflows_status", ["status"]),
    ):
        op.create_index(name, "alert_workflows", columns)

    op.create_table(
        "user_alert_notifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("workflow_id", sa.String(length=36), nullable=True),
        sa.Column("template_id", sa.String(length=36), nullable=True),
        sa.Column("account_id", sa.String(length=36), nullable=True),
        sa.Column("broker_code", sa.String(length=32), nullable=True),
        sa.Column("symbol", sa.String(length=128), nullable=True),
        sa.Column("exchange", sa.String(length=32), nullable=True),
        sa.Column("level", sa.String(length=16), nullable=False, server_default="info"),
        sa.Column("title", sa.String(length=256), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="new"),
        sa.Column("channels_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("dedupe_key", sa.String(length=256), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["broker_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["template_id"], ["alert_workflow_templates.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_id"], ["alert_workflows.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_user_alert_notifications_user_id", ["user_id"]),
        ("ix_user_alert_notifications_workflow_id", ["workflow_id"]),
        ("ix_user_alert_notifications_template_id", ["template_id"]),
        ("ix_user_alert_notifications_account_id", ["account_id"]),
        ("ix_user_alert_notifications_broker_code", ["broker_code"]),
        ("ix_user_alert_notifications_symbol", ["symbol"]),
        ("ix_user_alert_notifications_status", ["status"]),
        ("ix_user_alert_notifications_dedupe_key", ["dedupe_key"]),
        ("ix_user_alert_notifications_is_read", ["is_read"]),
        ("ix_user_alert_notifications_created_at", ["created_at"]),
    ):
        op.create_index(name, "user_alert_notifications", columns)

    op.create_table(
        "alert_workflow_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workflow_id", sa.String(length=36), nullable=False),
        sa.Column("notification_id", sa.String(length=36), nullable=True),
        sa.Column("matched", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("rendered_title", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("rendered_message", sa.Text(), nullable=False, server_default=""),
        sa.Column("channels_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("tick_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("evaluation_payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["notification_id"], ["user_alert_notifications.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workflow_id"], ["alert_workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_alert_workflow_runs_workflow_id", ["workflow_id"]),
        ("ix_alert_workflow_runs_notification_id", ["notification_id"]),
        ("ix_alert_workflow_runs_matched", ["matched"]),
        ("ix_alert_workflow_runs_created_at", ["created_at"]),
    ):
        op.create_index(name, "alert_workflow_runs", columns)

    op.create_table(
        "live_symbol_subscriptions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("workflow_id", sa.String(length=36), nullable=True),
        sa.Column("account_id", sa.String(length=36), nullable=True),
        sa.Column("broker_code", sa.String(length=32), nullable=True),
        sa.Column("symbol", sa.String(length=128), nullable=False),
        sa.Column("exchange", sa.String(length=32), nullable=True),
        sa.Column("instrument_ref_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("source_kind", sa.String(length=32), nullable=False, server_default="manual"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("last_quote_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("last_received_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["broker_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workflow_id"], ["alert_workflows.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_live_symbol_subscriptions_user_id", ["user_id"]),
        ("ix_live_symbol_subscriptions_workflow_id", ["workflow_id"]),
        ("ix_live_symbol_subscriptions_account_id", ["account_id"]),
        ("ix_live_symbol_subscriptions_broker_code", ["broker_code"]),
        ("ix_live_symbol_subscriptions_symbol", ["symbol"]),
        ("ix_live_symbol_subscriptions_status", ["status"]),
    ):
        op.create_index(name, "live_symbol_subscriptions", columns)

    op.create_table(
        "user_alert_channels",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("channel_type", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("config_cipher", sa.Text(), nullable=False, server_default=""),
        sa.Column("last_tested_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_alert_channels_user_id", "user_alert_channels", ["user_id"])
    op.create_index("ix_user_alert_channels_channel_type", "user_alert_channels", ["channel_type"])

    op.create_table(
        "user_alert_channel_deliveries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("notification_id", sa.String(length=36), nullable=False),
        sa.Column("channel_id", sa.String(length=36), nullable=True),
        sa.Column("channel_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("delivered_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["channel_id"], ["user_alert_channels.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["notification_id"], ["user_alert_notifications.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_user_alert_channel_deliveries_notification_id", ["notification_id"]),
        ("ix_user_alert_channel_deliveries_channel_id", ["channel_id"]),
        ("ix_user_alert_channel_deliveries_channel_type", ["channel_type"]),
        ("ix_user_alert_channel_deliveries_status", ["status"]),
        ("ix_user_alert_channel_deliveries_created_at", ["created_at"]),
    ):
        op.create_index(name, "user_alert_channel_deliveries", columns)


def downgrade() -> None:
    for name in (
        "ix_user_alert_channel_deliveries_created_at",
        "ix_user_alert_channel_deliveries_status",
        "ix_user_alert_channel_deliveries_channel_type",
        "ix_user_alert_channel_deliveries_channel_id",
        "ix_user_alert_channel_deliveries_notification_id",
    ):
        op.drop_index(name, table_name="user_alert_channel_deliveries")
    op.drop_table("user_alert_channel_deliveries")

    for name in (
        "ix_user_alert_channels_channel_type",
        "ix_user_alert_channels_user_id",
    ):
        op.drop_index(name, table_name="user_alert_channels")
    op.drop_table("user_alert_channels")

    for name in (
        "ix_live_symbol_subscriptions_status",
        "ix_live_symbol_subscriptions_symbol",
        "ix_live_symbol_subscriptions_broker_code",
        "ix_live_symbol_subscriptions_account_id",
        "ix_live_symbol_subscriptions_workflow_id",
        "ix_live_symbol_subscriptions_user_id",
    ):
        op.drop_index(name, table_name="live_symbol_subscriptions")
    op.drop_table("live_symbol_subscriptions")

    for name in (
        "ix_alert_workflow_runs_created_at",
        "ix_alert_workflow_runs_matched",
        "ix_alert_workflow_runs_notification_id",
        "ix_alert_workflow_runs_workflow_id",
    ):
        op.drop_index(name, table_name="alert_workflow_runs")
    op.drop_table("alert_workflow_runs")

    for name in (
        "ix_user_alert_notifications_created_at",
        "ix_user_alert_notifications_is_read",
        "ix_user_alert_notifications_dedupe_key",
        "ix_user_alert_notifications_status",
        "ix_user_alert_notifications_symbol",
        "ix_user_alert_notifications_broker_code",
        "ix_user_alert_notifications_account_id",
        "ix_user_alert_notifications_template_id",
        "ix_user_alert_notifications_workflow_id",
        "ix_user_alert_notifications_user_id",
    ):
        op.drop_index(name, table_name="user_alert_notifications")
    op.drop_table("user_alert_notifications")

    for name in (
        "ix_alert_workflows_status",
        "ix_alert_workflows_symbol",
        "ix_alert_workflows_broker_code",
        "ix_alert_workflows_account_id",
        "ix_alert_workflows_template_id",
        "ix_alert_workflows_user_id",
    ):
        op.drop_index(name, table_name="alert_workflows")
    op.drop_table("alert_workflows")

    op.drop_index("ix_alert_workflow_templates_slug", table_name="alert_workflow_templates")
    op.drop_table("alert_workflow_templates")
