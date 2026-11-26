import base64
import hashlib
import hmac
import json
import secrets
import struct
import time

from app.core.exceptions import AppException
from app.services.encryption import decrypt


def new_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip('=')


def totp(secret, step, digits=6):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8))
    digest = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return str((struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % (10 ** digits)).zfill(digits)


def matched_step(secret, code, now=None):
    step = int((time.time() if now is None else now) // 30)
    return next((s for s in range(step - 1, step + 2) if s >= 0 and hmac.compare_digest(totp(secret, s), code)), None)


def verify(user, code):
    if not code:
        raise AppException('MFA_REQUIRED', 'Enter your authenticator code or a recovery code.', 401)
    hashes = json.loads(user.mfa_recovery_hashes or '[]')
    digest = hashlib.sha256(code.strip().encode()).hexdigest()
    recovery = next((value for value in hashes if hmac.compare_digest(value, digest)), None)
    if recovery:
        hashes.remove(recovery)
        user.mfa_recovery_hashes = json.dumps(hashes)
        return
    step = matched_step(decrypt(user.mfa_secret), code.strip())
    if step is None or (user.mfa_last_step is not None and step <= user.mfa_last_step):
        raise AppException('MFA_INVALID', 'Invalid or already-used authenticator code.', 401)
    user.mfa_last_step = step


def recovery_codes():
    codes = [secrets.token_urlsafe(12) for _ in range(8)]
    return codes, json.dumps([hashlib.sha256(c.encode()).hexdigest() for c in codes])
