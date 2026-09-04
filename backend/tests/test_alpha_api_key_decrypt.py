from broker.crypto import encrypt_value
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.services import alpha_config
from db.models import User, UserAlphaApiCredential
from db.session import Base


def test_get_alpha_api_key_decrypts_stored_cipher():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add(User(id="owner-1", display_name="Owner"))
    db.add(
        UserAlphaApiCredential(
            user_id="owner-1",
            api_key_cipher=encrypt_value("drishti-test-key-1234"),
            is_enabled=True,
        )
    )
    db.commit()

    assert alpha_config.get_alpha_api_key(db, "owner-1") == "drishti-test-key-1234"
