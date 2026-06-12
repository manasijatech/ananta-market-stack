from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from db.models import (
    AuditEvent,
    BrokerAccount,
    BrokerAccountGrant,
    Role,
    RolePermission,
    User,
    Workspace,
    WorkspaceMember,
)

WORKSPACE_MANAGE_MEMBERS = "workspace.manage_members"
WORKSPACE_MANAGE_ROLES = "workspace.manage_roles"
BROKER_VIEW = "broker.view"
BROKER_USE_DATA = "broker.use_data"
BROKER_MANAGE_SESSIONS = "broker.manage_sessions"
BROKER_MANAGE_CREDENTIALS = "broker.manage_credentials"
BROKER_DELETE = "broker.delete"
ORDERS_TRADE = "orders.trade"

BROKER_FULL_PERMISSIONS = [
    BROKER_VIEW,
    BROKER_USE_DATA,
    BROKER_MANAGE_SESSIONS,
    BROKER_MANAGE_CREDENTIALS,
    BROKER_DELETE,
]

BUILTIN_ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": [
        WORKSPACE_MANAGE_MEMBERS,
        WORKSPACE_MANAGE_ROLES,
        *BROKER_FULL_PERMISSIONS,
        "alerts.view",
        "alerts.manage",
        "watchlists.view",
        "watchlists.manage",
        "settings.manage_llm",
        "settings.manage_alpha",
        ORDERS_TRADE,
    ],
    "operator": [
        BROKER_VIEW,
        BROKER_USE_DATA,
        BROKER_MANAGE_SESSIONS,
        "alerts.view",
        "alerts.manage",
        "watchlists.view",
        "watchlists.manage",
    ],
    "viewer": [
        BROKER_VIEW,
        BROKER_USE_DATA,
        "alerts.view",
        "watchlists.view",
    ],
    "pending": [],
}


@dataclass(frozen=True)
class Principal:
    user: User
    workspace: Workspace
    membership: WorkspaceMember
    permissions: frozenset[str]

    @property
    def is_admin(self) -> bool:
        return self.membership.status == "active" and self.membership.role == "admin"


def ensure_principal(db: Session, user: User) -> Principal:
    membership = _primary_membership(db, user.id)
    if membership is None:
        membership = _bootstrap_membership(db, user)
    _ensure_builtin_roles(db, membership.workspace_id)
    _ensure_owned_account_grants(db, membership.workspace_id, user.id)
    db.commit()
    db.refresh(membership)
    workspace = db.get(Workspace, membership.workspace_id)
    if workspace is None:
        raise HTTPException(status_code=500, detail="workspace not found")
    permissions = frozenset(_role_permissions(db, membership.workspace_id, membership.role))
    return Principal(user=user, workspace=workspace, membership=membership, permissions=permissions)


def require_active_member(principal: Principal) -> None:
    if principal.membership.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending admin approval.",
        )


def require_workspace_permission(principal: Principal, permission: str) -> None:
    require_active_member(principal)
    if principal.is_admin:
        return
    if permission not in principal.permissions:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="insufficient permissions")


def accessible_broker_accounts(db: Session, principal: Principal) -> list[BrokerAccount]:
    require_active_member(principal)
    accounts = list(
        db.scalars(
            select(BrokerAccount)
            .where(BrokerAccount.workspace_id == principal.workspace.id)
            .order_by(BrokerAccount.created_at.asc(), BrokerAccount.id.asc())
        ).all()
    )
    if principal.is_admin:
        return accounts
    return [account for account in accounts if BROKER_VIEW in account_permissions(db, principal, account)]


def get_broker_account_for_permission(
    db: Session,
    principal: Principal,
    account_id: str,
    permission: str,
) -> BrokerAccount:
    require_active_member(principal)
    account = db.get(BrokerAccount, account_id)
    if account is None or account.workspace_id != principal.workspace.id:
        raise HTTPException(status_code=404, detail="broker account not found")
    if principal.is_admin:
        return account
    if permission not in account_permissions(db, principal, account):
        raise HTTPException(status_code=404, detail="broker account not found")
    return account


