"""mcp oauth inventory

Revision ID: 9a7c5e2d1f84
Revises: 2e91b7a4d6c3
Create Date: 2026-05-22 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9a7c5e2d1f84"
down_revision: Union[str, None] = "2e91b7a4d6c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = [
        sa.Column("oauth_access_token_cipher", sa.Text(), nullable=False, server_default=""),
        sa.Column("oauth_refresh_token_cipher", sa.Text(), nullable=False, server_default=""),
        sa.Column("oauth_token_expires_at", sa.DateTime(), nullable=True),
        sa.Column("oauth_client_id", sa.Text(), nullable=False, server_default=""),
        sa.Column("oauth_client_secret_cipher", sa.Text(), nullable=False, server_default=""),
        sa.Column("oauth_auth_metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("oauth_state", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("oauth_code_verifier_cipher", sa.Text(), nullable=False, server_default=""),
        sa.Column("oauth_redirect_uri", sa.Text(), nullable=False, server_default=""),
        sa.Column("oauth_scope", sa.Text(), nullable=False, server_default=""),
        sa.Column("oauth_authorized_at", sa.DateTime(), nullable=True),
        sa.Column("oauth_last_error", sa.Text(), nullable=True),
        sa.Column("inventory_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("inventory_checked_at", sa.DateTime(), nullable=True),
        sa.Column("inventory_error", sa.Text(), nullable=True),
    ]
    for column in columns:
        op.add_column("user_mcp_server_configs", column)


def downgrade() -> None:
    for column_name in [
        "inventory_error",
        "inventory_checked_at",
        "inventory_json",
        "oauth_last_error",
        "oauth_authorized_at",
        "oauth_scope",
        "oauth_redirect_uri",
        "oauth_code_verifier_cipher",
        "oauth_state",
        "oauth_auth_metadata_json",
        "oauth_client_secret_cipher",
        "oauth_client_id",
        "oauth_token_expires_at",
        "oauth_refresh_token_cipher",
        "oauth_access_token_cipher",
    ]:
        op.drop_column("user_mcp_server_configs", column_name)
