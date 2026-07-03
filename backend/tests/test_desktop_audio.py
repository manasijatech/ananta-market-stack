import json
from datetime import timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.services import desktop_audio
from db.models import DesktopAudioPairing, User
from db.session import Base


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    return session_factory()


def test_pairing_secret_is_one_time_and_device_token_is_hashed():
    db = _db()
    try:
        db.add(User(id="u1", display_name="User"))
        db.commit()
        pairing = desktop_audio.start_pairing(db, "u1")

        completed = desktop_audio.complete_pairing(
            db,
            pairing_id=pairing["pairing_id"],
            secret=pairing["secret"],
            label="Desk",
            metadata={"platform": "test"},
        )

        assert completed["device_token"]
        device = desktop_audio.authenticate_device(db, completed["device_token"])
        assert device is not None
        assert device.token_hash != completed["device_token"]
        assert json.loads(device.metadata_json)["platform"] == "test"

        try:
            desktop_audio.complete_pairing(
                db,
                pairing_id=pairing["pairing_id"],
                secret=pairing["secret"],
                label="Desk again",
            )
        except ValueError:
            pass
        else:
            raise AssertionError("completed pairing should not be reusable")
    finally:
        db.close()


def test_expired_pairing_cannot_complete():
    db = _db()
    try:
        db.add(User(id="u1", display_name="User"))
        db.commit()
        pairing = desktop_audio.start_pairing(db, "u1")
        row = db.get(DesktopAudioPairing, pairing["pairing_id"])
        row.expires_at = desktop_audio._now() - timedelta(seconds=1)
        db.add(row)
        db.commit()

        try:
            desktop_audio.complete_pairing(
                db,
                pairing_id=pairing["pairing_id"],
                secret=pairing["secret"],
                label="Desk",
            )
        except ValueError as exc:
            assert "expired" in str(exc)
        else:
            raise AssertionError("expired pairing should fail")
    finally:
        db.close()
