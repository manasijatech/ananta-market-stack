from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.services import rbac
from db.models import User, Workspace, WorkspaceMember
from db.session import Base


def test_bootstrap_membership_makes_first_user_admin():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    user = User(id="user-1", display_name="First User")
    db.add(user)
    db.commit()

    principal = rbac.ensure_principal(db, user)

    assert principal.membership.role == "admin"
    assert principal.membership.status == "active"
    assert principal.is_admin is True
    db.close()


def test_bootstrap_membership_makes_second_user_pending_when_admin_exists():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()

    workspace = Workspace(id="workspace-1", name="Primary")
    db.add(workspace)
    db.add(
        WorkspaceMember(
            id="member-1",
            workspace_id=workspace.id,
            user_id="admin-user",
            role="admin",
            status="active",
        )
    )
    db.add(User(id="admin-user", display_name="Admin"))
    second_user = User(id="user-2", display_name="Second User")
    db.add(second_user)
    db.commit()

    principal = rbac.ensure_principal(db, second_user)

    assert principal.membership.role == "pending"
    assert principal.membership.status == "pending"
    assert principal.is_admin is False
    db.close()


def test_repair_installation_without_admin_promotes_pending_member():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()

    workspace = Workspace(id="workspace-1", name="Primary")
    db.add(workspace)
    db.add(
        WorkspaceMember(
            id="member-1",
            workspace_id=workspace.id,
            user_id="user-1",
            role="pending",
            status="pending",
        )
    )
    db.add(User(id="user-1", display_name="Only User"))
    db.commit()

    repaired = rbac.repair_installation_without_admin(db)
    member = db.get(WorkspaceMember, "member-1")

    assert repaired == 1
    assert member is not None
    assert member.role == "admin"
    assert member.status == "active"
    db.close()


def test_repair_installation_without_admin_promotes_only_oldest_pending_member():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()

    workspace = Workspace(id="workspace-1", name="Primary")
    db.add(workspace)
    db.add(User(id="user-1", display_name="Only User"))
    db.add(User(id="user-2", display_name="Second User"))
    db.add(
        WorkspaceMember(
            id="member-1",
            workspace_id=workspace.id,
            user_id="user-1",
            role="pending",
            status="pending",
        )
    )
    db.add(
        WorkspaceMember(
            id="member-2",
            workspace_id=workspace.id,
            user_id="user-2",
            role="pending",
            status="pending",
        )
    )
    db.commit()

    repaired = rbac.repair_installation_without_admin(db)
    first_member = db.get(WorkspaceMember, "member-1")
    second_member = db.get(WorkspaceMember, "member-2")

    assert repaired == 1
    assert first_member is not None
    assert first_member.role == "admin"
    assert first_member.status == "active"
    assert second_member is not None
    assert second_member.role == "pending"
    assert second_member.status == "pending"
    db.close()


def test_repair_orphaned_admin_access_upgrades_pending_user_without_admin():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()

    workspace = Workspace(id="workspace-1", name="Primary")
    db.add(workspace)
    db.add(
        WorkspaceMember(
            id="member-1",
            workspace_id=workspace.id,
            user_id="user-1",
            role="pending",
            status="pending",
        )
    )
    user = User(id="user-1", display_name="Only User")
    db.add(user)
    db.commit()

    principal = rbac.ensure_principal(db, user)

    assert principal.membership.role == "admin"
    assert principal.membership.status == "active"
    assert principal.is_admin is True
    db.close()


def test_remove_member_deletes_workspace_membership():
    from sqlalchemy import func, select

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()

    workspace = Workspace(id="workspace-1", name="Primary")
    db.add(workspace)
    admin_user = User(id="admin-user", display_name="Admin")
    member_user = User(id="member-user", display_name="Member")
    db.add(admin_user)
    db.add(member_user)
    db.add(
        WorkspaceMember(
            id="member-admin",
            workspace_id=workspace.id,
            user_id=admin_user.id,
            role="admin",
            status="active",
        )
    )
    db.add(
        WorkspaceMember(
            id="member-user-row",
            workspace_id=workspace.id,
            user_id=member_user.id,
            role="viewer",
            status="active",
        )
    )
    db.commit()

    principal = rbac.Principal(
        user=admin_user,
        workspace=workspace,
        membership=db.get(WorkspaceMember, "member-admin"),
        permissions=frozenset(),
    )
    rbac.remove_member(db, principal, member_user.id)

    assert db.scalar(select(func.count()).select_from(WorkspaceMember)) == 1
    db.close()


def test_reconcile_workspace_members_removes_orphan_members():
    from sqlalchemy import func, select, text

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    db.execute(
        text(
            'CREATE TABLE "user" ('
            'id TEXT PRIMARY KEY, name TEXT, email TEXT, '
            '"emailVerified" INTEGER, "createdAt" TEXT, "updatedAt" TEXT)'
        )
    )

    workspace = Workspace(id="workspace-1", name="Primary")
    db.add(workspace)
    db.add(
        WorkspaceMember(
            id="member-orphan",
            workspace_id=workspace.id,
            user_id="missing-auth-user",
            role="pending",
            status="disabled",
        )
    )
    db.commit()

    rbac.reconcile_workspace_members(db, workspace.id)

    assert db.scalar(select(func.count()).select_from(WorkspaceMember)) == 0
    db.close()
