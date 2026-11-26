"""Short DB claims, bounded network concurrency and fenced lease completion.

Ambiguous provider failures have at-least-once semantics; duplicates are possible.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload
from app.core.config import get_settings
from app.db.session import AsyncSessionLocal
from app.models.delivery import ReminderDelivery
from app.models.reminder import ReminderLog, NotificationRecipient, TelegramBot
from app.models.record import Record
from app.models.user import User, Role
from app.services.access import ensure_type_access
from app.core.exceptions import ForbiddenException
from app.services.notification import notification_service


async def enqueue_delivery(db, log, recipient, message):
    bots = [b for b in recipient.bots if b.active]
    if not bots:
        log.status = 'failed'; log.retry_count += 1
        log.error_message = 'No active bot assigned'
        return
    for bot in bots:
        db.add(ReminderDelivery(log_id=log.id, bot_id=bot.id, message=message,
                               available_at=datetime.now(timezone.utc)))
    log.status = 'pending'


async def claim_jobs(limit):
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db, db.begin():
        jobs = (await db.execute(select(ReminderDelivery).where(
            or_(and_(ReminderDelivery.status.in_(['pending', 'retry']), ReminderDelivery.available_at <= now),
                and_(ReminderDelivery.status == 'processing', ReminderDelivery.leased_until < now)),
        ).order_by(ReminderDelivery.available_at, ReminderDelivery.id).with_for_update(skip_locked=True).limit(limit))).scalars().all()
        claims = []
        for job in jobs:
            job.status = 'processing'; job.claim_token = token_urlsafe(24)
            job.leased_until = now + timedelta(seconds=120)
            job.attempts += 1
            claims.append((job.id, job.claim_token))
        return claims


async def deliver_claim(job_id, claim):
    settings = get_settings()
    async with AsyncSessionLocal() as db:
        job = await db.get(ReminderDelivery, job_id)
        if not job or job.claim_token != claim or job.status != 'processing': return (0, 0)
        log_id = job.log_id
        log = await db.get(ReminderLog, log_id)
        recipient = (await db.execute(select(NotificationRecipient).where(
            NotificationRecipient.id == log.recipient_id,
        ).options(selectinload(NotificationRecipient.bots),
                  selectinload(NotificationRecipient.user).selectinload(User.roles).selectinload(Role.permissions)))).scalar_one_or_none()
        bot = await db.get(TelegramBot, job.bot_id) if job.bot_id else None
        record = await db.get(Record, log.record_id)
        permitted = bool(recipient and recipient.active and recipient.user and recipient.user.is_active
                         and (recipient.user.is_superuser or 'record.view' in recipient.user.permissions)
                         and bot and bot.active and bot.id in [b.id for b in recipient.bots]
                         and record and not record.archived and not record.deleted_at)
        if permitted:
            try: await ensure_type_access(db, recipient.user, record.record_type_id)
            except ForbiddenException: permitted = False
        payload = (recipient.telegram_chat_id, job.message, bot.bot_token) if permitted else None
    # No connection or DB transaction remains open while waiting for Telegram.
    ok = False
    error = 'Recipient, bot or record is no longer eligible'
    if payload:
        try:
            ok, error = await notification_service.send('telegram', *payload)
        except Exception:
            error = 'Provider call failed; delivery will be retried'
    async with AsyncSessionLocal() as db, db.begin():
        log = (await db.execute(select(ReminderLog).where(ReminderLog.id == log_id).with_for_update())).scalar_one_or_none()
        job = (await db.execute(select(ReminderDelivery).where(ReminderDelivery.id == job_id).with_for_update())).scalar_one_or_none()
        if not log or not job or job.claim_token != claim or job.status != 'processing': return (0, 0)
        job.error = error
        job.claim_token = None; job.leased_until = None
        job.status = 'cancelled' if not payload else 'sent' if ok else 'failed' if job.attempts > settings.WORKER_MAX_RETRIES else 'retry'
        if job.status == 'retry':
            job.available_at = datetime.now(timezone.utc) + timedelta(seconds=settings.WORKER_RETRY_DELAY_SECONDS * 2 ** min(job.attempts - 1, 10))
        await db.flush()
        statuses = (await db.execute(select(ReminderDelivery.status).where(ReminderDelivery.log_id == log_id))).scalars().all()
        log.retry_count = max(log.retry_count, max(0, job.attempts - 1)); log.error_message = error
        if any(s in ('pending', 'retry', 'processing') for s in statuses): log.status = 'pending'
        elif all(s == 'sent' for s in statuses):
            log.status = 'sent'; log.sent_at = datetime.now(timezone.utc); log.error_message = None
        else: log.status = 'failed'
    return (int(bool(payload and ok)), int(bool(payload and not ok)))


async def dispatch_deliveries():
    settings = get_settings()
    remaining = settings.WORKER_BATCH_SIZE; sent = failed = 0
    while remaining > 0:
        claims = await claim_jobs(min(remaining, max(1, min(settings.DELIVERY_CONCURRENCY, 16))))
        if not claims: break
        outcomes = await asyncio.gather(*(deliver_claim(*claim) for claim in claims))
        sent += sum(x[0] for x in outcomes); failed += sum(x[1] for x in outcomes)
        remaining -= len(claims)
    return {'delivered': sent, 'delivery_failures': failed}
