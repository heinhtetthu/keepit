"""Passkeys (WebAuthn), self-service password reset, and personal API tokens."""
import base64
import json
import secrets
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from html import escape

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from webauthn import (generate_authentication_options, generate_registration_options, options_to_json,
                      verify_authentication_response, verify_registration_response)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
                                      ResidentKeyRequirement, UserVerificationRequirement)

from app.api.deps import API_TOKEN_PREFIX, get_current_user
from app.api.v1.auth import _check_origin, _set_refresh_cookie
from app.core.config import get_settings
from app.core.exceptions import NotFoundException, UnauthorizedException, ValidationException
from app.core.security import hash_password
from app.db.session import get_db
from app.models.credentials import ApiToken, PasswordResetToken, WebAuthnChallenge, WebAuthnCredential
from app.models.user import Role, User
from app.schemas.auth import TokenResponse
from app.services import auth as auth_service
from app.services.audit import log_audit
from app.services.email import send_email
from app.services.throttle import limit

router = APIRouter(tags=["account"])
DB = Depends(get_db, scope="function")


def _origins() -> list[str]:
    return [o.strip().rstrip("/") for o in get_settings().WEBAUTHN_ORIGINS.split(",") if o.strip()]


async def _store_challenge(db: AsyncSession, purpose: str, challenge: bytes, user_id: int | None) -> str:
    await db.execute(delete(WebAuthnChallenge).where(WebAuthnChallenge.expires_at < datetime.now(timezone.utc)))
    cid = secrets.token_urlsafe(24)
    db.add(WebAuthnChallenge(id=cid, user_id=user_id, purpose=purpose, challenge=bytes_to_base64url(challenge),
                             expires_at=datetime.now(timezone.utc) + timedelta(minutes=5)))
    await db.flush()
    return cid


async def _take_challenge(db: AsyncSession, cid: str, purpose: str) -> WebAuthnChallenge:
    ch = await db.get(WebAuthnChallenge, cid)
    if ch is None or ch.purpose != purpose or ch.expires_at < datetime.now(timezone.utc):
        raise UnauthorizedException("Passkey challenge expired; try again")
    await db.delete(ch)
    return ch


# ------------------------------------------------------------------ passkeys
class PasskeyVerify(BaseModel):
    challenge_id: str
    credential: dict
    name: str | None = Field(default=None, max_length=100)


@router.post("/passkeys/register/options")
async def passkey_register_options(db: AsyncSession = DB, user: User = Depends(get_current_user)):
    s = get_settings()
    existing = (await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id))).scalars().all()
    opts = generate_registration_options(
        rp_id=s.WEBAUTHN_RP_ID, rp_name=s.WEBAUTHN_RP_NAME or s.APP_NAME, user_id=str(user.id).encode(),
        user_name=user.email, user_display_name=user.name,
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id)) for c in existing],
        authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.PREFERRED,
                                                               user_verification=UserVerificationRequirement.PREFERRED))
    cid = await _store_challenge(db, "register", opts.challenge, user.id)
    return {"challenge_id": cid, "options": json.loads(options_to_json(opts))}


@router.post("/passkeys/register/verify")
async def passkey_register_verify(data: PasskeyVerify, db: AsyncSession = DB, user: User = Depends(get_current_user)):
    ch = await _take_challenge(db, data.challenge_id, "register")
    if ch.user_id != user.id:
        raise UnauthorizedException("Challenge does not belong to you")
    try:
        v = verify_registration_response(credential=data.credential, expected_challenge=base64url_to_bytes(ch.challenge),
                                         expected_rp_id=get_settings().WEBAUTHN_RP_ID, expected_origin=_origins())
    except Exception as exc:  # library raises several specific types
        raise ValidationException(f"Passkey registration failed: {exc}")
    cred = WebAuthnCredential(user_id=user.id, credential_id=bytes_to_base64url(v.credential_id),
                              public_key=bytes_to_base64url(v.credential_public_key), sign_count=v.sign_count,
                              transports=data.credential.get("response", {}).get("transports", []) or [],
                              name=(data.name or "Passkey").strip()[:100])
    db.add(cred)
    await db.flush()
    await log_audit(db, "passkey.create", "user", user.id, user.email, user_id=user.id, details=cred.name)
    return {"id": cred.id, "name": cred.name, "created_at": cred.created_at}


