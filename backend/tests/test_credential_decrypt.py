from broker.crypto import decrypt_value_or_none


def test_decrypt_value_or_none_returns_none_for_missing_or_corrupt_cipher():
    assert decrypt_value_or_none(None) is None
    assert decrypt_value_or_none("") is None
    assert decrypt_value_or_none("not-a-fernet-token") is None
