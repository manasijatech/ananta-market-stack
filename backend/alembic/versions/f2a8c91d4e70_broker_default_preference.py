"""broker default data preference

Revision ID: f2a8c91d4e70
Revises: e8f1a2b3c4d5
Create Date: 2026-05-19 12:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2a8c91d4e70"
down_revision: Union[str, None] = "e8f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _column_names(table_name: str) -> set[str]:
    if not _table_exists(table_name):
        return set()
    return {column["name"] for column in _inspector().get_columns(table_name)}


def _index_names(table_name: str) -> set[str]:
    if not _table_exists(table_name):
        return set()
    return {index["name"] for index in _inspector().get_indexes(table_name)}


def upgrade() -> None:
    table_name = "user_broker_data_preferences"
    if not _table_exists(table_name):
        op.create_table(
            table_name,
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("preferred_search_account_id", sa.String(length=36), nullable=True),
            sa.Column("preferred_default_account_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["preferred_search_account_id"], ["broker_accounts.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["preferred_default_account_id"], ["broker_accounts.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("user_id"),
        )
    else:
        columns = _column_names(table_name)
        if "preferred_search_account_id" not in columns:
            op.add_column(
                table_name,
                sa.Column("preferred_search_account_id", sa.String(length=36), nullable=True),
            )
        if "preferred_default_account_id" not in columns:
            op.add_column(
                table_name,
                sa.Column("preferred_default_account_id", sa.String(length=36), nullable=True),
            )

    indexes = _index_names(table_name)
    if "ix_user_broker_data_preferences_preferred_search_account_id" not in indexes:
        op.create_index(
            "ix_user_broker_data_preferences_preferred_search_account_id",
            table_name,
            ["preferred_search_account_id"],
        )
    if "ix_user_broker_data_preferences_preferred_default_account_id" not in indexes:
        op.create_index(
            "ix_user_broker_data_preferences_preferred_default_account_id",
            table_name,
            ["preferred_default_account_id"],
        )


def downgrade() -> None:
    table_name = "user_broker_data_preferences"
    if not _table_exists(table_name):
        return
    indexes = _index_names(table_name)
    if "ix_user_broker_data_preferences_preferred_default_account_id" in indexes:
        op.drop_index(
            "ix_user_broker_data_preferences_preferred_default_account_id",
            table_name=table_name,
        )
    # Keep the table and search preference on downgrade because older local
    # bootstraps may have created them outside Alembic.
