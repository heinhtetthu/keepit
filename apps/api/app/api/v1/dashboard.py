from datetime import datetime, timezone, timedelta
import asyncio
import json

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_permission
from app.services import access as access_service
from app.services.clock import app_today
from app.db.session import get_db
from app.models.record import Record, RecordValue
from app.models.record_type import RecordType
from app.services.date_query import field_date
from app.services import query_cache

router = APIRouter(tags=["dashboard"])
_dashboard_slot = asyncio.Lock()


def _parse_date(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


@router.get("/dashboard")
async def dashboard_stats(db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.view"))):
    allowed = await access_service.allowed_type_ids(db, user)
    key = 'dashboard:' + json.dumps([user.id, user.is_superuser, sorted(user.permissions), allowed,
        await query_cache.revision(db), str(await app_today(db))])
    cached = query_cache.get(key)
    if cached is not None: return cached
    async with _dashboard_slot:
        cached = query_cache.get(key)
        if cached is not None: return cached
        result = await _dashboard_stats(db, user)
        query_cache.put(key, result)
        return result


async def _dashboard_stats(db, user):
    today = await app_today(db)
    allowed = await access_service.allowed_type_ids(db, user)
    type_scope = (Record.record_type_id.in_(allowed) if allowed is not None else None)

    total = (await db.execute(
        select(func.count(Record.id)).where(
            Record.archived == False, Record.deleted_at == None,
            *([type_scope] if type_scope is not None else []),
        )
    )).scalar() or 0
    active = (await db.execute(
        select(func.count(Record.id)).where(
            Record.archived == False, Record.deleted_at == None, Record.status == "active",
            *([type_scope] if type_scope is not None else []),
        )
    )).scalar() or 0

    types_query = select(RecordType).where(RecordType.active == True)
    if allowed is not None:
        types_query = types_query.where(RecordType.id.in_(allowed))
    record_types = (await db.execute(
        types_query.options(selectinload(RecordType.fields))
    )).scalars().all()

    type_by_id = {rt.id: rt for rt in record_types}
    dates = select(
        Record.id, Record.name, Record.record_type_id, field_date().label("expiry"),
    ).join(RecordType, RecordType.id == Record.record_type_id).join(RecordValue, and_(
        RecordValue.record_id == Record.id, RecordValue.field_id == RecordType.reminder_field_id,
    )).where(
        Record.archived == False, Record.deleted_at.is_(None),
        Record.record_type_id.in_(list(type_by_id)),
        # Narrow the value scan before invoking PostgreSQL's date parser.
        # Otherwise the planner may validate every text/numeric field first.
        RecordValue.field_id.in_([rt.reminder_field_id for rt in record_types if rt.reminder_field_id]),
    ).subquery()
    expiry = dates.c.expiry
    soon = and_(expiry >= today, expiry <= today + timedelta(days=30))
    week = and_(expiry >= today, expiry <= today + timedelta(days=7))
    counts = (await db.execute(select(
        dates.c.record_type_id,
        func.count().filter(expiry < today).label("expired"),
        func.count().filter(soon).label("soon"),
        func.count().filter(week).label("week"),
    ).group_by(dates.c.record_type_id))).all()
    expired_by_type = {r.record_type_id: r.expired for r in counts if r.expired}
    expiring_by_type = {r.record_type_id: r.soon for r in counts if r.soon}
    expired = sum(expired_by_type.values())
    expiring_soon = renewing_month = sum(expiring_by_type.values())
    renewing_week = sum(r.week for r in counts)
    upcoming_rows = (await db.execute(select(dates).where(expiry >= today)
        .order_by(expiry, dates.c.id).limit(10))).all()
    upcoming = [{"id": r.id, "name": r.name, "record_type": type_by_id[r.record_type_id].name,
                 "reminder_date": r.expiry.isoformat(), "days_remaining": (r.expiry - today).days}
                for r in upcoming_rows]

    recent_query = (
        select(Record, RecordType.name.label("rt_name"), RecordType.slug.label("rt_slug"))
        .join(RecordType, Record.record_type_id == RecordType.id)
        .where(Record.archived == False, Record.deleted_at == None)
    )
    if allowed is not None:
        recent_query = recent_query.where(Record.record_type_id.in_(allowed))
    recent_result = (await db.execute(
        recent_query.order_by(Record.created_at.desc()).limit(5)
    )).all()

    # Notification status
    from app.models.reminder import ReminderRule, ReminderLog, NotificationRecipient, TelegramBot
    from app.models.settings import SystemSetting
    last_run = (await db.execute(
        select(SystemSetting.value).where(SystemSetting.key == "worker_last_run")
    )).scalar()
    day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    rules_query = select(func.count(ReminderRule.id)).where(ReminderRule.active == True)
    logs_sent = select(func.count(ReminderLog.id)).where(ReminderLog.status == "sent", ReminderLog.created_at >= day_ago)
    logs_failed = select(func.count(ReminderLog.id)).where(ReminderLog.status == "failed", ReminderLog.created_at >= day_ago)
    if allowed is not None:
        rules_query = rules_query.where(ReminderRule.record_type_id.in_(allowed))
        record_subquery = select(Record.id).where(
            Record.record_type_id.in_(allowed) if allowed else Record.id == -1
        )
        logs_sent = logs_sent.where(ReminderLog.record_id.in_(record_subquery))
        logs_failed = logs_failed.where(ReminderLog.record_id.in_(record_subquery))
    active_rules = (await db.execute(rules_query)).scalar() or 0
    active_recipients = (await db.execute(
        select(func.count(NotificationRecipient.id)).where(NotificationRecipient.active == True)
    )).scalar() or 0
    sent_24h = (await db.execute(logs_sent)).scalar() or 0
    failed_24h = (await db.execute(logs_failed)).scalar() or 0
    configured_bots = (await db.execute(
        select(func.count(TelegramBot.id)).where(TelegramBot.active == True, TelegramBot.bot_token != "")
    )).scalar() or 0
    telegram_configured = configured_bots > 0

    can_notify = user.is_superuser or 'notification.view' in user.permissions
    return {
        "total_records": total,
        "active_records": active,
        "expiring_soon": expiring_soon,
        "expired": expired,
        "expiring_by_type": sorted(
            (
                {"record_type_id": rt_id, "name": type_by_id[rt_id].name, "slug": type_by_id[rt_id].slug, "count": count}
                for rt_id, count in expiring_by_type.items() if rt_id in type_by_id
            ),
            key=lambda x: -x["count"],
        ),
        "expired_by_type": sorted(
            (
                {"record_type_id": rt_id, "name": type_by_id[rt_id].name, "slug": type_by_id[rt_id].slug, "count": count}
                for rt_id, count in expired_by_type.items() if rt_id in type_by_id
            ),
            key=lambda x: -x["count"],
        ),
        "renewing_this_week": renewing_week,
        "renewing_this_month": renewing_month,
        "upcoming_renewals": upcoming,
        "recently_added": [
            {"id": r.id, "name": r.name, "record_type_name": name, "record_type_slug": slug}
            for r, name, slug in recent_result
        ],
        "recently_modified": [
            {"id": r.id, "name": r.name, "record_type_name": name, "record_type_slug": slug}
            for r, name, slug in sorted(recent_result, key=lambda row: row[0].updated_at, reverse=True)[:5]
        ],
        "notification_status": {
            "last_run_at": last_run if can_notify else None,
            "active_rules": active_rules if can_notify else 0,
            "active_recipients": active_recipients if user.is_superuser else 0,
            "sent_24h": sent_24h if can_notify else 0,
            "failed_24h": failed_24h if can_notify else 0,
            "telegram_configured": telegram_configured if can_notify else False,
        },
    }
