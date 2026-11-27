from datetime import datetime, timezone, timedelta

from sqlalchemy import select, func, or_, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.exceptions import NotFoundException, ConflictException, ValidationException
from app.models.reminder import ReminderRule, ReminderLog, NotificationRecipient, TelegramBot
from app.models.record import Record
from app.models.record_type import RecordType, RecordField
from app.models.settings import SystemSetting
from app.models.user import User, Role, UserRecordTypeAccess
from app.schemas.reminder import ReminderRuleCreate, ReminderRuleUpdate, NotificationRecipientCreate, NotificationRecipientUpdate, TelegramBotCreate, TelegramBotUpdate
from app.services import access as access_service
from app.services.notification import notification_service
from app.services.user import get_user
from app.services.clock import app_today
from app.services.delivery import enqueue_delivery
from app.models.delivery import ReminderDelivery
from app.services.date_query import dated_records
from app.services.reminder_template import render_message, append_notice, render, sample_context, saved_template
from app.services.record_type import get_record_type


async def get_rules(db: AsyncSession, record_type_id: int | None = None):
    query = select(ReminderRule).options(selectinload(ReminderRule.record_type).selectinload(RecordType.fields).selectinload(RecordField.options))
    if record_type_id:
        query = query.where(ReminderRule.record_type_id == record_type_id)
    result = await db.execute(query.order_by(ReminderRule.record_type_id, ReminderRule.days_before.desc()))
    return result.scalars().all()


async def create_rule(db: AsyncSession, data: ReminderRuleCreate) -> ReminderRule:
    if data.template and data.template.strip():
        rt = await get_record_type(db, data.record_type_id)
        render(data.template, sample_context(rt, await app_today(db), data.days_before))
    data.template = data.template.strip() if data.template and data.template.strip() else None
    rule = ReminderRule(**data.model_dump())
    db.add(rule)
    await db.flush()
    return rule


