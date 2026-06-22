from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.deps import get_current_principal
from app.schemas.rbac import (
    BrokerAccountGrantOut,
    BrokerAccountGrantUpdateIn,
    MemberApproveIn,
    MemberRoleUpdateIn,
    PrincipalOut,
    RoleOut,
    SignupStatusOut,
    WorkspaceMemberOut,
    WorkspaceOut,
)
from app.services import rbac as rbac_svc
from db.models import BrokerAccount, BrokerAccountGrant, Role, RolePermission, User
from db.session import get_db

router = APIRouter()


def _auth_user_row(db: Session, user_id: str) -> dict[str, str | None]:
    row = db.execute(
        text('SELECT name, email FROM "user" WHERE id = :user_id'),
        {"user_id": user_id},
    ).mappings().first()
    if row is None:
        return {"name": None, "email": None}
    return {
        "name": str(row.get("name")) if row.get("name") else None,
        "email": str(row.get("email")) if row.get("email") else None,
    }


def _member_label(db: Session, user_id: str) -> tuple[str, str | None]:
    user = db.get(User, user_id)
    auth_user = _auth_user_row(db, user_id)
    label = (user.display_name if user and user.display_name else None) or auth_user["name"] or auth_user["email"] or "Name missing"
    subtitle = auth_user["email"] or ("Ask this user to add their name during signup." if label == "Name missing" else None)
    return label, subtitle


def _principal_out(principal: rbac_svc.Principal) -> PrincipalOut:
    return PrincipalOut(
        user_id=principal.user.id,
        workspace=WorkspaceOut(id=principal.workspace.id, name=principal.workspace.name),
        role=principal.membership.role,
        status=principal.membership.status,
        permissions=sorted(principal.permissions),
        is_admin=principal.is_admin,
    )


def _member_out(db: Session, member) -> WorkspaceMemberOut:
    user = db.get(User, member.user_id)
    auth_user = _auth_user_row(db, member.user_id)
    return WorkspaceMemberOut(
        user_id=member.user_id,
        display_name=user.display_name if user else None,
        auth_name=auth_user["name"],
        email=auth_user["email"],
        role=member.role,
        status=member.status,
        created_at=member.created_at,
        updated_at=member.updated_at,
    )


def _grant_out(db: Session, grant: BrokerAccountGrant) -> BrokerAccountGrantOut:
    try:
        permissions = json.loads(grant.permissions_json or "[]")
    except json.JSONDecodeError:
        permissions = []
    if grant.subject_type == "user":
        subject_label, subject_subtitle = _member_label(db, grant.subject_id)
    else:
        subject_label = grant.subject_id.title()
        subject_subtitle = "Role default"
    return BrokerAccountGrantOut(
        id=grant.id,
        account_id=grant.account_id,
        subject_type=grant.subject_type,
        subject_id=grant.subject_id,
        subject_label=subject_label,
        subject_subtitle=subject_subtitle,
        permissions=[str(item) for item in permissions if isinstance(item, str)],
        created_at=grant.created_at,
        updated_at=grant.updated_at,
    )


@router.get("/signup-status", response_model=SignupStatusOut)
def signup_status(db: Session = Depends(get_db)) -> SignupStatusOut:
    has_admin = bool(
        db.execute(
            text(
                "SELECT 1 FROM workspace_members WHERE role = 'admin' AND status = 'active' LIMIT 1"
            )
        ).first()
    )
    return SignupStatusOut(has_admin=has_admin)


@router.get("/me", response_model=PrincipalOut)
def me(principal: rbac_svc.Principal = Depends(get_current_principal)) -> PrincipalOut:
    return _principal_out(principal)


@router.get("/members", response_model=list[WorkspaceMemberOut])
def list_members(
    db: Session = Depends(get_db),
    principal: rbac_svc.Principal = Depends(get_current_principal),
) -> list[WorkspaceMemberOut]:
    return [_member_out(db, member) for member in rbac_svc.list_members(db, principal)]


