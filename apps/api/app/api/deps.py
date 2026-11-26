from fastapi import Depends, Request
from datetime import datetime, timezone
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import UnauthorizedException, ForbiddenException, NotFoundException
from app.core.security import decode_token
from app.db.session import get_db, set_rls_context
from app.models.user import User
from app.models.session import AuthSession
from app.services.user import get_user
from app.services.actor import current_actor

security = HTTPBearer(auto_error=False)
API_TOKEN_PREFIX = "rnw_"


async def _api_token_user(request: Request, token: str, db: AsyncSession) -> User:
    """Long-lived service tokens (MCP server, integrations). Acts as the owning user."""
    from hashlib import sha256
    from sqlalchemy import select
    from app.models.credentials import ApiToken
    row = (await db.execute(select(ApiToken).where(ApiToken.token_hash == sha256(token.encode()).hexdigest()))).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        raise UnauthorizedException("Invalid API token")
    try:
        user = await get_user(db, row.user_id)
    except NotFoundException:
        raise UnauthorizedException("Invalid API token")
    if not user.is_active:
        raise ForbiddenException("User account is deactivated")
    now = datetime.now(timezone.utc)
    if row.last_used_at is None or (now - row.last_used_at).total_seconds() > 300:
        row.last_used_at = now
    request.state.session_id = None
    request.state.api_token_id = row.id
    current_actor.set(user.id)
    await set_rls_context(db, user)
    return user


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> User:
    token = None
    if credentials:
        token = credentials.credentials
    else:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise UnauthorizedException("Authentication required")
    if token.startswith(API_TOKEN_PREFIX):
        return await _api_token_user(request, token, db)
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise UnauthorizedException("Invalid token")
    try:
        user_id = int(payload["sub"])
        session_id = str(payload["sid"])
    except (KeyError, ValueError, TypeError):
        raise UnauthorizedException("Invalid token")
    try:
        user = await get_user(db, user_id)
    except NotFoundException:
        raise UnauthorizedException("Session expired or revoked")
    session = await db.get(AuthSession, session_id)
    if (not session or session.user_id != user.id or session.revoked_at
            or session.expires_at <= datetime.now(timezone.utc)
            or session.version != user.session_version):
        raise UnauthorizedException("Session expired or revoked")
    request.state.session_id = session_id
    current_actor.set(user.id)
    if not user.is_active:
        raise ForbiddenException("User account is deactivated")
    await set_rls_context(db, user)
    # A dedicated version revokes sessions independently of incidental profile timestamps.
    return user


def require_permission(permission: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.is_superuser:
            return user
        if permission not in user.permissions:
            raise ForbiddenException(f"Missing permission: {permission}")
        return user
    return checker


def require_superuser(user: User = Depends(get_current_user)) -> User:
    """System-admin-only access (bypasses role permissions entirely)."""
    if not user.is_superuser:
        raise ForbiddenException("System admin access required")
    return user


def require_any_permission(*permissions: str):
    """Pass if the user holds at least one of the permissions (shared screens
    such as the employee directory serve both renewal and asset staff)."""
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.is_superuser or any(p in user.permissions for p in permissions):
            return user
        raise ForbiddenException(f"Missing permission: one of {', '.join(permissions)}")
    return checker


def has_permission(user: User, permission: str) -> bool:
    return user.is_superuser or permission in user.permissions
