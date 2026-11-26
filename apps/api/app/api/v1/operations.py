from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import require_permission, require_superuser
from app.db.session import get_db
from app.models.delivery import ReminderDelivery
from app.models.reminder import ReminderLog
from app.models.record import Record
from app.services.access import allowed_type_ids
from app.services.operations import worker_status, backup_status
from app.core.config import get_settings

router = APIRouter(prefix='/operations', tags=['operations'])


@router.get('/notifications')
async def notification_health(db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission('notification.view'))):
    allowed = await allowed_type_ids(db, user)
    scope = [] if allowed is None else [Record.record_type_id.in_(allowed)]
    jobs = select(ReminderDelivery.status, func.count().label('count')).join(ReminderLog, ReminderLog.id == ReminderDelivery.log_id).join(Record, Record.id == ReminderLog.record_id).where(*scope).group_by(ReminderDelivery.status)
    counts = {r.status: r.count for r in (await db.execute(jobs)).all()}
    oldest = (await db.execute(select(func.min(ReminderDelivery.available_at)).join(ReminderLog, ReminderLog.id == ReminderDelivery.log_id).join(Record, Record.id == ReminderLog.record_id).where(
        ReminderDelivery.status.in_(['pending', 'retry', 'processing']), *scope))).scalar()
    age = max(0, (datetime.now(timezone.utc) - oldest).total_seconds()) if oldest else 0
    workers = await worker_status(db)
    attention = []
    if not all(w['healthy'] for w in workers.values()): attention.append('Worker is stale or reporting a failure. Ask an administrator to inspect the worker service.')
    if age > 900: attention.append('Deliveries have been waiting over 15 minutes. Check Telegram connectivity and queue throughput.')
    if counts.get('failed'): attention.append('Some deliveries exhausted retries. Review notification logs before retrying to avoid duplicate messages.')
    return {'workers': workers, 'counts': counts, 'oldest_due_age_seconds': round(age), 'attention': attention,
            'scope': 'Only your permitted record types are included in delivery counts.',
            'semantics': 'Delivery is at least once. A provider timeout can cause a duplicate on retry.'}


@router.get('/security')
async def security_health(db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_superuser)):
    from app.models.user import User
    from app.core.security import verify_password
    admins = (await db.execute(select(User).where(User.is_superuser == True, User.is_active == True))).scalars().all()
    settings = get_settings()
    warnings = []
    if any(verify_password('admin12345', a.hashed_password) for a in admins): warnings.append('An administrator still uses the bootstrap password. Change it in My Account.')
    if any(not a.mfa_secret for a in admins): warnings.append('One or more administrators have not enrolled an authenticator.')
    if not settings.FRONTEND_URL.startswith('https://'): warnings.append('Local HTTP is enabled. Configure HTTPS before exposing this installation outside the trusted machine/network.')
    if not settings.DATA_ENCRYPTION_KEYS: warnings.append('Data encryption keys are not configured.')
    backup = backup_status()
    try:
        backup_age = (datetime.now(timezone.utc) - datetime.fromisoformat(backup.get('last_success'))).total_seconds()
        verify_age = (datetime.now(timezone.utc) - datetime.fromisoformat(backup.get('last_restore_verified'))).total_seconds()
    except (ValueError, TypeError): backup_age = verify_age = None
    if backup.get('error') or backup_age is None or backup_age > 172800: warnings.append('A successful encrypted backup is missing, failed or older than two days.')
    if verify_age is None or verify_age > 604800: warnings.append('A verified restore is missing or older than seven days.')
    return {'warnings': warnings, 'backup': backup, 'environment': settings.APP_ENV,
            'admin_mfa_enforced': settings.REQUIRE_ADMIN_MFA, 'data_encryption_configured': bool(settings.DATA_ENCRYPTION_KEYS)}