def account_permissions(db: Session, principal: Principal, account: BrokerAccount) -> set[str]:
    if principal.is_admin and account.workspace_id == principal.workspace.id:
        return set(BROKER_FULL_PERMISSIONS)
    if principal.membership.status != "active" or account.workspace_id != principal.workspace.id:
        return set()
    permissions: set[str] = set()
    grants = db.scalars(
        select(BrokerAccountGrant).where(
            BrokerAccountGrant.account_id == account.id,
            BrokerAccountGrant.workspace_id == principal.workspace.id,
            (
                (BrokerAccountGrant.subject_type == "user") & (BrokerAccountGrant.subject_id == principal.user.id)
            )
            | (
                (BrokerAccountGrant.subject_type == "role")
                & (BrokerAccountGrant.subject_id == principal.membership.role)
            ),
        )
    ).all()
    for grant in grants:
        try:
            values = json.loads(grant.permissions_json or "[]")
        except json.JSONDecodeError:
            values = []
        permissions.update(str(value) for value in values if isinstance(value, str))
    return permissions


def grant_account_permissions(
    db: Session,
    *,
    principal: Principal,
    account: BrokerAccount,
    subject_type: str,
    subject_id: str,
    permissions: list[str],
) -> BrokerAccountGrant:
    require_workspace_permission(principal, WORKSPACE_MANAGE_MEMBERS)
    if account.workspace_id != principal.workspace.id:
        raise HTTPException(status_code=404, detail="broker account not found")
    if subject_type not in {"user", "role"}:
        raise HTTPException(status_code=400, detail="subject_type must be user or role")
    normalized = _normalize_broker_permissions(permissions)
    if subject_type == "user":
        member = db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == principal.workspace.id,
                WorkspaceMember.user_id == subject_id,
            )
        )
        if member is None:
            raise HTTPException(status_code=400, detail="workspace member not found")
        if member.status == "disabled":
            raise HTTPException(status_code=400, detail="disabled members cannot receive broker access")
        if member.status == "active" and member.role == "admin":
            normalized = list(BROKER_FULL_PERMISSIONS)
    else:
        if subject_id not in _role_names(db, principal.workspace.id):
            raise HTTPException(status_code=400, detail="role not found")
        if subject_id == "admin":
            normalized = list(BROKER_FULL_PERMISSIONS)
    grant = db.scalar(
        select(BrokerAccountGrant).where(
            BrokerAccountGrant.account_id == account.id,
            BrokerAccountGrant.subject_type == subject_type,
            BrokerAccountGrant.subject_id == subject_id,
        )
    )
    if grant is None:
        grant = BrokerAccountGrant(
            id=str(uuid.uuid4()),
            workspace_id=principal.workspace.id,
            account_id=account.id,
            subject_type=subject_type,
            subject_id=subject_id,
        )
    grant.permissions_json = json.dumps(normalized)
    db.add(grant)
    audit(
        db,
        principal=principal,
        action="broker.grant.update",
        resource_type="broker_account",
        resource_id=account.id,
        metadata={"subject_type": subject_type, "subject_id": subject_id, "permissions": normalized},
    )
    db.commit()
    db.refresh(grant)
    return grant


def create_creator_account_grant(db: Session, principal: Principal, account: BrokerAccount) -> None:
    grant = BrokerAccountGrant(
        id=str(uuid.uuid4()),
        workspace_id=principal.workspace.id,
        account_id=account.id,
        subject_type="user",
        subject_id=principal.user.id,
        permissions_json=json.dumps(BROKER_FULL_PERMISSIONS),
    )
    db.add(grant)
    audit(
        db,
        principal=principal,
        action="broker.account.create",
        resource_type="broker_account",
        resource_id=account.id,
        metadata={"broker_code": account.broker_code},
    )
    _ensure_admin_role_grant(db, principal.workspace.id, account.id)


