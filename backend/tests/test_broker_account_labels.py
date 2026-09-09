import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.schemas.broker import IndmoneyCreate
from app.services.broker_accounts import create_broker_account
from db.models import BrokerAccount, User, Workspace
from db.session import Base


def _db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


def test_create_rejects_duplicate_workspace_broker_label():
    db = _db()
    db.add(User(id="user-1", display_name="Owner"))
    db.add(Workspace(id="workspace-1", name="Default"))
    db.commit()
    db.add(
        BrokerAccount(
            id="existing-indmoney",
            workspace_id="workspace-1",
            user_id="user-1",
            broker_code="indmoney",
            label="INDmoney main",
            is_active=True,
        )
    )
    db.commit()

    with pytest.raises(ValueError, match="already exists"):
        create_broker_account(
            db,
            "user-1",
            IndmoneyCreate(label="indmoney main", access_token="token"),
            workspace_id="workspace-1",
        )
