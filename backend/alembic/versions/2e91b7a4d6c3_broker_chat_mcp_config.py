"""broker chat mcp config

Revision ID: 2e91b7a4d6c3
Revises: 7c2b4e8f9a31
Create Date: 2026-05-21 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "2e91b7a4d6c3"
down_revision: Union[str, None] = "7c2b4e8f9a31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_broker_chat_preferences",
        sa.Column("use_mcp", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "user_mcp_server_configs",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("name", sa.String(length=128), nullable=True),
        sa.Column("url", sa.Text(), nullable=False, server_default=""),
        sa.Column("transport", sa.String(length=32), nullable=False, server_default="streamable_http"),
        sa.Column("api_key_cipher", sa.Text(), nullable=False, server_default=""),
        sa.Column("api_key_header_name", sa.String(length=128), nullable=False, server_default="Authorization"),
        sa.Column("api_key_prefix", sa.String(length=64), nullable=False, server_default="Bearer"),
        sa.Column("extra_headers_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("tool_cache_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("user_mcp_server_configs")
    op.drop_column("user_broker_chat_preferences", "use_mcp")
