"""arrow trade broker

Revision ID: 1a7e4c9d2b60
Revises: 0f6b2c9d8e31
Create Date: 2026-07-21 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "1a7e4c9d2b60"
down_revision: Union[str, None] = "0f6b2c9d8e31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "broker_arrow_credentials",
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("app_id_cipher", sa.Text(), nullable=False),
        sa.Column("app_secret_cipher", sa.Text(), nullable=False),
        sa.Column("access_token_cipher", sa.Text(), nullable=False),
        sa.Column("session_user_id_cipher", sa.Text(), nullable=True),
        sa.Column("login_user_id_cipher", sa.Text(), nullable=True),
        sa.Column("login_password_cipher", sa.Text(), nullable=True),
        sa.Column("totp_secret_cipher", sa.Text(), nullable=True),
        sa.Column("access_token_generated_at", sa.DateTime(), nullable=True),
        sa.Column("access_token_expires_at", sa.DateTime(), nullable=True),
        sa.Column("market_stream_mode", sa.String(length=16), nullable=False, server_default="standard"),
        sa.Column("hft_latency_ms", sa.Integer(), nullable=False, server_default="1000"),
        sa.ForeignKeyConstraint(["account_id"], ["broker_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id"),
    )
    op.add_column("broker_instruments", sa.Column("arrow_token", sa.String(length=64), nullable=True))
    op.add_column("broker_instruments", sa.Column("price_precision", sa.String(length=16), nullable=True))
    op.create_index("ix_broker_instruments_arrow_token", "broker_instruments", ["arrow_token"])


def downgrade() -> None:
    op.drop_index("ix_broker_instruments_arrow_token", table_name="broker_instruments")
    op.drop_column("broker_instruments", "price_precision")
    op.drop_column("broker_instruments", "arrow_token")
    op.drop_table("broker_arrow_credentials")