def approve_member(db: Session, principal: Principal, user_id: str, role: str = "viewer") -> WorkspaceMember:
    require_workspace_permission(principal, WORKSPACE_MANAGE_MEMBERS)
    if role not in _role_names(db, principal.workspace.id):
        raise HTTPException(status_code=400, detail="role not found")
    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == principal.workspace.id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if member is None:
        if db.get(User, user_id) is None:
            raise HTTPException(status_code=404, detail="user not found")
        member = WorkspaceMember(
            id=str(uuid.uuid4()),
            workspace_id=principal.workspace.id,
            user_id=user_id,
        )
    member.status = "active"
    member.role = role
    db.add(member)
    audit(db, principal=principal, action="member.approve", resource_type="user", resource_id=user_id, metadata={"role": role})
    db.commit()
    db.refresh(member)
    return member


def set_member_role(db: Session, principal: Principal, user_id: str, role: str) -> WorkspaceMember:
    require_workspace_permission(principal, WORKSPACE_MANAGE_MEMBERS)
    if role not in _role_names(db, principal.workspace.id):
        raise HTTPException(status_code=400, detail="role not found")
    member = _member_or_404(db, principal.workspace.id, user_id)
    if member.role == "admin" and role != "admin":
        _ensure_not_last_admin(db, principal.workspace.id, excluding_user_id=user_id)
    member.role = role
    member.status = "active" if role != "pending" else "pending"
    db.add(member)
    audit(db, principal=principal, action="member.role.update", resource_type="user", resource_id=user_id, metadata={"role": role})
    db.commit()
    db.refresh(member)
    return member


def disable_member(db: Session, principal: Principal, user_id: str) -> WorkspaceMember:
    require_workspace_permission(principal, WORKSPACE_MANAGE_MEMBERS)
    member = _member_or_404(db, principal.workspace.id, user_id)
    if member.role == "admin":
        _ensure_not_last_admin(db, principal.workspace.id, excluding_user_id=user_id)
    member.status = "disabled"
    db.add(member)
    audit(db, principal=principal, action="member.disable", resource_type="user", resource_id=user_id, metadata={})
    db.commit()
    db.refresh(member)
    return member


def list_members(db: Session, principal: Principal) -> list[WorkspaceMember]:
    require_workspace_permission(principal, WORKSPACE_MANAGE_MEMBERS)
    reconcile_workspace_members(db, principal.workspace.id)
    return list(
        db.scalars(
            select(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == principal.workspace.id)
            .order_by(WorkspaceMember.created_at.asc(), WorkspaceMember.id.asc())
        ).all()
    )


def audit(
    db: Session,
    *,
    principal: Principal | None,
    action: str,
    resource_type: str,
    resource_id: str | None,
    metadata: dict[str, Any],
) -> None:
    db.add(
        AuditEvent(
            id=str(uuid.uuid4()),
            workspace_id=principal.workspace.id if principal else None,
            actor_user_id=principal.user.id if principal else None,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            metadata_json=json.dumps(metadata, default=str),
        )
    )


def _primary_membership(db: Session, user_id: str) -> WorkspaceMember | None:
    return db.scalar(
        select(WorkspaceMember)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(WorkspaceMember.status.asc(), WorkspaceMember.created_at.asc())
    )


def _bootstrap_membership(db: Session, user: User) -> WorkspaceMember:
    owns_accounts = db.scalar(select(func.count()).select_from(BrokerAccount).where(BrokerAccount.user_id == user.id)) or 0
    active_member_count = db.scalar(
        select(func.count()).select_from(WorkspaceMember).where(WorkspaceMember.status == "active")
    ) or 0
    if owns_accounts or active_member_count == 0:
        workspace = Workspace(
            id=str(uuid.uuid4()),
            name=(user.display_name or "Default workspace").strip() or "Default workspace",
            created_by_user_id=user.id,
        )
        db.add(workspace)
        db.flush()
        member = WorkspaceMember(
            id=str(uuid.uuid4()),
            workspace_id=workspace.id,
            user_id=user.id,
            role="admin",
            status="active",
        )
        db.add(member)
        db.flush()
        for account in db.scalars(select(BrokerAccount).where(BrokerAccount.user_id == user.id)).all():
            account.workspace_id = workspace.id
            db.add(account)
        return member

    workspace = db.scalar(select(Workspace).order_by(Workspace.created_at.asc(), Workspace.id.asc()))
    if workspace is None:
        raise HTTPException(status_code=500, detail="workspace not found")
    member = WorkspaceMember(
        id=str(uuid.uuid4()),
        workspace_id=workspace.id,
        user_id=user.id,
        role="pending",
        status="pending",
    )
    db.add(member)
    db.flush()
    return member


