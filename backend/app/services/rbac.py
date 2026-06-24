from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from db.models import (
    AuditEvent,
    BrokerAccount,
    BrokerAccountGrant,
    Role,
    RolePermission,
    User,
    UserAlphaApiCredential,
    UserLlmModel,
    UserLlmProviderCredential,
    UserMcpServerConfig,
    Workspace,
    WorkspaceMember,
)

WORKSPACE_MANAGE_MEMBERS = "workspace.manage_members"
WORKSPACE_MANAGE_ROLES = "workspace.manage_roles"
SETTINGS_MANAGE_LLM = "settings.manage_llm"
SETTINGS_MANAGE_ALPHA = "settings.manage_alpha"
SETTINGS_MANAGE_MCP = "settings.manage_mcp"
SETTINGS_VIEW_LLM_USAGE = "settings.view_llm_usage"
SETTINGS_USE_MCP = "settings.use_mcp"
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
        SETTINGS_MANAGE_LLM,
        SETTINGS_MANAGE_ALPHA,
        SETTINGS_MANAGE_MCP,
        SETTINGS_VIEW_LLM_USAGE,
        SETTINGS_USE_MCP,
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
        SETTINGS_VIEW_LLM_USAGE,
        SETTINGS_USE_MCP,
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
    for attempt in range(2):
        try:
            membership = _primary_membership(db, user.id)
            if membership is None:
                membership = _bootstrap_membership(db, user)
            else:
                _repair_orphaned_admin_access(db, membership)
            _ensure_builtin_roles(db, membership.workspace_id)
            _ensure_owned_account_grants(db, membership.workspace_id, user.id)
            reconcile_workspace_shared_configs(db, membership.workspace_id)
            db.commit()
            db.refresh(membership)
            workspace = db.get(Workspace, membership.workspace_id)
            if workspace is None:
                raise HTTPException(status_code=500, detail="workspace not found")
            permissions = frozenset(_role_permissions(db, membership.workspace_id, membership.role))
            return Principal(user=user, workspace=workspace, membership=membership, permissions=permissions)
        except IntegrityError:
            db.rollback()
            if attempt == 0:
                continue
            raise

    raise HTTPException(status_code=500, detail="workspace membership bootstrap failed")


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


def has_workspace_permission(principal: Principal, permission: str) -> bool:
    if principal.membership.status != "active":
        return False
    if principal.is_admin:
        return True
    return permission in principal.permissions


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
    if user_id == principal.user.id:
        raise HTTPException(status_code=400, detail="cannot disable yourself")
    member = _member_or_404(db, principal.workspace.id, user_id)
    if member.role == "admin":
        _ensure_not_last_admin(db, principal.workspace.id, excluding_user_id=user_id)
    member.status = "disabled"
    db.add(member)
    audit(db, principal=principal, action="member.disable", resource_type="user", resource_id=user_id, metadata={})
    db.commit()
    db.refresh(member)
    return member


def remove_member(db: Session, principal: Principal, user_id: str) -> None:
    require_workspace_permission(principal, WORKSPACE_MANAGE_MEMBERS)
    if user_id == principal.user.id:
        raise HTTPException(status_code=400, detail="cannot remove yourself")
    member = _member_or_404(db, principal.workspace.id, user_id)
    if member.role == "admin" and member.status == "active":
        _ensure_not_last_admin(db, principal.workspace.id, excluding_user_id=user_id)
    _purge_member_access(db, principal.workspace.id, member)
    audit(db, principal=principal, action="member.remove", resource_type="user", resource_id=user_id, metadata={})
    db.commit()


def list_members(db: Session, principal: Principal) -> list[WorkspaceMember]:
    require_workspace_permission(principal, WORKSPACE_MANAGE_MEMBERS)
    reconcile_workspace_members(db, principal.workspace.id)
    members = list(
        db.scalars(
            select(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == principal.workspace.id)
            .order_by(WorkspaceMember.created_at.asc(), WorkspaceMember.id.asc())
        ).all()
    )
    auth_users = _auth_user_rows(db, [member.user_id for member in members])
    if auth_users is None:
        return members
    return [member for member in members if member.user_id in auth_users]


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


def _installation_has_active_admin(db: Session) -> bool:
    return bool(
        db.scalar(
            select(func.count())
            .select_from(WorkspaceMember)
            .where(WorkspaceMember.role == "admin", WorkspaceMember.status == "active")
        )
    )


def _repair_orphaned_admin_access(db: Session, membership: WorkspaceMember) -> None:
    if _installation_has_active_admin(db):
        return
    if membership.status != "pending":
        return
    membership.role = "admin"
    membership.status = "active"
    db.add(membership)
    db.flush()


def repair_installation_without_admin(db: Session) -> int:
    if _installation_has_active_admin(db):
        return 0

    membership = db.scalars(
        select(WorkspaceMember)
        .where(WorkspaceMember.status == "pending")
        .order_by(WorkspaceMember.created_at.asc(), WorkspaceMember.id.asc())
    ).first()
    if membership is None:
        return 0

    membership.role = "admin"
    membership.status = "active"
    db.add(membership)
    db.commit()
    return 1


