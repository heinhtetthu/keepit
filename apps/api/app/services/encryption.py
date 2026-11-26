"""Versioned authenticated encryption. First key writes; remaining keys read old data."""
from cryptography.fernet import Fernet, MultiFernet
from app.core.config import get_settings

PREFIX = 'enc:v1:'


def cipher():
    keys = [k.strip().encode() for k in get_settings().DATA_ENCRYPTION_KEYS.split(',') if k.strip()]
    if not keys:
        raise ValueError('DATA_ENCRYPTION_KEYS is required for encrypted data')
    return MultiFernet([Fernet(k) for k in keys])


def encrypt(value: str) -> str:
    if value.startswith(PREFIX):
        # Validate existing ciphertext instead of double-encrypting or trusting a prefix.
        decrypt(value)
        return value
    return PREFIX + cipher().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    return cipher().decrypt(value[len(PREFIX):].encode()).decode() if value.startswith(PREFIX) else value
