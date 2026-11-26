from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, update
from datetime import datetime
from types import SimpleNamespace
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission, require_superuser
from app.db.session import get_db
from app.models.reminder import ReminderRule
from app.schemas.common import PaginatedResponse
from app.schemas.reminder import ReminderRuleCreate, ReminderRuleUpdate, ReminderRuleResponse, ReminderLogResponse, NotificationRecipientCreate, NotificationRecipientUpdate, NotificationRecipientResponse, TelegramBotCreate, TelegramBotUpdate, TelegramBotResponse
from app.services import reminder as reminder_service
from app.services import access as access_service
from app.models.user import User
from app.models.record import Record
from app.models.record_type import RecordType
from app.core.exceptions import ForbiddenException, NotFoundException
from app.schemas.reminder import MessageTemplateUpdate, MessageTemplatePreview
from app.services import reminder_template as message_service
from app.services.record_type import get_record_type
from app.services.clock import app_today
from app.services.audit import log_audit
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/reminders", tags=["reminders"])


async def _message_settings(db, record_type):
    saved = message_service.saved_template(record_type)
    default = message_service.default_template(record_type)
    overrides = (await db.execute(select(func.count(ReminderRule.id)).where(
        ReminderRule.record_type_id == record_type.id, ReminderRule.template.is_not(None), func.length(func.trim(ReminderRule.template)) > 0,
    ))).scalar() or 0
    return {"record_type_id": record_type.id, "template": saved, "default_template": default,
            "effective_template": saved or default, "variables": message_service.variables(record_type),
            "rule_overrides": overrides}


@router.get("/types/{type_id}/message")
async def get_type_message(type_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("reminder.view"))):
    await access_service.ensure_type_access(db, user, type_id)
    return await _message_settings(db, await get_record_type(db, type_id))


@router.put("/types/{type_id}/message")
async def update_type_message(type_id: int, data: MessageTemplateUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("reminder.edit"))):
    await access_service.ensure_type_access(db, user, type_id, write=True)
    await db.execute(select(RecordType.id).where(RecordType.id == type_id).with_for_update())
    record_type = await get_record_type(db, type_id)
    template = data.template.strip() if data.template else None
    if template:
        message_service.render(template, message_service.sample_context(record_type, await app_today(db)))
    config = dict(record_type.reminder_config or {})
    if template:
        config["message_template"] = template
    else:
        config.pop("message_template", None)
    record_type.reminder_config = config or None
    if data.replace_rule_overrides:
        await db.execute(update(ReminderRule).where(ReminderRule.record_type_id == type_id).values(template=None))
    await log_audit(db, "reminder.message_update", "record_type", type_id, record_type.name, user_id=user.id,
                    details="Updated Telegram reminder message", new_values={
                        "uses_custom_message": bool(template), "replaced_rule_overrides": data.replace_rule_overrides,
                    })
    await db.flush()
    return await _message_settings(db, record_type)


@router.post("/types/{type_id}/message/preview")
async def preview_type_message(type_id: int, data: MessageTemplatePreview, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("reminder.view"))):
    await access_service.ensure_type_access(db, user, type_id)
    record_type = await get_record_type(db, type_id)
    today = await app_today(db)
    warnings = []
    if data.record_id is not None:
        if not user.is_superuser and "record.view" not in user.permissions:
            raise ForbiddenException("Record view permission is required to preview real record values")
        record = (await db.execute(select(Record).where(
            Record.id == data.record_id, Record.record_type_id == type_id,
            Record.deleted_at.is_(None), Record.archived == False,
        ).options(selectinload(Record.values)))).scalar_one_or_none()
        if record is None:
            raise NotFoundException("Preview record not found in this record type")
        raw = next((v.value.get("value") for v in record.values if v.field_id == record_type.reminder_field_id and isinstance(v.value, dict)), None)
        try:
            expiry = datetime.fromisoformat(str(raw).replace("Z", "+00:00")).date()
            remaining = (expiry - today).days
            expiry_text = expiry.isoformat()
        except (ValueError, TypeError):
            expiry_text, remaining = "Not set", None
            warnings.append("This record has no valid configured renewal date.")
        values = message_service.context(record_type, record, expiry_text, remaining, today,
                                        SimpleNamespace(name=f"{data.days_before} days before", days_before=data.days_before))
    else:
        values = message_service.sample_context(record_type, today, data.days_before)
    template = data.template.strip() if data.template else None
    if "template" not in data.model_fields_set:
        template = message_service.saved_template(record_type)
    rendered = message_service.render(template or message_service.default_template(record_type), values)
    return {**rendered, "warnings": warnings, "sample": data.record_id is None}


