from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.services.broker_sessions import _create_notification_once_per_day
from db.models import BrokerNotification
from db.session import Base


def test_unresolved_session_notification_is_not_duplicated():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()

    notification_args = {
        "user_id": "user-1",
        "account_id": "account-1",
        "broker_code": "dhan",
        "kind": "session_refresh_failed",
        "title": "Dhan session failed",
        "message": "Dhan login is not complete.",
        "level": "warning",
    }

    _create_notification_once_per_day(db, **notification_args)
    _create_notification_once_per_day(db, **notification_args)
    db.commit()

    rows = list(db.scalars(select(BrokerNotification)).all())

    assert len(rows) == 1
    assert rows[0].message == "Dhan login is not complete."
    db.close()