def _ensure_builtin_roles(db: Session, workspace_id: str) -> None:
    existing = {
        row.name: row
        for row in db.scalars(select(Role).where(Role.workspace_id == workspace_id)).all()
    }
    for role_name, permissions in BUILTIN_ROLE_PERMISSIONS.items():
        role = existing.get(role_name)
        if role is None:
            role = Role(
                id=str(uuid.uuid4()),
                workspace_id=workspace_id,
                name=role_name,
                label=role_name.title(),
                is_builtin=True,
            )
            db.add(role)
            db.flush()
        current = {
            item.permission
            for item in db.scalars(select(RolePermission).where(RolePermission.role_id == role.id)).all()
        }
        for permission in permissions:
            if permission not in current:
                db.add(RolePermission(id=str(uuid.uuid4()), role_id=role.id, permission=permission))


def _ensure_owned_account_grants(db: Session, workspace_id: str, user_id: str) -> None:
    for account in db.scalars(select(BrokerAccount).where(BrokerAccount.user_id == user_id)).all():
        if account.workspace_id is None:
            account.workspace_id = workspace_id
            db.add(account)
        if account.workspace_id != workspace_id:
            continue
        grant = db.scalar(
            select(BrokerAccountGrant).where(
                BrokerAccountGrant.account_id == account.id,
                BrokerAccountGrant.subject_type == "user",
                BrokerAccountGrant.subject_id == user_id,
            )
        )
        if grant is None:
            db.add(
                BrokerAccountGrant(
                    id=str(uuid.uuid4()),
                    workspace_id=workspace_id,
                    account_id=account.id,
                    subject_type="user",
                    subject_id=user_id,
                    permissions_json=json.dumps(BROKER_FULL_PERMISSIONS),
                )
            )
        _ensure_admin_role_grant(db, workspace_id, account.id)


def reconcile_workspace_members(db: Session, workspace_id: str) -> None:
    members = list(
        db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id)).all()
    )
    if not members:
        return
    auth_users = _auth_user_rows(db, [member.user_id for member in members])
    changed = False
    for member in members:
        user = db.get(User, member.user_id)
        auth_user = auth_users.get(member.user_id)
        if user is None or auth_user is None:
            continue
        auth_name = auth_user.get("name")
        if auth_name and not user.display_name:
            user.display_name = auth_name
            db.add(user)
            changed = True
    if changed:
        db.commit()


def reconcile_workspace_account_grants(db: Session, workspace_id: str, *, account_id: str | None = None) -> None:
    _ensure_builtin_roles(db, workspace_id)
    reconcile_workspace_members(db, workspace_id)
    members = list(
        db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id)).all()
    )
    member_by_user_id = {member.user_id: member for member in members}
    role_names = _role_names(db, workspace_id)
    account_ids = (
        [account_id]
        if account_id is not None
        else list(
            db.scalars(
                select(BrokerAccount.id).where(BrokerAccount.workspace_id == workspace_id)
            ).all()
        )
    )
    changed = False
    for current_account_id in account_ids:
        changed = _ensure_admin_role_grant(db, workspace_id, current_account_id) or changed
        grants = list(
            db.scalars(
                select(BrokerAccountGrant).where(
                    BrokerAccountGrant.workspace_id == workspace_id,
                    BrokerAccountGrant.account_id == current_account_id,
                )
            ).all()
        )
        for grant in grants:
            if grant.subject_type == "user":
                member = member_by_user_id.get(grant.subject_id)
                if member is None:
                    db.delete(grant)
                    changed = True
                    continue
                desired_permissions = _normalize_broker_permissions(_grant_permissions(grant))
                if member.status == "active" and member.role == "admin":
                    desired_permissions = list(BROKER_FULL_PERMISSIONS)
            elif grant.subject_type == "role":
                if grant.subject_id not in role_names:
                    db.delete(grant)
                    changed = True
                    continue
                desired_permissions = _normalize_broker_permissions(_grant_permissions(grant))
                if grant.subject_id == "admin":
                    desired_permissions = list(BROKER_FULL_PERMISSIONS)
            else:
                db.delete(grant)
                changed = True
                continue
            if grant.permissions_json != json.dumps(desired_permissions):
                grant.permissions_json = json.dumps(desired_permissions)
                db.add(grant)
                changed = True
    if changed:
        db.commit()