@router.get("/passkeys")
async def list_passkeys(db: AsyncSession = DB, user: User = Depends(get_current_user)):
    rows = (await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.user_id == user.id)
                             .order_by(WebAuthnCredential.created_at))).scalars().all()
    return [{"id": r.id, "name": r.name, "created_at": r.created_at, "last_used_at": r.last_used_at} for r in rows]


@router.delete("/passkeys/{passkey_id}", status_code=204)
async def delete_passkey(passkey_id: int, db: AsyncSession = DB, user: User = Depends(get_current_user)):
    row = await db.get(WebAuthnCredential, passkey_id)
    if row is None or row.user_id != user.id:
        raise NotFoundException("Passkey not found")
    await db.delete(row)
    await log_audit(db, "passkey.delete", "user", user.id, user.email, user_id=user.id, details=row.name)


@router.post("/auth/passkey/options")
async def passkey_login_options(request: Request, db: AsyncSession = DB):
    """Discoverable-credential login: the browser offers the user's passkeys."""
    _check_origin(request)
    opts = generate_authentication_options(rp_id=get_settings().WEBAUTHN_RP_ID,
                                           user_verification=UserVerificationRequirement.PREFERRED)
    cid = await _store_challenge(db, "login", opts.challenge, None)
    return {"challenge_id": cid, "options": json.loads(options_to_json(opts))}


@router.post("/auth/passkey/verify", response_model=TokenResponse, response_model_exclude_none=True)
async def passkey_login_verify(data: PasskeyVerify, request: Request, response: Response, db: AsyncSession = DB):
    _check_origin(request)
    ip = request.client.host if request.client else "unknown"
    await limit(db, f"passkey-ip:{ip}", maximum=100)
    ch = await _take_challenge(db, data.challenge_id, "login")
    cred = (await db.execute(select(WebAuthnCredential).where(WebAuthnCredential.credential_id == data.credential.get("id"))
                             .with_for_update())).scalar_one_or_none()
    if cred is None:
        raise UnauthorizedException("Unknown passkey")
    try:
        v = verify_authentication_response(credential=data.credential, expected_challenge=base64url_to_bytes(ch.challenge),
                                           expected_rp_id=get_settings().WEBAUTHN_RP_ID, expected_origin=_origins(),
                                           credential_public_key=base64url_to_bytes(cred.public_key),
                                           credential_current_sign_count=cred.sign_count)
    except Exception:
        raise UnauthorizedException("Passkey verification failed")
    cred.sign_count, cred.last_used_at = v.new_sign_count, datetime.now(timezone.utc)
    user = (await db.execute(select(User).where(User.id == cred.user_id).with_for_update()
                             .options(selectinload(User.roles).selectinload(Role.permissions)))).scalar_one()
    if not user.is_active:
        raise UnauthorizedException("User account is deactivated")
    tokens = await auth_service.start_session(db, user, "passkey")
    _set_refresh_cookie(response, tokens["refresh_token"])
    if request.headers.get("x-renewly-client") == "browser":
        tokens.pop("refresh_token", None)
    return tokens


# ------------------------------------------------------------------ password reset
class ResetRequest(BaseModel):
    email: EmailStr


class ResetConfirm(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=255)


