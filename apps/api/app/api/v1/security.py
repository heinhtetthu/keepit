from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from fastapi import APIRouter, Depends, Response, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.core.exceptions import ForbiddenException, ValidationException
from app.core.security import verify_password
from app.services import mfa
from app.services.encryption import encrypt, decrypt
from app.services.audit import log_audit
from app.services.throttle import limit

router = APIRouter(prefix='/security', tags=['security'])


@router.get('/audit-integrity')
async def audit_integrity(db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    if not user.is_superuser:
        raise ForbiddenException('Administrator access required')
    from app.models.audit import AuditLog
    from app.services.audit import intact
    rows = (await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(1000))).scalars().all()
    return {'checked': len(rows), 'unsigned_historical': sum(r.integrity is None for r in rows),
            'invalid_ids': [r.id for r in rows if r.integrity and not intact(r)],
            'scope': 'Latest 1,000 entries. Payload changes are detected; deletions require comparison with independently retained backups. Historical unsigned entries cannot be authenticated.'}


class Verify(BaseModel):
    password: str = Field(min_length=1, max_length=1024)
    code: str = Field(default='', max_length=128)


async def checked_user(db, user, password):
    await limit(db, f'step-up:{user.id}', maximum=10)
    locked = (await db.execute(select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
    if not verify_password(password, locked.hashed_password):
        raise ForbiddenException('Password verification failed')
    return locked


@router.get('/mfa')
async def status(response: Response, user=Depends(get_current_user)):
    response.headers['Cache-Control'] = 'no-store'
    return {'enabled': bool(user.mfa_secret)}


@router.post('/mfa/setup')
async def setup(data: Verify, response: Response, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    user = await checked_user(db, user, data.password)
    if user.mfa_secret:
        raise ValidationException('MFA is already enabled')
    secret = mfa.new_secret()
    user.mfa_pending_secret = encrypt(secret)
    user.mfa_pending_at = datetime.now(timezone.utc)
    response.headers['Cache-Control'] = 'no-store'
    await log_audit(db, 'mfa.setup', 'user', user.id, user_id=user.id)
    return {'secret': secret, 'uri': f'otpauth://totp/{quote("Keepit:" + user.email, safe="")}?secret={secret}&issuer=Keepit&algorithm=SHA1&digits=6&period=30'}


@router.post('/mfa/enable')
async def enable(data: Verify, response: Response, request: Request, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    user = await checked_user(db, user, data.password)
    if not user.mfa_pending_secret or not user.mfa_pending_at or user.mfa_pending_at < datetime.now(timezone.utc) - timedelta(minutes=10):
        raise ValidationException('Enrollment expired. Start again.')
    step = mfa.matched_step(decrypt(user.mfa_pending_secret), data.code)
    if step is None:
        raise ValidationException('Authenticator code did not match')
    user.mfa_secret, user.mfa_pending_secret = user.mfa_pending_secret, None
    user.mfa_pending_at, user.mfa_last_step = None, step
    codes, user.mfa_recovery_hashes = mfa.recovery_codes()
    from app.models.session import AuthSession
    from sqlalchemy import update
    await db.execute(update(AuthSession).where(AuthSession.user_id == user.id, AuthSession.id != request.state.session_id).values(revoked_at=datetime.now(timezone.utc)))
    response.headers['Cache-Control'] = 'no-store'
    await log_audit(db, 'mfa.enable', 'user', user.id, user_id=user.id)
    return {'enabled': True, 'recovery_codes': codes}


@router.post('/mfa/disable')
async def disable(data: Verify, request: Request, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    from app.core.config import get_settings
    if user.is_superuser and get_settings().REQUIRE_ADMIN_MFA:
        raise ForbiddenException('Administrator MFA is enforced and cannot be disabled')
    user = await checked_user(db, user, data.password)
    if user.mfa_secret:
        mfa.verify(user, data.code)
    user.mfa_secret = user.mfa_pending_secret = user.mfa_recovery_hashes = None
    user.mfa_pending_at = user.mfa_last_step = None
    from app.models.session import AuthSession
    from sqlalchemy import update
    await db.execute(update(AuthSession).where(AuthSession.user_id == user.id, AuthSession.id != request.state.session_id).values(revoked_at=datetime.now(timezone.utc)))
    await log_audit(db, 'mfa.disable', 'user', user.id, user_id=user.id)
    return {'enabled': False}
