"""alpha websocket backend config

Revision ID: 4f7a2e9c1b65
Revises: a21d4c7f9b30
Create Date: 2026-05-14 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4f7a2e9c1b65"
down_revision: Union[str, None] = "a21d4c7f9b30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user_alpha_api_credentials", sa.Column("account_json", sa.Text(), nullable=False, server_default="{}"))
    op.add_column("user_alpha_api_credentials", sa.Column("account_checked_at", sa.DateTime(), nullable=True))
    op.add_column("user_alpha_api_credentials", sa.Column("account_error", sa.Text(), nullable=True))

    op.create_table(
        "user_alpha_websocket_configs",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("products_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("scope_mode", sa.String(length=32), nullable=False, server_default="alert_subscriptions"),
        sa.Column("watchlist_ids_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("include_all_watchlists", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("full_market", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_status", sa.String(length=32), nullable=False, server_default="unknown"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_connected_at", sa.DateTime(), nullable=True),
        sa.Column("last_event_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "alpha_websocket_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("product", sa.String(length=32), nullable=False),
        sa.Column("symbol", sa.String(length=128), nullable=True),
        sa.Column("event_key", sa.String(length=256), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("received_at", sa.DateTime(), nullable=True),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_alpha_websocket_events_user_id", ["user_id"]),
        ("ix_alpha_websocket_events_product", ["product"]),
        ("ix_alpha_websocket_events_symbol", ["symbol"]),
        ("ix_alpha_websocket_events_event_key", ["event_key"]),
        ("ix_alpha_websocket_events_received_at", ["received_at"]),
        ("ix_alpha_websocket_events_processed_at", ["processed_at"]),
    ):
        op.create_index(name, "alpha_websocket_events", columns)


def downgrade() -> None:
    op.drop_table("alpha_websocket_events")
    op.drop_table("user_alpha_websocket_configs")
    op.drop_column("user_alpha_api_credentials", "account_error")
    op.drop_column("user_alpha_api_credentials", "account_checked_at")
    op.drop_column("user_alpha_api_credentials", "account_json")