async def _ensure_rule_access(db: AsyncSession, user: User, rule_id: int) -> None:
    rule_type_id = (await db.execute(
        select(ReminderRule.record_type_id).where(ReminderRule.id == rule_id)
    )).scalar_one_or_none()
    if rule_type_id is not None:
        await access_service.ensure_type_access(db, user, rule_type_id, write=True)


@router.get("/rules", response_model=list[ReminderRuleResponse])
async def list_rules(record_type_id: int | None = None, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("reminder.view"))):
    allowed = await access_service.allowed_type_ids(db, user)
    if allowed is not None and not allowed:
        return []
    rules = await reminder_service.get_rules(db, record_type_id)
    return [r for r in rules if allowed is None or r.record_type_id in allowed]


@router.post("/rules", response_model=ReminderRuleResponse, status_code=201)
async def create_rule(data: ReminderRuleCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("reminder.create"))):
    await access_service.ensure_type_access(db, user, data.record_type_id, write=True)
    return await reminder_service.create_rule(db, data)


@router.put("/rules/{rule_id}", response_model=ReminderRuleResponse)
async def update_rule(rule_id: int, data: ReminderRuleUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("reminder.edit"))):
    await _ensure_rule_access(db, user, rule_id)
    return await reminder_service.update_rule(db, rule_id, data)


@router.delete("/rules/{rule_id}", status_code=204)
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("reminder.delete"))):
    await _ensure_rule_access(db, user, rule_id)
    await reminder_service.delete_rule(db, rule_id)


@router.get("/logs", response_model=PaginatedResponse[ReminderLogResponse])
async def list_logs(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), status: str | None = None, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("notification.view"))):
    allowed = await access_service.allowed_type_ids(db, user)
    if allowed is not None and not allowed:
        items, total = [], 0
    else:
        items, total = await reminder_service.get_reminder_logs(db, page, page_size, status, allowed)
    return PaginatedResponse(items=items, page=page, page_size=page_size, total=total, total_pages=(total + page_size - 1) // page_size)


@router.get("/recipients", response_model=list[NotificationRecipientResponse])
async def list_recipients(active_only: bool = True, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("notification.view"))):
    return await reminder_service.get_recipients(db, active_only)


@router.post("/recipients", response_model=NotificationRecipientResponse, status_code=201)
async def create_recipient(data: NotificationRecipientCreate, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_superuser)):
    return await reminder_service.create_recipient(db, data)


@router.put("/recipients/{recipient_id}", response_model=NotificationRecipientResponse)
async def update_recipient(recipient_id: int, data: NotificationRecipientUpdate, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_superuser)):
    return await reminder_service.update_recipient(db, recipient_id, data)


@router.delete("/recipients/{recipient_id}", status_code=204)
async def delete_recipient(recipient_id: int, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_superuser)):
    await reminder_service.delete_recipient(db, recipient_id)


@router.post("/recipients/{recipient_id}/test")
async def send_test(recipient_id: int, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_superuser)):
    """Send a test message to verify Telegram configuration works."""
    return await reminder_service.send_test_message(db, recipient_id)


@router.get("/bots", response_model=list[TelegramBotResponse])
async def list_bots(active_only: bool = False, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("notification.view"))):
    return await reminder_service.get_bots(db, active_only)


@router.post("/bots", response_model=TelegramBotResponse, status_code=201)
async def create_bot(data: TelegramBotCreate, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("reminder.create"))):
    return await reminder_service.create_bot(db, data)


@router.put("/bots/{bot_id}", response_model=TelegramBotResponse)
async def update_bot(bot_id: int, data: TelegramBotUpdate, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("reminder.edit"))):
    return await reminder_service.update_bot(db, bot_id, data)


@router.delete("/bots/{bot_id}", status_code=204)
async def delete_bot(bot_id: int, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("reminder.delete"))):
    await reminder_service.delete_bot(db, bot_id)
