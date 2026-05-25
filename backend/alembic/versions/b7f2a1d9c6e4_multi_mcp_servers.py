"""multi mcp servers

Revision ID: b7f2a1d9c6e4
Revises: a6b4e21d9c3f
Create Date: 2026-05-25 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7f2a1d9c6e4"
down_revision: Union[str, None] = "a6b4e21d9c3f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


UUID_SQLITE = (
    "lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || "
    "substr(lower(hex(randomblob(2))),2) || '-' || "
    "substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || "
    "lower(hex(randomblob(6)))"
)


def upgrade() -> None:
    op.add_column(
        "user_broker_chat_preferences",
        sa.Column("mcp_server_ids_json", sa.Text(), nullable=False, server_default="[]"),
    )

    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "sqlite":
        op.rename_table("user_mcp_server_configs", "user_mcp_server_configs_single")
        op.create_table(
            "user_mcp_server_configs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("use_by_default", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("name", sa.String(length=128), nullable=True),
            sa.Column("url", sa.Text(), nullable=False, server_default=""),
            sa.Column("transport", sa.String(length=32), nullable=False, server_default="streamable_http"),
            sa.Column("api_key_cipher", sa.Text(), nullable=False, server_default=""),
            sa.Column("api_key_header_name", sa.String(length=128), nullable=False, server_default="Authorization"),
            sa.Column("api_key_prefix", sa.String(length=64), nullable=False, server_default="Bearer"),
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
            sa.Column("extra_headers_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="15"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.execute(
            "INSERT INTO user_mcp_server_configs "
            "(id,user_id,is_enabled,use_by_default,name,url,transport,api_key_cipher,api_key_header_name,api_key_prefix,"
            "oauth_access_token_cipher,oauth_refresh_token_cipher,oauth_token_expires_at,oauth_client_id,oauth_client_secret_cipher,"
            "oauth_auth_metadata_json,oauth_state,oauth_code_verifier_cipher,oauth_redirect_uri,oauth_scope,oauth_authorized_at,"
            "oauth_last_error,inventory_json,inventory_checked_at,inventory_error,extra_headers_json,timeout_seconds,created_at,updated_at) "
            f"SELECT {UUID_SQLITE}, user_id, is_enabled, 1, name, url, transport, api_key_cipher, api_key_header_name, api_key_prefix, "
            "oauth_access_token_cipher, oauth_refresh_token_cipher, oauth_token_expires_at, oauth_client_id, oauth_client_secret_cipher, "
            "oauth_auth_metadata_json, oauth_state, oauth_code_verifier_cipher, oauth_redirect_uri, oauth_scope, oauth_authorized_at, "
            "oauth_last_error, inventory_json, inventory_checked_at, inventory_error, extra_headers_json, timeout_seconds, created_at, updated_at "
            "FROM user_mcp_server_configs_single"
        )
        op.drop_table("user_mcp_server_configs_single")
        op.create_index("ix_user_mcp_server_configs_user_id", "user_mcp_server_configs", ["user_id"])
        return

    op.add_column("user_mcp_server_configs", sa.Column("id", sa.String(length=36), nullable=True))
    op.add_column(
        "user_mcp_server_configs",
        sa.Column("use_by_default", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    # Non-SQLite deployments should backfill ids before enforcing primary-key changes if this table already has data.


def downgrade() -> None:
    op.drop_column("user_broker_chat_preferences", "mcp_server_ids_json")
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.rename_table("user_mcp_server_configs", "user_mcp_server_configs_multi")
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
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("user_id"),
        )
        op.execute(
            "INSERT INTO user_mcp_server_configs "
            "(user_id,is_enabled,name,url,transport,api_key_cipher,api_key_header_name,api_key_prefix,extra_headers_json,timeout_seconds,created_at,updated_at) "
            "SELECT user_id,is_enabled,name,url,transport,api_key_cipher,api_key_header_name,api_key_prefix,extra_headers_json,timeout_seconds,created_at,updated_at "
            "FROM user_mcp_server_configs_multi GROUP BY user_id"
        )
        op.drop_table("user_mcp_server_configs_multi")
        return
    op.drop_column("user_mcp_server_configs", "use_by_default")
    op.drop_column("user_mcp_server_configs", "id")