def _bootstrap_membership(db: Session, user: User) -> WorkspaceMember:
    owns_accounts = db.scalar(select(func.count()).select_from(BrokerAccount).where(BrokerAccount.user_id == user.id)) or 0
    if owns_accounts or not _installation_has_active_admin(db):
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
    if auth_users is None:
        return
    changed = False
    for member in members:
        auth_user = auth_users.get(member.user_id)
        if auth_user is None:
            _purge_member_access(db, workspace_id, member)
            changed = True
            continue
        user = db.get(User, member.user_id)
        if user is None:
            continue
        auth_name = auth_user.get("name")
        if auth_name and not user.display_name:
            user.display_name = auth_name
            db.add(user)
            changed = True
    if changed:
        db.commit()


def reconcile_workspace_shared_configs(db: Session, workspace_id: str) -> None:
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        return
    members = list(
        db.scalars(
            select(WorkspaceMember)
            .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.status == "active")
            .order_by(WorkspaceMember.created_at.asc(), WorkspaceMember.id.asc())
        ).all()
    )
    if not members:
        return
    owner_user_id = workspace_config_owner_user_id(
        db,
        workspace.created_by_user_id or members[0].user_id,
    )
    active_user_ids = [member.user_id for member in members]
    source_user_ids = [user_id for user_id in active_user_ids if user_id != owner_user_id]
    changed = False

    changed = _reconcile_owner_alpha_config(db, owner_user_id, source_user_ids) or changed
    changed = _reconcile_owner_llm_config(db, owner_user_id, source_user_ids) or changed
    changed = _reconcile_owner_mcp_config(db, owner_user_id, source_user_ids) or changed

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


def _reconcile_owner_alpha_config(db: Session, owner_user_id: str, source_user_ids: list[str]) -> bool:
    owner_row = db.get(UserAlphaApiCredential, owner_user_id)
    if owner_row is not None and owner_row.api_key_cipher:
        return False
    for source_user_id in source_user_ids:
        source_row = db.get(UserAlphaApiCredential, source_user_id)
        if source_row is None or not source_row.api_key_cipher:
            continue
        if owner_row is None:
            owner_row = UserAlphaApiCredential(user_id=owner_user_id)
        owner_row.api_key_cipher = source_row.api_key_cipher
        owner_row.is_enabled = source_row.is_enabled
        owner_row.account_json = source_row.account_json
        db.add(owner_row)
        return True
    return False


def _reconcile_owner_llm_config(db: Session, owner_user_id: str, source_user_ids: list[str]) -> bool:
    changed = False
    owner_credentials = {
        row.provider: row
        for row in db.scalars(
            select(UserLlmProviderCredential).where(UserLlmProviderCredential.user_id == owner_user_id)
        ).all()
    }
    owner_models = {
        (row.provider, row.model_id)
        for row in db.scalars(select(UserLlmModel).where(UserLlmModel.user_id == owner_user_id)).all()
    }

    for source_user_id in source_user_ids:
        for source_credential in db.scalars(
            select(UserLlmProviderCredential)
            .where(UserLlmProviderCredential.user_id == source_user_id)
            .order_by(UserLlmProviderCredential.created_at.asc(), UserLlmProviderCredential.id.asc())
        ).all():
            owner_credential = owner_credentials.get(source_credential.provider)
            if owner_credential is None:
                owner_credential = UserLlmProviderCredential(
                    id=str(uuid.uuid4()),
                    user_id=owner_user_id,
                    provider=source_credential.provider,
                    api_key_cipher=source_credential.api_key_cipher,
                    is_enabled=source_credential.is_enabled,
                )
                db.add(owner_credential)
                owner_credentials[source_credential.provider] = owner_credential
                changed = True
                continue
            if not owner_credential.api_key_cipher and source_credential.api_key_cipher:
                owner_credential.api_key_cipher = source_credential.api_key_cipher
                owner_credential.is_enabled = source_credential.is_enabled
                db.add(owner_credential)
                changed = True

        for source_model in db.scalars(
            select(UserLlmModel)
            .where(UserLlmModel.user_id == source_user_id)
            .order_by(UserLlmModel.created_at.asc(), UserLlmModel.id.asc())
        ).all():
            model_key = (source_model.provider, source_model.model_id)
            if model_key in owner_models:
                continue
            db.add(
                UserLlmModel(
                    id=str(uuid.uuid4()),
                    user_id=owner_user_id,
                    provider=source_model.provider,
                    model_id=source_model.model_id,
                    label=source_model.label,
                    is_enabled=source_model.is_enabled,
                )
            )
            owner_models.add(model_key)
            changed = True

    return changed