def _role_permissions(db: Session, workspace_id: str, role_name: str) -> set[str]:
    role = db.scalar(select(Role).where(Role.workspace_id == workspace_id, Role.name == role_name))
    if role is None:
        return set(BUILTIN_ROLE_PERMISSIONS.get(role_name, []))
    return {
        row.permission
        for row in db.scalars(select(RolePermission).where(RolePermission.role_id == role.id)).all()
    }


def _role_names(db: Session, workspace_id: str) -> set[str]:
    return {row.name for row in db.scalars(select(Role).where(Role.workspace_id == workspace_id)).all()}


def _member_or_404(db: Session, workspace_id: str, user_id: str) -> WorkspaceMember:
    member = db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if member is None:
        raise HTTPException(status_code=404, detail="workspace member not found")
    return member


def _ensure_not_last_admin(db: Session, workspace_id: str, *, excluding_user_id: str) -> None:
    remaining = db.scalar(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.status == "active",
            WorkspaceMember.role == "admin",
            WorkspaceMember.user_id != excluding_user_id,
        )
    ) or 0
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="cannot remove the last active admin")


def _normalize_broker_permissions(permissions: list[str]) -> list[str]:
    allowed = set(BROKER_FULL_PERMISSIONS)
    return sorted({item for item in permissions if item in allowed})


def _grant_permissions(grant: BrokerAccountGrant) -> list[str]:
    try:
        values = json.loads(grant.permissions_json or "[]")
    except json.JSONDecodeError:
        values = []
    return [str(value) for value in values if isinstance(value, str)]


def _ensure_admin_role_grant(db: Session, workspace_id: str, account_id: str) -> bool:
    grant = db.scalar(
        select(BrokerAccountGrant).where(
            BrokerAccountGrant.workspace_id == workspace_id,
            BrokerAccountGrant.account_id == account_id,
            BrokerAccountGrant.subject_type == "role",
            BrokerAccountGrant.subject_id == "admin",
        )
    )
    if grant is None:
        db.add(
            BrokerAccountGrant(
                id=str(uuid.uuid4()),
                workspace_id=workspace_id,
                account_id=account_id,
                subject_type="role",
                subject_id="admin",
                permissions_json=json.dumps(BROKER_FULL_PERMISSIONS),
            )
        )
        return True
    if grant.permissions_json != json.dumps(BROKER_FULL_PERMISSIONS):
        grant.permissions_json = json.dumps(BROKER_FULL_PERMISSIONS)
        db.add(grant)
        return True
    return False


def _auth_user_rows(db: Session, user_ids: list[str]) -> dict[str, dict[str, str | None]]:
    if not user_ids:
        return {}
    placeholders = ", ".join(f":user_id_{index}" for index in range(len(user_ids)))
    params = {f"user_id_{index}": user_id for index, user_id in enumerate(user_ids)}
    rows = db.execute(
        text(f'SELECT id, name, email FROM "user" WHERE id IN ({placeholders})'),
        params,
    ).mappings().all()
    return {
        str(row["id"]): {
            "name": str(row.get("name")) if row.get("name") else None,
            "email": str(row.get("email")) if row.get("email") else None,
        }
        for row in rows
    }
