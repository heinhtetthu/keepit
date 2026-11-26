from fastapi import APIRouter, Depends, Request, Response
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.schemas.user import CurrentUser
from app.services import auth as auth_service
from app.models.session import AuthSession
from app.core.config import get_settings
from app.core.exceptions import ForbiddenException, UnauthorizedException
from app.services.throttle import limit

router = APIRouter(prefix="/auth", tags=["auth"])


def _check_origin(request: Request):
    origin = request.headers.get("origin")
    allowed = {o.rstrip("/") for o in get_settings().cors_origins}
    allowed.update({get_settings().FRONTEND_URL.rstrip("/"), str(request.base_url).rstrip("/")})
    if origin and origin.rstrip("/") not in allowed:
        raise ForbiddenException("Untrusted request origin")


def _set_refresh_cookie(response: Response, token: str):
    response.set_cookie(
        "renewly_refresh", token, httponly=True, samesite="strict",
        secure=get_settings().FRONTEND_URL.startswith("https://"),
        max_age=get_settings().REFRESH_TOKEN_EXPIRE_DAYS * 86400, path="/api/v1/auth",
    )
    response.headers["Cache-Control"] = "no-store"


@router.post("/login", response_model=TokenResponse, response_model_exclude_none=True)
async def login(data: LoginRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db, scope="function")):
    _check_origin(request)
    ip = request.headers.get('x-real-ip') if get_settings().TRUST_PROXY_HEADERS else request.client.host
    await limit(db, f'login-ip:{ip}', maximum=100)
    await limit(db, f'login-account:{data.identifier.strip().lower()}', maximum=20)
    tokens = await auth_service.login(db, data)
    _set_refresh_cookie(response, tokens["refresh_token"])
    if request.headers.get('x-renewly-client') == 'browser':
        tokens.pop('refresh_token', None)
    return tokens


@router.post("/refresh", response_model=TokenResponse, response_model_exclude_none=True)
async def refresh(data: RefreshRequest, request: Request, response: Response, db: AsyncSession = Depends(get_db, scope="function")):
    _check_origin(request)
    token = data.refresh_token or request.cookies.get("renewly_refresh")
    if not token:
        raise UnauthorizedException("Refresh token required")
    tokens = await auth_service.refresh_access_token(db, token)
    _set_refresh_cookie(response, tokens["refresh_token"])
    if request.headers.get('x-renewly-client') == 'browser':
        tokens.pop('refresh_token', None)
    return tokens


@router.get("/me", response_model=CurrentUser)
async def me(user=Depends(get_current_user), db: AsyncSession = Depends(get_db, scope="function")):
    from app.services.access import type_access_map
    return CurrentUser(
        record_type_access=await type_access_map(db, user),
        id=user.id, email=user.email, username=user.username, name=user.name, has_avatar=user.has_avatar,
        is_superuser=user.is_superuser,
        permissions=list(user.permissions), roles=[r.name for r in user.roles],
        must_change_password=user.must_change_password,
    )


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    session = await db.get(AuthSession, request.state.session_id) if request.state.session_id else None
    if session:
        session.revoked_at = datetime.now(timezone.utc)
    response.delete_cookie("renewly_refresh", path="/api/v1/auth")
    return {"message": "Logged out"}
