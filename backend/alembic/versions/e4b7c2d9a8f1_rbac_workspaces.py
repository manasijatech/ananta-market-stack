"""rbac workspaces

Revision ID: e4b7c2d9a8f1
Revises: d7a4f23c9e81
Create Date: 2026-06-11 00:00:00.000000
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "e4b7c2d9a8f1"
down_revision: Union[str, None] = "d7a4f23c9e81"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ADMIN_PERMISSIONS = [
    "workspace.manage_members",
    "workspace.manage_roles",
    "broker.view",
    "broker.use_data",
    "broker.manage_sessions",
    "broker.manage_credentials",
    "broker.delete",
    "alerts.view",
    "alerts.manage",
    "watchlists.view",
    "watchlists.manage",
    "settings.manage_llm",
    "settings.manage_alpha",
    "orders.trade",
]
OPERATOR_PERMISSIONS = [
    "broker.view",
    "broker.use_data",
    "broker.manage_sessions",
    "alerts.view",
    "alerts.manage",
    "watchlists.view",
    "watchlists.manage",
]
VIEWER_PERMISSIONS = [
    "broker.view",
    "broker.use_data",
    "alerts.view",
    "watchlists.view",
]


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> str:
    return datetime.utcnow().isoformat(sep=" ")


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=256), nullable=False, server_default="Default workspace"),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workspaces_created_by_user_id", "workspaces", ["created_by_user_id"])

    op.create_table(
        "workspace_members",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False, server_default="pending"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"),
    )
    op.create_index("ix_workspace_members_workspace_id", "workspace_members", ["workspace_id"])
    op.create_index("ix_workspace_members_user_id", "workspace_members", ["user_id"])
    op.create_index("ix_workspace_members_role", "workspace_members", ["role"])
    op.create_index("ix_workspace_members_status", "workspace_members", ["status"])

    op.create_table(
        "roles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_roles_workspace_name"),
    )
    op.create_index("ix_roles_workspace_id", "roles", ["workspace_id"])
    op.create_index("ix_roles_name", "roles", ["name"])

    op.create_table(
        "role_permissions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("role_id", sa.String(length=36), nullable=False),
        sa.Column("permission", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role_id", "permission", name="uq_role_permissions_role_permission"),
    )
    op.create_index("ix_role_permissions_role_id", "role_permissions", ["role_id"])
    op.create_index("ix_role_permissions_permission", "role_permissions", ["permission"])

    op.add_column("broker_accounts", sa.Column("workspace_id", sa.String(length=36), nullable=True))
    op.create_index("ix_broker_accounts_workspace_id", "broker_accounts", ["workspace_id"])

    op.create_table(
        "broker_account_grants",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("subject_type", sa.String(length=16), nullable=False),
        sa.Column("subject_id", sa.String(length=64), nullable=False),
        sa.Column("permissions_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["broker_accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "subject_type", "subject_id", name="uq_broker_account_grants_account_subject"),
    )
    op.create_index("ix_broker_account_grants_workspace_id", "broker_account_grants", ["workspace_id"])
    op.create_index("ix_broker_account_grants_account_id", "broker_account_grants", ["account_id"])
    op.create_index("ix_broker_account_grants_subject_type", "broker_account_grants", ["subject_type"])
    op.create_index("ix_broker_account_grants_subject_id", "broker_account_grants", ["subject_id"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=True),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("resource_type", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=64), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_events_workspace_id", "audit_events", ["workspace_id"])
    op.create_index("ix_audit_events_actor_user_id", "audit_events", ["actor_user_id"])
    op.create_index("ix_audit_events_action", "audit_events", ["action"])
    op.create_index("ix_audit_events_resource_type", "audit_events", ["resource_type"])
    op.create_index("ix_audit_events_resource_id", "audit_events", ["resource_id"])
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"])

    _migrate_existing_users()


def _migrate_existing_users() -> None:
    conn = op.get_bind()
    users = list(conn.execute(text("SELECT id, display_name FROM users ORDER BY created_at ASC, id ASC")).mappings())
    for user in users:
        workspace_id = _uuid()
        now = _now()
        name = (user.get("display_name") or "Default workspace").strip() or "Default workspace"
        conn.execute(
            text(
                "INSERT INTO workspaces (id, name, created_by_user_id, created_at, updated_at) "
                "VALUES (:id, :name, :user_id, :created_at, :updated_at)"
            ),
            {"id": workspace_id, "name": name, "user_id": user["id"], "created_at": now, "updated_at": now},
        )
        conn.execute(
            text(
                "INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at) "
                "VALUES (:id, :workspace_id, :user_id, 'admin', 'active', :created_at, :updated_at)"
            ),
            {"id": _uuid(), "workspace_id": workspace_id, "user_id": user["id"], "created_at": now, "updated_at": now},
        )
        _insert_builtin_roles(conn, workspace_id, now)
        account_ids = [
            row[0]
            for row in conn.execute(
                text("SELECT id FROM broker_accounts WHERE user_id = :user_id"),
                {"user_id": user["id"]},
            ).all()
        ]
        conn.execute(
            text("UPDATE broker_accounts SET workspace_id = :workspace_id WHERE user_id = :user_id"),
            {"workspace_id": workspace_id, "user_id": user["id"]},
        )
        for account_id in account_ids:
            conn.execute(
                text(
                    "INSERT INTO broker_account_grants "
                    "(id, workspace_id, account_id, subject_type, subject_id, permissions_json, created_at, updated_at) "
                    "VALUES (:id, :workspace_id, :account_id, 'user', :user_id, :permissions_json, :created_at, :updated_at)"
                ),
                {
                    "id": _uuid(),
                    "workspace_id": workspace_id,
                    "account_id": account_id,
                    "user_id": user["id"],
                    "permissions_json": json.dumps(["broker.view", "broker.use_data", "broker.manage_sessions", "broker.manage_credentials", "broker.delete"]),
                    "created_at": now,
                    "updated_at": now,
                },
            )


def _insert_builtin_roles(conn, workspace_id: str, now: str) -> None:
    roles = {
        "admin": ADMIN_PERMISSIONS,
        "operator": OPERATOR_PERMISSIONS,
        "viewer": VIEWER_PERMISSIONS,
        "pending": [],
    }
    labels = {
        "admin": "Admin",
        "operator": "Operator",
        "viewer": "Viewer",
        "pending": "Pending",
    }
    for role_name, permissions in roles.items():
        role_id = _uuid()
        conn.execute(
            text(
                "INSERT INTO roles (id, workspace_id, name, label, is_builtin, created_at, updated_at) "
                "VALUES (:id, :workspace_id, :name, :label, 1, :created_at, :updated_at)"
            ),
            {"id": role_id, "workspace_id": workspace_id, "name": role_name, "label": labels[role_name], "created_at": now, "updated_at": now},
        )
        for permission in permissions:
            conn.execute(
                text(
                    "INSERT INTO role_permissions (id, role_id, permission, created_at) "
                    "VALUES (:id, :role_id, :permission, :created_at)"
                ),
                {"id": _uuid(), "role_id": role_id, "permission": permission, "created_at": now},
            )


def downgrade() -> None:
    op.drop_index("ix_audit_events_created_at", table_name="audit_events")
    op.drop_index("ix_audit_events_resource_id", table_name="audit_events")
    op.drop_index("ix_audit_events_resource_type", table_name="audit_events")
    op.drop_index("ix_audit_events_action", table_name="audit_events")
    op.drop_index("ix_audit_events_actor_user_id", table_name="audit_events")
    op.drop_index("ix_audit_events_workspace_id", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_index("ix_broker_account_grants_subject_id", table_name="broker_account_grants")
    op.drop_index("ix_broker_account_grants_subject_type", table_name="broker_account_grants")
    op.drop_index("ix_broker_account_grants_account_id", table_name="broker_account_grants")
    op.drop_index("ix_broker_account_grants_workspace_id", table_name="broker_account_grants")
    op.drop_table("broker_account_grants")
    op.drop_index("ix_broker_accounts_workspace_id", table_name="broker_accounts")
    op.drop_column("broker_accounts", "workspace_id")
    op.drop_index("ix_role_permissions_permission", table_name="role_permissions")
    op.drop_index("ix_role_permissions_role_id", table_name="role_permissions")
    op.drop_table("role_permissions")
    op.drop_index("ix_roles_name", table_name="roles")
    op.drop_index("ix_roles_workspace_id", table_name="roles")
    op.drop_table("roles")
    op.drop_index("ix_workspace_members_status", table_name="workspace_members")
    op.drop_index("ix_workspace_members_role", table_name="workspace_members")
    op.drop_index("ix_workspace_members_user_id", table_name="workspace_members")
    op.drop_index("ix_workspace_members_workspace_id", table_name="workspace_members")
    op.drop_table("workspace_members")
    op.drop_index("ix_workspaces_created_by_user_id", table_name="workspaces")
    op.drop_table("workspaces")