@router.post("/auth/password-reset/request")
async def request_password_reset(data: ResetRequest, request: Request, db: AsyncSession = DB):
    """Always answers the same way so it cannot reveal which emails exist."""
    _check_origin(request)
    ip = request.client.host if request.client else "unknown"
    await limit(db, f"reset-ip:{ip}", maximum=20)
    await limit(db, f"reset-account:{data.email.lower()}", maximum=5)
    s = get_settings()
    user = (await db.execute(select(User).where(func.lower(User.email) == data.email.lower()))).scalar_one_or_none()
    if user and user.is_active:
        raw = secrets.token_urlsafe(32)
        await db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
        db.add(PasswordResetToken(user_id=user.id, token_hash=sha256(raw.encode()).hexdigest(),
                                  expires_at=datetime.now(timezone.utc) + timedelta(minutes=s.PASSWORD_RESET_TTL_MINUTES)))
        link = f"{s.FRONTEND_URL.rstrip('/')}/reset-password?token={raw}"
        await send_email(user.email, f"Reset your {s.APP_NAME} password",
                         f"<p>Hi {escape(user.name)},</p><p><a href=\"{escape(link)}\">Choose a new password</a>. "
                         f"The link expires in {s.PASSWORD_RESET_TTL_MINUTES} minutes.</p>"
                         "<p>If you did not ask for this, ignore this email.</p>",
                         f"Reset your password: {link}\nThe link expires in {s.PASSWORD_RESET_TTL_MINUTES} minutes.")
        await log_audit(db, "password_reset.request", "user", user.id, user.email, user_id=user.id)
    return {"message": "If that email has an account, a reset link is on its way."}


@router.post("/auth/password-reset/confirm")
async def confirm_password_reset(data: ResetConfirm, request: Request, db: AsyncSession = DB):
    _check_origin(request)
    row = (await db.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == sha256(data.token.encode()).hexdigest())
                            .with_for_update())).scalar_one_or_none()
    if row is None or row.used_at or row.expires_at < datetime.now(timezone.utc):
        raise ValidationException("This reset link is invalid or has expired")
    user = await db.get(User, row.user_id)
    user.hashed_password = hash_password(data.password)
    user.must_change_password = False
    user.session_version += 1  # sign out everywhere
    row.used_at = datetime.now(timezone.utc)
    await log_audit(db, "password_reset.confirm", "user", user.id, user.email, user_id=user.id)
    return {"message": "Password updated. Sign in with your new password."}


# ------------------------------------------------------------------ API tokens
class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


@router.get("/api-tokens")
async def list_tokens(db: AsyncSession = DB, user: User = Depends(get_current_user)):
    rows = (await db.execute(select(ApiToken).where(ApiToken.user_id == user.id, ApiToken.revoked_at.is_(None))
                             .order_by(ApiToken.created_at.desc()))).scalars().all()
    return [{"id": r.id, "name": r.name, "prefix": r.prefix, "created_at": r.created_at, "last_used_at": r.last_used_at} for r in rows]


@router.post("/api-tokens", status_code=201)
async def create_token(data: TokenCreate, db: AsyncSession = DB, user: User = Depends(get_current_user)):
    """The token acts with this user's permissions. It is shown once."""
    raw = API_TOKEN_PREFIX + base64.urlsafe_b64encode(secrets.token_bytes(30)).decode().rstrip("=")
    row = ApiToken(user_id=user.id, name=data.name.strip(), token_hash=sha256(raw.encode()).hexdigest(), prefix=raw[:12])
    db.add(row)
    await db.flush()
    await log_audit(db, "api_token.create", "user", user.id, user.email, user_id=user.id, details=row.name)
    return {"id": row.id, "name": row.name, "prefix": row.prefix, "token": raw}


@router.delete("/api-tokens/{token_id}", status_code=204)
async def revoke_token(token_id: int, db: AsyncSession = DB, user: User = Depends(get_current_user)):
    row = await db.get(ApiToken, token_id)
    if row is None or row.user_id != user.id:
        raise NotFoundException("Token not found")
    row.revoked_at = datetime.now(timezone.utc)
    await log_audit(db, "api_token.revoke", "user", user.id, user.email, user_id=user.id, details=row.name)
