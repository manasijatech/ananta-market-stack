"""desktop audio alerts

Revision ID: b8d3c2a1f901
Revises: a9f3c7d1e2b4
Create Date: 2026-07-02 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8d3c2a1f901"
down_revision: Union[str, None] = "a9f3c7d1e2b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "desktop_audio_devices",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="active"),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True),
        sa.Column("last_ack_asset_id", sa.String(length=36), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_desktop_audio_devices_user_id", "desktop_audio_devices", ["user_id"])
    op.create_index("ix_desktop_audio_devices_token_hash", "desktop_audio_devices", ["token_hash"])
    op.create_index("ix_desktop_audio_devices_status", "desktop_audio_devices", ["status"])

    op.create_table(
        "desktop_audio_pairings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("secret_hash", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("completed_device_id", sa.String(length=36), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_desktop_audio_pairings_user_id", "desktop_audio_pairings", ["user_id"])
    op.create_index("ix_desktop_audio_pairings_secret_hash", "desktop_audio_pairings", ["secret_hash"])
    op.create_index("ix_desktop_audio_pairings_status", "desktop_audio_pairings", ["status"])
    op.create_index("ix_desktop_audio_pairings_expires_at", "desktop_audio_pairings", ["expires_at"])

    op.create_table(
        "alert_audio_assets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("notification_id", sa.String(length=36), nullable=False),
        sa.Column("delivery_id", sa.String(length=36), nullable=True),
        sa.Column("device_id", sa.String(length=36), nullable=True),
        sa.Column("generated_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("model_id", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("voice", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("response_format", sa.String(length=32), nullable=False, server_default="mp3"),
        sa.Column("file_path", sa.Text(), nullable=False, server_default=""),
        sa.Column("mime_type", sa.String(length=128), nullable=False, server_default="audio/mpeg"),
        sa.Column("byte_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["delivery_id"], ["user_alert_channel_deliveries.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["device_id"], ["desktop_audio_devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["notification_id"], ["user_alert_notifications.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_alert_audio_assets_user_id", ["user_id"]),
        ("ix_alert_audio_assets_notification_id", ["notification_id"]),
        ("ix_alert_audio_assets_delivery_id", ["delivery_id"]),
        ("ix_alert_audio_assets_device_id", ["device_id"]),
        ("ix_alert_audio_assets_status", ["status"]),
        ("ix_alert_audio_assets_created_at", ["created_at"]),
        ("ix_alert_audio_assets_expires_at", ["expires_at"]),
    ):
        op.create_index(name, "alert_audio_assets", columns)


def downgrade() -> None:
    for name in (
        "ix_alert_audio_assets_expires_at",
        "ix_alert_audio_assets_created_at",
        "ix_alert_audio_assets_status",
        "ix_alert_audio_assets_device_id",
        "ix_alert_audio_assets_delivery_id",
        "ix_alert_audio_assets_notification_id",
        "ix_alert_audio_assets_user_id",
    ):
        op.drop_index(name, table_name="alert_audio_assets")
    op.drop_table("alert_audio_assets")
    for name in (
        "ix_desktop_audio_pairings_expires_at",
        "ix_desktop_audio_pairings_status",
        "ix_desktop_audio_pairings_secret_hash",
        "ix_desktop_audio_pairings_user_id",
    ):
        op.drop_index(name, table_name="desktop_audio_pairings")
    op.drop_table("desktop_audio_pairings")
    for name in (
        "ix_desktop_audio_devices_status",
        "ix_desktop_audio_devices_token_hash",
        "ix_desktop_audio_devices_user_id",
    ):
        op.drop_index(name, table_name="desktop_audio_devices")
    op.drop_table("desktop_audio_devices")