async def update_rule(db: AsyncSession, rule_id: int, data: ReminderRuleUpdate) -> ReminderRule:
    result = await db.execute(select(ReminderRule).where(ReminderRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise NotFoundException("Reminder rule not found")
    if "template" in data.model_fields_set:
        data.template = data.template.strip() if data.template and data.template.strip() else None
        if data.template:
            rt = await get_record_type(db, rule.record_type_id)
            render(data.template, sample_context(rt, await app_today(db), data.days_before if data.days_before is not None else rule.days_before))
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(rule, k, v)
    await db.flush()
    await db.refresh(rule, ["updated_at", "created_at"])
    return rule


async def delete_rule(db: AsyncSession, rule_id: int) -> None:
    result = await db.execute(select(ReminderRule).where(ReminderRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise NotFoundException("Reminder rule not found")
    await db.delete(rule)


async def get_recipients(db: AsyncSession, active_only: bool = True):
    query = select(NotificationRecipient).options(
        selectinload(NotificationRecipient.bots), selectinload(NotificationRecipient.user)
    )
    if active_only:
        query = query.where(NotificationRecipient.active == True)
    result = await db.execute(query.order_by(NotificationRecipient.display_name))
    return [_serialize_recipient(r) for r in result.scalars().all()]


def _serialize_recipient(recipient) -> dict:
    bots = list(recipient.bots)
    return {
        "id": recipient.id,
        "display_name": recipient.display_name,
        "telegram_chat_id": recipient.telegram_chat_id,
        "telegram_username": recipient.telegram_username,
        "telegram_bot_ids": [b.id for b in bots],
        "telegram_bot_names": [b.name for b in bots],
        "user_id": recipient.user_id,
        "user_name": recipient.user.name if recipient.user else None,
        "active": recipient.active,
        "created_at": recipient.created_at,
        "updated_at": recipient.updated_at,
    }


async def _reload_recipient(db: AsyncSession, recipient_id: int) -> dict:
    result = await db.execute(
        select(NotificationRecipient)
        .where(NotificationRecipient.id == recipient_id)
        .options(selectinload(NotificationRecipient.bots), selectinload(NotificationRecipient.user))
        .execution_options(populate_existing=True)
    )
    return _serialize_recipient(result.scalar_one())


async def create_recipient(db: AsyncSession, data: NotificationRecipientCreate) -> dict:
    existing = await db.execute(
        select(NotificationRecipient).where(NotificationRecipient.telegram_chat_id == data.telegram_chat_id)
    )
    if existing.scalar_one_or_none():
        raise ConflictException(
            f"A recipient with chat ID '{data.telegram_chat_id}' already exists - edit it to change its bots"
        )
    if data.user_id is not None:
        await get_user(db, data.user_id)  # existence check → 404 for unknown users
    else:
        raise ValidationException("A Telegram recipient must belong to a user")
    bots = []
    for bot_id in data.telegram_bot_ids:
        bot = await get_bot(db, bot_id)
        if not bot:
            raise NotFoundException(f"Telegram bot {bot_id} not found")
        bots.append(bot)
    recipient = NotificationRecipient(
        display_name=data.display_name,
        telegram_chat_id=data.telegram_chat_id,
        telegram_username=data.telegram_username,
        user_id=data.user_id,
        active=data.active,
    )
    recipient.bots = bots
    db.add(recipient)
    await db.flush()
    return await _reload_recipient(db, recipient.id)


async def update_recipient(db: AsyncSession, recipient_id: int, data: NotificationRecipientUpdate) -> dict:
    result = await db.execute(select(NotificationRecipient).where(NotificationRecipient.id == recipient_id))
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise NotFoundException("Recipient not found")
    updates = data.model_dump(exclude_unset=True)
    bot_ids = updates.pop("telegram_bot_ids", None)
    if bot_ids is not None:
        bots = []
        for bot_id in bot_ids:
            bot = await get_bot(db, bot_id)
            if not bot:
                raise NotFoundException(f"Telegram bot {bot_id} not found")
            bots.append(bot)
        recipient.bots = bots
    if "user_id" in updates:
        if updates["user_id"] is None:
            raise ValidationException("A Telegram recipient must belong to a user")
        await get_user(db, updates["user_id"])  # existence check → 404 for unknown users
    for k, v in updates.items():
        setattr(recipient, k, v)
    await db.flush()
    await db.refresh(recipient, ["updated_at", "created_at"])
    return await _reload_recipient(db, recipient.id)


async def delete_recipient(db: AsyncSession, recipient_id: int) -> None:
    result = await db.execute(select(NotificationRecipient).where(NotificationRecipient.id == recipient_id))
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise NotFoundException("Recipient not found")
    await db.delete(recipient)


async def get_bot(db: AsyncSession, bot_id: int) -> TelegramBot | None:
    result = await db.execute(select(TelegramBot).where(TelegramBot.id == bot_id))
    return result.scalar_one_or_none()


async def get_bots(db: AsyncSession, active_only: bool = False):
    query = select(TelegramBot)
    if active_only:
        query = query.where(TelegramBot.active == True)
    result = await db.execute(query.order_by(TelegramBot.created_at))
    return [_serialize_bot(bot) for bot in result.scalars().all()]


BOT_TOKEN_MASK = "•" * 8


def _serialize_bot(bot) -> dict:
    # Never hand the raw token to the API: callers only need to display it and
    # a masked value round-trips through update_bot as a "no change" marker.
    token = bot.bot_token
    return {
        "id": bot.id,
        "name": bot.name,
        "bot_token": f"{BOT_TOKEN_MASK}{token[-4:]}" if token else '',
        "active": bot.active,
        "created_at": bot.created_at,
        "updated_at": bot.updated_at,
    }


async def create_bot(db: AsyncSession, data: TelegramBotCreate) -> dict:
    existing = await db.execute(select(TelegramBot).where(TelegramBot.name == data.name))
    if existing.scalar_one_or_none():
        raise ConflictException(f"A bot named '{data.name}' already exists")
    bot = TelegramBot(name=data.name, bot_token=data.bot_token, active=data.active)
    db.add(bot)
    await db.flush()
    return _serialize_bot(bot)


async def update_bot(db: AsyncSession, bot_id: int, data: TelegramBotUpdate) -> dict:
    bot = await get_bot(db, bot_id)
    if not bot:
        raise NotFoundException("Telegram bot not found")
    updates = data.model_dump(exclude_unset=True)
    token = updates.get("bot_token")
    if token is None or token == "" or (isinstance(token, str) and token.startswith(BOT_TOKEN_MASK)):
        updates.pop("bot_token", None)
    if "name" in updates and updates["name"] != bot.name:
        dup = await db.execute(select(TelegramBot).where(TelegramBot.name == updates["name"], TelegramBot.id != bot_id))
        if dup.scalar_one_or_none():
            raise ConflictException(f"A bot named '{updates['name']}' already exists")
    for k, v in updates.items():
        setattr(bot, k, v)
    await db.flush()
    await db.refresh(bot, ["updated_at", "created_at"])
    return _serialize_bot(bot)


async def delete_bot(db: AsyncSession, bot_id: int) -> None:
    bot = await get_bot(db, bot_id)
    if not bot:
        raise NotFoundException("Telegram bot not found")
    await db.delete(bot)

async def send_test_message(db: AsyncSession, recipient_id: int) -> dict:
    """Send a test notification through every active bot linked to the recipient."""
    result = await db.execute(
        select(NotificationRecipient)
        .where(NotificationRecipient.id == recipient_id)
        .options(selectinload(NotificationRecipient.bots))
    )
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise NotFoundException("Recipient not found")
    active_bots = [b for b in recipient.bots if b.active]
    if not active_bots:
        return {"success": False, "error": "No active bot assigned to this recipient", "recipient": recipient.display_name}
    errors: list[str] = []
    for bot in active_bots:
        message = (
            "✅ <b>Test message</b>\n\n"
            "Your Telegram notifications are working.\n"
            f"Sent via bot: {bot.name}."
        )
        ok, error = await notification_service.send("telegram", recipient.telegram_chat_id, message, bot.bot_token)
        if not ok:
            errors.append(f"{bot.name}: {error or 'failed'}")
    return {"success": not errors, "error": "; ".join(errors) if errors else None, "recipient": recipient.display_name}


LOG_SORTS = ("scheduled_date", "sent_at", "status", "record", "recipient", "retry_count")


def _log_order(sort: str | None, order: str):
    when = func.coalesce(ReminderLog.sent_at, ReminderLog.scheduled_date)
    cols = {
        "scheduled_date": when, "sent_at": ReminderLog.sent_at, "status": ReminderLog.status, "retry_count": ReminderLog.retry_count,
        "record": select(Record.name).where(Record.id == ReminderLog.record_id).scalar_subquery(),
        "recipient": select(NotificationRecipient.display_name).where(NotificationRecipient.id == ReminderLog.recipient_id).scalar_subquery(),
    }
    if sort not in cols:
        return [ReminderLog.id.desc()]
    col = cols[sort]
    return [col.asc().nulls_last() if order == "asc" else col.desc().nulls_last(), ReminderLog.id.desc()]


async def get_reminder_logs(db: AsyncSession, page: int = 1, page_size: int = 25, status: str | None = None, allowed_type_ids: list[int] | None = None,
                            *, q: str | None = None, record_type_ids: list[int] | None = None, recipient_ids: list[int] | None = None,
                            date_from=None, date_to=None, sort: str | None = None, order: str = "desc"):
    conditions = []
    statuses = [x.strip() for x in (status or "").split(",") if x.strip()]
    if statuses:
        conditions.append(ReminderLog.status.in_(statuses))
    if q:
        like = f"%{q.strip()}%"
        conditions.append(or_(
            ReminderLog.record_id.in_(select(Record.id).where(Record.name.ilike(like))),
            ReminderLog.recipient_id.in_(select(NotificationRecipient.id).where(NotificationRecipient.display_name.ilike(like))),
            ReminderLog.error_message.ilike(like),
        ))
    if record_type_ids:
        conditions.append(ReminderLog.record_id.in_(select(Record.id).where(Record.record_type_id.in_(record_type_ids))))
    if recipient_ids:
        conditions.append(ReminderLog.recipient_id.in_(recipient_ids))
    if date_from:
        conditions.append(func.date(func.coalesce(ReminderLog.sent_at, ReminderLog.scheduled_date)) >= date_from)
    if date_to:
        conditions.append(func.date(func.coalesce(ReminderLog.sent_at, ReminderLog.scheduled_date)) <= date_to)
    if allowed_type_ids is not None:
        type_subquery = select(Record.id)
        if allowed_type_ids:
            type_subquery = type_subquery.where(Record.record_type_id.in_(allowed_type_ids))
        else:
            type_subquery = type_subquery.where(Record.id == -1)
        conditions.append(ReminderLog.record_id.in_(type_subquery))
    total = (await db.execute(
        select(func.count(ReminderLog.id)).where(*conditions)
    )).scalar() or 0
    query = (
        select(ReminderLog).where(*conditions)
        .options(selectinload(ReminderLog.record).selectinload(Record.record_type), selectinload(ReminderLog.rule), selectinload(ReminderLog.recipient))
        .order_by(*_log_order(sort, order))
        .offset((page - 1) * page_size).limit(page_size)
    )
    items = (await db.execute(query)).scalars().all()
    serialized = [
        {
            "id": log.id,
            "record_id": log.record_id,
            "record_name": log.record.name if log.record else None,
            "record_type_slug": log.record.record_type.slug if log.record and log.record.record_type else None,
            "record_type_name": log.record.record_type.name if log.record and log.record.record_type else None,
            "reminder_rule_id": log.reminder_rule_id,
            "rule_name": log.rule.name if log.rule else None,
            "days_before": log.rule.days_before if log.rule else None,
            "recipient_id": log.recipient_id,
            "recipient_name": log.recipient.display_name if log.recipient else None,
            "scheduled_date": log.scheduled_date,
            "sent_at": log.sent_at,
            "status": log.status,
            "error_message": log.error_message,
            "retry_count": log.retry_count,
        }
        for log in items
    ]
    return serialized, total


async def _set_heartbeat(db: AsyncSession) -> None:
    result = await db.execute(select(SystemSetting).where(SystemSetting.key == "worker_last_run"))
    setting = result.scalar_one_or_none()
    now_iso = datetime.now(timezone.utc).isoformat()
    if setting:
        setting.value = now_iso
    else:
        db.add(SystemSetting(key="worker_last_run", value=now_iso, description="Last worker reminder cycle (UTC)"))
    await db.flush()


async def _send_via_bots(recipient: NotificationRecipient, message: str) -> tuple[bool, str | None]:
    """Deliver a message through every active bot linked to the recipient.

    One Telegram user may be reachable via several bots; delivery succeeds if
    at least one bot gets the message through.
    """
    errors: list[str] = []
    any_ok = False
    for bot in recipient.bots:
        if not bot.active:
            continue
        ok, error = await notification_service.send("telegram", recipient.telegram_chat_id, message, bot.bot_token)
        if ok:
            any_ok = True
        else:
            errors.append(f"{bot.name}: {error or 'failed'}")
    if not any_ok and not errors:
        return False, "No active bot assigned to this recipient"
    return any_ok, ("; ".join(errors) if not any_ok else None)


async def _retry_failed(db: AsyncSession, recipients_by_id: dict) -> dict:
    """Retry failed notifications up to WORKER_MAX_RETRIES."""
    settings = get_settings()
    retried_sent = 0
    retried_given_up = 0

    failed_logs = (await db.execute(
        select(ReminderLog).where(
            ReminderLog.status.in_(["failed", "pending"]),
            ~select(ReminderDelivery.id).where(ReminderDelivery.log_id == ReminderLog.id).exists(),
            ReminderLog.retry_count < settings.WORKER_MAX_RETRIES,
        ).options(selectinload(ReminderLog.recipient))
    )).scalars().all()

    # Retries re-send using the same message template reconstructed from the
    # record/rule, so failure retries carry full content.
    for log in failed_logs:
        recipient = recipients_by_id.get(log.recipient_id)
        if recipient is None or not recipient.active:
            continue
        rule = (await db.execute(select(ReminderRule).where(ReminderRule.id == log.reminder_rule_id)
            .options(selectinload(ReminderRule.record_type).selectinload(RecordType.fields).selectinload(RecordField.options)))).scalar_one_or_none()
        record = (await db.execute(
            select(Record).where(Record.id == log.record_id)
            .options(selectinload(Record.values))
        )).scalar_one_or_none()
        if rule is None or record is None:
            log.retry_count = settings.WORKER_MAX_RETRIES
            log.error_message = "Gave up: record or rule no longer exists"
            continue
        owner = recipient.user
        if (not owner or not owner.is_active or (not owner.is_superuser and "record.view" not in owner.permissions)
                or not access_service.type_is_allowed(await access_service.allowed_type_ids(db, owner), record.record_type_id)):
            log.retry_count = settings.WORKER_MAX_RETRIES
            log.error_message = "Recipient no longer has record access"
            continue
        record_type = rule.record_type
        reminder_value = None
        for rv in record.values:
            if rv.field_id == record_type.reminder_field_id:
                reminder_value = rv.value.get("value") if rv.value else None
                break
        if not reminder_value:
            log.retry_count = settings.WORKER_MAX_RETRIES
            log.error_message = "Gave up: record no longer has a reminder date"
            continue
        try:
            renewal_date = datetime.fromisoformat(str(reminder_value).replace("Z", "+00:00")).date()
        except (ValueError, TypeError):
            log.retry_count = settings.WORKER_MAX_RETRIES
            log.error_message = "Gave up: reminder date unreadable"
            continue
        today = await app_today(db)
        days_remaining = (renewal_date - today).days

        message = render_message(record_type, record, str(renewal_date), days_remaining, today, rule)
        await enqueue_delivery(db, log, recipient, message)
        await db.flush()

    return {"retried_sent": retried_sent, "gave_up": retried_given_up}


async def process_due_reminders(db: AsyncSession) -> dict:
    settings = get_settings()
    if not (await db.execute(text("SELECT pg_try_advisory_xact_lock(73492101)"))).scalar():
        return {"sent": 0, "failed": 0, "skipped": 0}
    today = await app_today(db)

    rules = (await db.execute(
        select(ReminderRule).where(ReminderRule.active == True)
        .options(selectinload(ReminderRule.record_type).selectinload(RecordType.fields).selectinload(RecordField.options))
    )).scalars().all()
    recipients = (await db.execute(
        select(NotificationRecipient).where(NotificationRecipient.active == True)
        .options(
            selectinload(NotificationRecipient.bots),
            selectinload(NotificationRecipient.user).selectinload(User.roles).selectinload(Role.permissions),
        )
    )).scalars().all()
    recipients_by_id = {r.id: r for r in recipients}

    # Permission-derived targeting: each recipient receives reminders for the
    # record types its owning user can access (access bypass = all types).
    allowed_by_user: dict[int, list[int] | None] = {}
    for r in recipients:
        if r.user and r.user.is_active and r.user.id not in allowed_by_user:
            if access_service.has_type_bypass(r.user):
                allowed_by_user[r.user.id] = None  # unrestricted
            else:
                rows = (await db.execute(
                    select(UserRecordTypeAccess.record_type_id)
                    .where(UserRecordTypeAccess.user_id == r.user.id)
                )).scalars().all()
                allowed_by_user[r.user.id] = list(rows)

    def owner_gets(r: NotificationRecipient, record_type_id: int) -> bool:
        if not r.user or not r.user.is_active:
            return False
        if not r.user.is_superuser and "record.view" not in r.user.permissions:
            return False
        return access_service.type_is_allowed(allowed_by_user.get(r.user.id, []), record_type_id)

    retry_result = await _retry_failed(db, recipients_by_id)

    # Auto-renew expired records (Auto Renew on) BEFORE scheduling reminders,
    # so freshly advanced dates are picked up in the same cycle.
    from app.services.record import AUTO_RENEW_FIELD_NAMES, _find_field, _raw_values, auto_renew_due_records, auto_renew_enabled, auto_renew_months, effective_lead
    auto_result = await auto_renew_due_records(db)

    sent = 0
    failed = 0
    skipped = 0

    if recipients:
        for rule in rules:
            record_type = rule.record_type
            if not record_type or not record_type.reminder_field_id:
                continue

            # Recipients via their users' record-type access; per-type bot
            # routing still narrows further when the type is pinned to a bot.
            rule_recipients = [r for r in recipients if owner_gets(r, rule.record_type_id)]
            if record_type.telegram_bot_id:
                rule_recipients = [r for r in rule_recipients if any(b.id == record_type.telegram_bot_id for b in r.bots)]
            if not rule_recipients:
                continue
            active_fields = {f.id: f for f in record_type.fields if f.active}
            has_auto_field = _find_field(AUTO_RENEW_FIELD_NAMES, record_type) is not None

            records = await db.stream_scalars(
                select(Record).where(
                    Record.record_type_id == rule.record_type_id,
                    Record.archived == False,
                    Record.deleted_at == None,
                    Record.id.in_(dated_records(record_type.reminder_field_id,
                        start=today + timedelta(days=rule.days_before - settings.WORKER_CATCHUP_DAYS),
                        end=today + timedelta(days=rule.days_before))),
                ).options(selectinload(Record.values))
            .execution_options(yield_per=100))
            async for record in records:
                reminder_value = None
                for rv in record.values:
                    if rv.field_id == record_type.reminder_field_id:
                        reminder_value = rv.value.get("value") if rv.value else None
                        break
                if not reminder_value:
                    skipped += 1
                    continue
                try:
                    renewal_date = datetime.fromisoformat(str(reminder_value).replace("Z", "+00:00")).date()
                except (ValueError, TypeError):
                    skipped += 1
                    continue

                days_remaining = (renewal_date - today).days
                # Intended fire date = renewal_date - days_before. Fire on that day
                # or within the catch-up window; never before, never long after.
                intended_date = renewal_date - timedelta(days=rule.days_before)
                overdue_days = (today - intended_date).days
                if overdue_days < 0 or overdue_days > settings.WORKER_CATCHUP_DAYS:
                    skipped += 1
                    continue
                if days_remaining < 0:
                    # Renewal date already passed; only the 0-day rule may have caught it
                    skipped += 1
                    continue

                # Auto Renew on: the engine renews it, so no "renew now" alert.
                # Auto Renew off: alert, and say so plainly.
                if has_auto_field and auto_renew_months(record_type, _raw_values(record, active_fields)):
                    skipped += 1
                    continue

                scheduled_date = datetime.combine(intended_date, datetime.min.time(), tzinfo=timezone.utc)

                message = render_message(record_type, record, str(renewal_date), days_remaining, today, rule)
                if has_auto_field and not (rule.template or saved_template(record_type)):  # custom templates stay as written
                    message = append_notice(message, "\n\n<b>Auto-renew is OFF.</b> Renew it manually or turn auto-renew on.")
                if overdue_days > 0:
                    sent_ = "day" if overdue_days == 1 else "days"
                    message = append_notice(message, f"\n\n<i>Note: scheduled for {intended_date.isoformat()}, sent {overdue_days} {sent_} later (catch-up). Days remaining is current.</i>")

                for recipient in rule_recipients:
                    existing = await db.execute(select(ReminderLog).where(
                        ReminderLog.record_id == record.id,
                        ReminderLog.reminder_rule_id == rule.id,
                        ReminderLog.recipient_id == recipient.id,
                        ReminderLog.scheduled_date == scheduled_date,
                    ))
                    if existing.scalar_one_or_none():
                        skipped += 1
                        continue

                    log = ReminderLog(
                        record_id=record.id, reminder_rule_id=rule.id, recipient_id=recipient.id,
                        scheduled_date=scheduled_date, status="pending",
                    )
                    db.add(log)
                    await db.flush()

                    await enqueue_delivery(db, log, recipient, message)
                    await db.flush()

    # Per-record early reminders: Auto Renew off + the record opts in via its
    # renew-before-expiry lead. Logged under the type's first active rule; when
    # a rule already fires on the same date, the existing log dedupes it.

    def rule_recipients_for(record_type_id: int) -> list:
        chosen = [r for r in recipients if owner_gets(r, record_type_id)]
        record_type = _type_by_id.get(record_type_id)
        if record_type and record_type.telegram_bot_id:
            chosen = [r for r in chosen if any(b.id == record_type.telegram_bot_id for b in r.bots)]
        return chosen

    primary_rule_by_type: dict[int, ReminderRule] = {}
    for rule in rules:
        primary_rule_by_type.setdefault(rule.record_type_id, rule)

    if recipients and primary_rule_by_type:
        type_ids = list(primary_rule_by_type)
        types_full = (await db.execute(
            select(RecordType).where(RecordType.id.in_(type_ids))
            .options(selectinload(RecordType.fields))
        )).scalars().all()
        _type_by_id = {t.id: t for t in types_full}

        for rule in primary_rule_by_type.values():
            record_type = rule.record_type
            if not record_type or not record_type.reminder_field_id:
                continue
            auto_field = _find_field(AUTO_RENEW_FIELD_NAMES, record_type)
            if auto_field is None:
                continue

            rule_recipients = rule_recipients_for(record_type.id)
            if not rule_recipients:
                continue

            records = await db.stream_scalars(
                select(Record).where(
                    Record.record_type_id == record_type.id,
                    Record.archived == False,
                    Record.deleted_at == None,
                    Record.id.in_(dated_records(record_type.reminder_field_id,
                        start=today, end=today + func.coalesce(Record.renew_before_days, record_type.renew_before_days or 0))),
                ).options(selectinload(Record.values))
            .execution_options(yield_per=100))
            async for record in records:
                reminder_value = None
                for rv in record.values:
                    if rv.field_id == record_type.reminder_field_id:
                        reminder_value = rv.value.get("value") if rv.value else None
                        break
                if not reminder_value:
                    skipped += 1
                    continue
                try:
                    renewal_date = datetime.fromisoformat(str(reminder_value).replace("Z", "+00:00")).date()
                except (ValueError, TypeError):
                    skipped += 1
                    continue
                lead = effective_lead(record, record_type)
                if not lead:
                    continue
                # Auto Renew off only: auto records renew via the engine
                auto_val = None
                for rv in record.values:
                    if rv.field_id == auto_field.id and rv.value:
                        auto_val = rv.value.get("value")
                        break
                if auto_renew_enabled(auto_val):
                    continue

                days_remaining = (renewal_date - today).days
                intended_date = renewal_date - timedelta(days=lead)
                overdue_days = (today - intended_date).days
                if overdue_days < 0 or overdue_days > settings.WORKER_CATCHUP_DAYS or days_remaining < 0:
                    skipped += 1
                    continue

                scheduled_date = datetime.combine(intended_date, datetime.min.time(), tzinfo=timezone.utc)


                message = render_message(record_type, record, str(renewal_date), days_remaining, today, rule)

                for recipient in rule_recipients:
                    existing = await db.execute(select(ReminderLog).where(
                        ReminderLog.record_id == record.id,
                        ReminderLog.reminder_rule_id == rule.id,
                        ReminderLog.recipient_id == recipient.id,
                        ReminderLog.scheduled_date == scheduled_date,
                    ))
                    if existing.scalar_one_or_none():
                        skipped += 1
                        continue
                    log = ReminderLog(
                        record_id=record.id, reminder_rule_id=rule.id, recipient_id=recipient.id,
                        scheduled_date=scheduled_date, status="pending",
                    )
                    db.add(log)
                    await db.flush()
                    await enqueue_delivery(db, log, recipient, message)
                    await db.flush()

    await _set_heartbeat(db)

    result = {"sent": sent, "failed": failed, "skipped": skipped}
    result.update(retry_result)
    result.update(auto_result)
    return result


# ---------------- Upcoming renewals (Reminders page) ----------------

UPCOMING_LIMIT = 1500
OVERDUE_LIMIT = 500


async def upcoming_renewals(db: AsyncSession, allowed: list[int] | None, days: int = 90) -> dict:
    """Records whose renewal/expiry date is overdue or within `days`, with the
    next reminder each one will get and whether auto-renew handles it.

    Mirrors the worker: a record that will auto-renew gets no reminder, and a
    rule fires on expiry minus days_before.
    """
    from sqlalchemy import and_
    from app.models.record import RecordValue
    from app.services.date_query import field_date
    from app.services.record import (AUTO_RENEW_FIELD_NAMES, _find_field, _raw_values,
                                     auto_renew_enabled, auto_renew_months, effective_lead)

    today = await app_today(db)
    end = today + timedelta(days=days)
    types_query = select(RecordType).where(RecordType.active.is_(True), RecordType.reminder_field_id.is_not(None))
    if allowed is not None:
        types_query = types_query.where(RecordType.id.in_(allowed or [-1]))
    types = (await db.execute(types_query.options(selectinload(RecordType.fields)))).scalars().all()
    type_by_id = {rt.id: rt for rt in types}
    empty_summary = {"overdue": 0, "week": 0, "month": 0, "window": 0, "auto_renew_on": 0, "auto_renew_off": 0, "no_reminder": 0}
    if not types:
        return {"today": today.isoformat(), "days": days, "truncated": False, "summary": empty_summary, "items": []}

    dates = select(
        Record.id.label("id"), Record.record_type_id.label("record_type_id"), field_date().label("expiry"),
    ).join(RecordType, RecordType.id == Record.record_type_id).join(RecordValue, and_(
        RecordValue.record_id == Record.id, RecordValue.field_id == RecordType.reminder_field_id,
    )).where(
        Record.archived == False, Record.deleted_at.is_(None),  # noqa: E712
        Record.record_type_id.in_(list(type_by_id)),
        RecordValue.field_id.in_([rt.reminder_field_id for rt in types]),
    ).subquery()
    expiry = dates.c.expiry
    counts = (await db.execute(select(
        func.count().filter(expiry < today).label("overdue"),
        func.count().filter(and_(expiry >= today, expiry <= today + timedelta(days=7))).label("week"),
        func.count().filter(and_(expiry >= today, expiry <= today + timedelta(days=30))).label("month"),
        func.count().filter(and_(expiry >= today, expiry <= end)).label("window"),
    ))).one()
    soon = (await db.execute(select(dates.c.id, expiry).where(expiry >= today, expiry <= end)
                             .order_by(expiry, dates.c.id).limit(UPCOMING_LIMIT))).all()
    late = (await db.execute(select(dates.c.id, expiry).where(expiry < today)
                             .order_by(expiry.desc(), dates.c.id).limit(OVERDUE_LIMIT))).all()
    expiry_by_id = {r.id: r.expiry for r in [*soon, *late]}
    truncated = len(soon) < counts.window or len(late) < counts.overdue

    records = (await db.execute(select(Record).where(Record.id.in_(list(expiry_by_id) or [-1]))
                                .options(selectinload(Record.values)))).scalars().all()
    rules = (await db.execute(select(ReminderRule).where(
        ReminderRule.active.is_(True), ReminderRule.record_type_id.in_(list(type_by_id)),
    ))).scalars().all()
    rules_by_type: dict[int, list[ReminderRule]] = {}
    for rule in rules:
        rules_by_type.setdefault(rule.record_type_id, []).append(rule)

    items = []
    summary = {**empty_summary, "overdue": counts.overdue, "week": counts.week, "month": counts.month, "window": counts.window}
    for record in records:
        rt = type_by_id[record.record_type_id]
        exp = expiry_by_id[record.id]
        remaining = (exp - today).days
        fields = {f.id: f for f in rt.fields if f.active}
        raw = _raw_values(record, fields)
        auto_field = _find_field(AUTO_RENEW_FIELD_NAMES, rt)
        auto = None if auto_field is None else auto_renew_enabled(raw.get(auto_field.slug))
        will_auto = auto_field is not None and bool(auto_renew_months(rt, raw))
        lead = effective_lead(record, rt)
        cost_field, currency_field = _find_field({"Cost"}, rt), _find_field({"Currency"}, rt)
        cycle_field = _find_field({"Billing Cycle", "Renewal Cycle"}, rt)
        next_reminder = None
        if not will_auto and remaining >= 0:
            due = [r for r in rules_by_type.get(rt.id, []) if r.days_before <= remaining]
            if due:
                rule = max(due, key=lambda r: r.days_before)
                next_reminder = {"rule_id": rule.id, "name": rule.name, "days_before": rule.days_before,
                                 "date": (exp - timedelta(days=rule.days_before)).isoformat()}
        if auto is True:
            summary["auto_renew_on"] += 1
        elif auto is False:
            summary["auto_renew_off"] += 1
        if next_reminder is None and not will_auto and remaining >= 0:
            summary["no_reminder"] += 1
        items.append({
            "id": record.id, "name": record.name, "status": record.status,
            "record_type_id": rt.id, "record_type_name": rt.name, "record_type_slug": rt.slug, "record_type_icon": rt.icon,
            "expiry_date": exp.isoformat(), "days_remaining": remaining,
            "auto_renew": auto, "will_auto_renew": will_auto,
            "auto_renew_date": (exp - timedelta(days=lead)).isoformat() if will_auto else None,
            "cost": raw.get(cost_field.slug) if cost_field else None,
            "currency": raw.get(currency_field.slug) if currency_field else None,
            "cycle": raw.get(cycle_field.slug) if cycle_field else None,
            "next_reminder": next_reminder,
        })
    items.sort(key=lambda i: (i["expiry_date"], i["id"]))
    return {"today": today.isoformat(), "days": days, "truncated": truncated, "summary": summary, "items": items}
