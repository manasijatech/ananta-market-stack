"""Encrypt/decrypt credential fields at rest (Fernet)."""

from __future__ import annotations

import logging

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

logger = logging.getLogger(__name__)

# Public, fixed dev-only key when ALLOW_INSECURE_DEV_CREDENTIALS=true — never use in production.
_INSECURE_DEV_FERNET_KEY = "utA_Cd56rWF3DrZvK5n9Khp7SkFXI7gtW62lG-JfnMY="


def _fernet() -> Fernet:
    s = get_settings()
    key = s.credential_encryption_key
    if key:
        return Fernet(key.encode() if isinstance(key, str) else key)
    if s.allow_insecure_dev_credentials:
        logger.warning(
            "Using built-in dev Fernet key (ALLOW_INSECURE_DEV_CREDENTIALS). "
            "Set CREDENTIAL_ENCRYPTION_KEY for any shared or production data."
        )
        return Fernet(_INSECURE_DEV_FERNET_KEY.encode("ascii"))
    raise RuntimeError(
        "Set CREDENTIAL_ENCRYPTION_KEY (Fernet key) in the environment, or set "
        "ALLOW_INSECURE_DEV_CREDENTIALS=true only for local development. See AGENTS.md."
    )


_fernet_singleton: Fernet | None = None


def encrypt_value(plain: str) -> str:
    global _fernet_singleton
    if _fernet_singleton is None:
        _fernet_singleton = _fernet()
    return _fernet_singleton.encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_value(cipher_text: str) -> str:
    global _fernet_singleton
    if _fernet_singleton is None:
        _fernet_singleton = _fernet()
    try:
        return _fernet_singleton.decrypt(cipher_text.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise ValueError("Could not decrypt stored credential (wrong key or corrupt data)") from e
