from datetime import datetime, timezone, timedelta
from hashlib import sha256
from hmac import compare_digest
from secrets import token_urlsafe

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ForbiddenException, UnauthorizedException
from app.core.security import verify_password, create_access_token, create_refresh_token, decode_token
from app.core.security import hash_password
from app.models.user import User, Role
from app.models.session import AuthSession
from app.core.config import get_settings
from app.schemas.auth import LoginRequest
from app.services.audit import log_audit

_DUMMY_HASH = hash_password('not-a-real-user-password')


async def _load_by_identifier(db: AsyncSession, identifier: str) -> User | None:
    """Match a user by email address OR username (case-insensitive)."""
    ident = identifier.strip().lower()
    result = await db.execute(
        select(User).where(
            (func.lower(User.email) == ident) | (func.lower(User.username) == ident)
        )
        .with_for_update().options(selectinload(User.roles).selectinload(Role.permissions))
    )
    return result.scalar_one_or_none()


async def authenticate_user(db: AsyncSession, data: LoginRequest) -> User:
    user = await _load_by_identifier(db, data.identifier)
    valid = verify_password(data.password, user.hashed_password if user else _DUMMY_HASH)
    if not user or not valid:
        raise UnauthorizedException("Invalid email or password")
    if not user.is_active:
        raise ForbiddenException("User account is deactivated")
    if user.mfa_secret:
        from app.services.mfa import verify
        verify(user, data.otp)
    elif user.is_superuser and get_settings().REQUIRE_ADMIN_MFA:
        raise ForbiddenException('Administrator MFA must be enrolled before enforced login is enabled')
    return user


async def login(db: AsyncSession, data: LoginRequest) -> dict:
    user = await authenticate_user(db, data)
    return await start_session(db, user, "password")


async def start_session(db: AsyncSession, user: User, method: str = "password") -> dict:
    """Issue a new refresh session + token pair (password, passkey, ...)."""
    user.last_login = datetime.now(timezone.utc)
    await db.flush()
    await log_audit(db, "login", "auth", user.id, user.email, user_id=user.id, details=f"User logged in ({method})")
    session = AuthSession(
        id=token_urlsafe(32), user_id=user.id, version=user.session_version,
        expires_at=datetime.now(timezone.utc) + timedelta(days=get_settings().REFRESH_TOKEN_EXPIRE_DAYS),
    )
    tokens = _session_tokens(user, session)
    db.add(session)
    await db.flush()
    return tokens


def _session_tokens(user: User, session: AuthSession, rotate: bool = True) -> dict:
    if rotate:
        session.previous_refresh_hash = session.refresh_hash
        session.refresh_nonce = token_urlsafe(32)
        session.refresh_issued_at = datetime.now(timezone.utc)
    refresh = create_refresh_token(user.id, {
        "sid": session.id, "jti": session.refresh_nonce, "exp": session.expires_at,
        "iat": session.refresh_issued_at.timestamp(),
    })
    session.refresh_hash = sha256(refresh.encode()).hexdigest()
    return {
        "access_token": create_access_token(user.id, {"sid": session.id}),
        "refresh_token": refresh,
        "token_type": "bearer",
    }


async def refresh_access_token(db: AsyncSession, refresh_token: str) -> dict:
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise UnauthorizedException("Invalid refresh token")
    try:
        user_id = int(payload["sub"])
        session_id = str(payload["sid"])
    except (KeyError, ValueError, TypeError):
        raise UnauthorizedException("Invalid refresh token")
    # Use the same user -> session lock order as password changes/logout.
    result = await db.execute(
        select(User).where(User.id == user_id).with_for_update()
        .options(selectinload(User.roles).selectinload(Role.permissions))
    )
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise UnauthorizedException("Invalid refresh token")
    session = (await db.execute(select(AuthSession).where(
        AuthSession.id == session_id, AuthSession.user_id == user_id,
    ).with_for_update())).scalar_one_or_none()
    if (not session or session.revoked_at or session.expires_at <= datetime.now(timezone.utc)
            or session.version != user.session_version):
        raise UnauthorizedException("Session expired or revoked")
    digest = sha256(refresh_token.encode()).hexdigest()
    # Return the same current credential during a short recovery window. A
    # browser may navigate after the server rotates but before it receives the
    # response. Never extend either this window or the absolute session expiry.
    recovering = bool(session.previous_refresh_hash and session.refresh_issued_at
                      and datetime.now(timezone.utc) < session.refresh_issued_at + timedelta(seconds=5))
    current = compare_digest(session.refresh_hash, digest)
    previous = compare_digest(session.previous_refresh_hash or "", digest)
    if not current and not (previous and recovering):
        session.revoked_at = datetime.now(timezone.utc)
        # Persist reuse detection even though the request returns 401.
        await db.commit()
        raise UnauthorizedException("Refresh token reuse detected; sign in again")
    tokens = _session_tokens(user, session, rotate=not recovering)
    await db.flush()
    return tokens
