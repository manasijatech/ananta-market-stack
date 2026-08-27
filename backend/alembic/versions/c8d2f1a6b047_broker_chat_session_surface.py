"""broker chat session surface isolation

Revision ID: c8d2f1a6b047
Revises: b5d9e3f2a814
Create Date: 2026-08-26 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c8d2f1a6b047"
down_revision: Union[str, None] = "b5d9e3f2a814"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
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


def backfill_broker_chat_session_surfaces(connection) -> None:
    connection.execute(
        sa.text(
            """
            UPDATE broker_chat_sessions
            SET surface = 'adaptive_workspace'
            WHERE title = 'Adaptive workspace'
               OR id IN (
                 SELECT DISTINCT session_id
                 FROM broker_chat_runs
                 WHERE json_extract(metadata_json, '$.adaptive_workspace') IN (1, 'true', '1')
                    OR instr(
                      replace(metadata_json, ' ', ''),
                      '"adaptive_workspace"' || char(58) || 'true'
                    ) > 0
               )
            """
        )
    )
    inspector = sa.inspect(connection)
    if "adaptive_workspace_snapshots" not in inspector.get_table_names():
        return
    connection.execute(
        sa.text(
            """
            UPDATE broker_chat_sessions
            SET surface = 'adaptive_workspace'
            WHERE id IN (
              SELECT DISTINCT session_id FROM adaptive_workspace_snapshots
            )
            """
        )
    )


def upgrade() -> None:
    if "surface" not in _column_names("broker_chat_sessions"):
        op.add_column(
            "broker_chat_sessions",
            sa.Column("surface", sa.String(length=32), nullable=False, server_default="broker_chat"),
        )
    if "ix_broker_chat_sessions_surface" not in _index_names("broker_chat_sessions"):
        op.create_index("ix_broker_chat_sessions_surface", "broker_chat_sessions", ["surface"])
    backfill_broker_chat_session_surfaces(op.get_bind())


def downgrade() -> None:
    if "ix_broker_chat_sessions_surface" in _index_names("broker_chat_sessions"):
        op.drop_index("ix_broker_chat_sessions_surface", table_name="broker_chat_sessions")
    if "surface" in _column_names("broker_chat_sessions"):
        op.drop_column("broker_chat_sessions", "surface")