@router.post("/members/{user_id}/approve", response_model=WorkspaceMemberOut)
def approve_member(
    user_id: str,
    body: MemberApproveIn,
    db: Session = Depends(get_db),
    principal: rbac_svc.Principal = Depends(get_current_principal),
) -> WorkspaceMemberOut:
    return _member_out(db, rbac_svc.approve_member(db, principal, user_id, body.role))


@router.put("/members/{user_id}/role", response_model=WorkspaceMemberOut)
def update_member_role(
    user_id: str,
    body: MemberRoleUpdateIn,
    db: Session = Depends(get_db),
    principal: rbac_svc.Principal = Depends(get_current_principal),
) -> WorkspaceMemberOut:
    return _member_out(db, rbac_svc.set_member_role(db, principal, user_id, body.role))


@router.post("/members/{user_id}/disable", response_model=WorkspaceMemberOut)
def disable_member(
    user_id: str,
    db: Session = Depends(get_db),
    principal: rbac_svc.Principal = Depends(get_current_principal),
) -> WorkspaceMemberOut:
    return _member_out(db, rbac_svc.disable_member(db, principal, user_id))


@router.get("/roles", response_model=list[RoleOut])
def list_roles(
    db: Session = Depends(get_db),
    principal: rbac_svc.Principal = Depends(get_current_principal),
) -> list[RoleOut]:
    rbac_svc.require_workspace_permission(principal, rbac_svc.WORKSPACE_MANAGE_MEMBERS)
    roles = db.scalars(
        select(Role).where(Role.workspace_id == principal.workspace.id).order_by(Role.name.asc())
    ).all()
    out: list[RoleOut] = []
    for role in roles:
        permissions = [
            row.permission
            for row in db.scalars(
                select(RolePermission).where(RolePermission.role_id == role.id).order_by(RolePermission.permission.asc())
            ).all()
        ]
        out.append(RoleOut(name=role.name, label=role.label, is_builtin=role.is_builtin, permissions=permissions))
    return out


@router.get("/broker-accounts/{account_id}/grants", response_model=list[BrokerAccountGrantOut])
def list_account_grants(
    account_id: str,
    db: Session = Depends(get_db),
    principal: rbac_svc.Principal = Depends(get_current_principal),
) -> list[BrokerAccountGrantOut]:
    rbac_svc.require_workspace_permission(principal, rbac_svc.WORKSPACE_MANAGE_MEMBERS)
    account = db.get(BrokerAccount, account_id)
    if account is None or account.workspace_id != principal.workspace.id:
        raise HTTPException(status_code=404, detail="broker account not found")
    rbac_svc.reconcile_workspace_account_grants(db, principal.workspace.id, account_id=account_id)
    grants = db.scalars(
        select(BrokerAccountGrant)
        .where(BrokerAccountGrant.account_id == account_id)
        .order_by(BrokerAccountGrant.subject_type.asc(), BrokerAccountGrant.subject_id.asc())
    ).all()
    return [_grant_out(db, grant) for grant in grants]


@router.put("/broker-accounts/{account_id}/grants", response_model=BrokerAccountGrantOut)
def upsert_account_grant(
    account_id: str,
    body: BrokerAccountGrantUpdateIn,
    db: Session = Depends(get_db),
    principal: rbac_svc.Principal = Depends(get_current_principal),
) -> BrokerAccountGrantOut:
    account = db.get(BrokerAccount, account_id)
    if account is None or account.workspace_id != principal.workspace.id:
        raise HTTPException(status_code=404, detail="broker account not found")
    rbac_svc.reconcile_workspace_account_grants(db, principal.workspace.id, account_id=account_id)
    grant = rbac_svc.grant_account_permissions(
        db,
        principal=principal,
        account=account,
        subject_type=body.subject_type,
        subject_id=body.subject_id,
        permissions=body.permissions,
    )
    return _grant_out(db, grant)