def _reconcile_owner_mcp_config(db: Session, owner_user_id: str, source_user_ids: list[str]) -> bool:
    owner_rows = list(
        db.scalars(
            select(UserMcpServerConfig)
            .where(UserMcpServerConfig.user_id == owner_user_id)
            .order_by(UserMcpServerConfig.created_at.asc(), UserMcpServerConfig.id.asc())
        ).all()
    )
    owner_keys = {
        ((row.name or "").strip().lower(), (row.url or "").strip(), row.transport)
        for row in owner_rows
    }
    changed = False

    for source_user_id in source_user_ids:
        source_rows = list(
            db.scalars(
                select(UserMcpServerConfig)
                .where(UserMcpServerConfig.user_id == source_user_id)
                .order_by(UserMcpServerConfig.created_at.asc(), UserMcpServerConfig.id.asc())
            ).all()
        )
        if not source_rows:
            continue
        for row in source_rows:
            dedupe_key = ((row.name or "").strip().lower(), (row.url or "").strip(), row.transport)
            if dedupe_key in owner_keys:
                continue
            db.add(
                UserMcpServerConfig(
                    id=str(uuid.uuid4()),
                    user_id=owner_user_id,
                    is_enabled=row.is_enabled,
                    use_by_default=row.use_by_default,
                    name=row.name,
                    url=row.url,
                    transport=row.transport,
                    api_key_cipher=row.api_key_cipher,
                    api_key_header_name=row.api_key_header_name,
                    api_key_prefix=row.api_key_prefix,
                    oauth_access_token_cipher=row.oauth_access_token_cipher,
                    oauth_refresh_token_cipher=row.oauth_refresh_token_cipher,
                    oauth_token_expires_at=row.oauth_token_expires_at,
                    oauth_client_id=row.oauth_client_id,
                    oauth_client_secret_cipher=row.oauth_client_secret_cipher,
                    oauth_auth_metadata_json=row.oauth_auth_metadata_json,
                    oauth_state="",
                    oauth_code_verifier_cipher="",
                    oauth_redirect_uri=row.oauth_redirect_uri,
                    oauth_scope=row.oauth_scope,
                    oauth_authorized_at=row.oauth_authorized_at,
                    oauth_last_error=row.oauth_last_error,
                    inventory_json=row.inventory_json,
                    inventory_checked_at=row.inventory_checked_at,
                    inventory_error=row.inventory_error,
                    extra_headers_json=row.extra_headers_json,
                    timeout_seconds=row.timeout_seconds,
                )
            )
            owner_keys.add(dedupe_key)
            changed = True
    return changed


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


def _purge_member_access(db: Session, workspace_id: str, member: WorkspaceMember) -> None:
    grants = list(
        db.scalars(
            select(BrokerAccountGrant).where(
                BrokerAccountGrant.workspace_id == workspace_id,
                BrokerAccountGrant.subject_type == "user",
                BrokerAccountGrant.subject_id == member.user_id,
            )
        ).all()
    )
    for grant in grants:
        db.delete(grant)
    db.delete(member)


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


def workspace_config_owner_user_id(db: Session, user_id: str) -> str:
    membership = _primary_membership(db, user_id)
    if membership is None:
        return user_id
    workspace = db.get(Workspace, membership.workspace_id)
    if workspace and workspace.created_by_user_id:
        created_by_member = db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == membership.workspace_id,
                WorkspaceMember.user_id == workspace.created_by_user_id,
                WorkspaceMember.status == "active",
            )
        )
        if created_by_member is not None:
            return workspace.created_by_user_id
    admin_member = db.scalar(
        select(WorkspaceMember)
        .where(
            WorkspaceMember.workspace_id == membership.workspace_id,
            WorkspaceMember.status == "active",
            WorkspaceMember.role == "admin",
        )
        .order_by(WorkspaceMember.created_at.asc(), WorkspaceMember.id.asc())
    )
    if admin_member is not None:
        return admin_member.user_id
    return membership.user_id


def user_has_workspace_permission(db: Session, user_id: str, permission: str) -> bool:
    membership = _primary_membership(db, user_id)
    if membership is None or membership.status != "active":
        return False
    if membership.role == "admin":
        return True
    return permission in _role_permissions(db, membership.workspace_id, membership.role)


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


def _auth_user_rows(db: Session, user_ids: list[str]) -> dict[str, dict[str, str | None]] | None:
    if not user_ids:
        return {}
    placeholders = ", ".join(f":user_id_{index}" for index in range(len(user_ids)))
    params = {f"user_id_{index}": user_id for index, user_id in enumerate(user_ids)}
    try:
        rows = db.execute(
            text(f'SELECT id, name, email FROM "user" WHERE id IN ({placeholders})'),
            params,
        ).mappings().all()
    except OperationalError:
        return None
    return {
        str(row["id"]): {
            "name": str(row.get("name")) if row.get("name") else None,
            "email": str(row.get("email")) if row.get("email") else None,
        }
        for row in rows
    }
