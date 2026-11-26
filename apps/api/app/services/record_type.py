import re
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundException, ConflictException
from app.models.record_type import RecordType, RecordField, RecordFieldOption
from app.schemas.record_type import RecordTypeCreate, RecordTypeUpdate, RecordFieldCreate, RecordFieldUpdate
from app.services.audit import log_audit
from app.services.record import AUTO_RENEW_FIELD_NAMES, _find_field
from app.services.sensitive import protect, pack, unpack


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def configure_renewal_fields(record_type: RecordType) -> bool:
    """Recognize an unambiguous expiry field and provide an opt-in switch."""
    date_fields = [field for field in record_type.fields
                   if field.active and field.field_type in {"date", "datetime"}]
    changed = False
    if record_type.reminder_field_id is None:
        candidates = [field for field in date_fields
                      if slugify(field.name) in {"expiry_date", "expiration_date", "renewal_date"}]
        if len(candidates) == 1:
            record_type.reminder_field_id = candidates[0].id
            changed = True
    if not any(field.id == record_type.reminder_field_id for field in date_fields):
        return changed
    if _find_field(AUTO_RENEW_FIELD_NAMES, record_type) is not None:
        return changed
    # Reuse a deactivated switch only when an administrator enables it again.
    switch_slugs = {slugify(name) for name in AUTO_RENEW_FIELD_NAMES}
    if any(field.slug in switch_slugs for field in record_type.fields):
        return changed
    record_type.fields.append(RecordField(
        name="Auto Renewal", slug="auto_renewal", field_type="boolean",
        display_order=max(field.display_order for field in record_type.fields) + 1,
        show_in_list=False,
        help_text="Enable to advance the expiry automatically. The default term is yearly.",
    ))
    return True


async def get_record_types(db: AsyncSession, include_inactive: bool = False):
    query = select(RecordType).options(selectinload(RecordType.fields).selectinload(RecordField.options))
    if not include_inactive:
        query = query.where(RecordType.active == True)
    result = await db.execute(query.order_by(RecordType.name))
    return result.scalars().all()


async def get_record_type(db: AsyncSession, type_id: int) -> RecordType:
    result = await db.execute(
        select(RecordType).where(RecordType.id == type_id).options(selectinload(RecordType.fields).selectinload(RecordField.options))
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise NotFoundException("Record type not found")
    return rt


async def get_record_type_by_slug(db: AsyncSession, slug: str) -> RecordType:
    result = await db.execute(
        select(RecordType).where(RecordType.slug == slug).options(selectinload(RecordType.fields).selectinload(RecordField.options))
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise NotFoundException("Record type not found")
    return rt


async def _ensure_bot_exists(db: AsyncSession, bot_id: int | None) -> None:
    if bot_id is None:
        return
    from app.models.reminder import TelegramBot
    bot = (await db.execute(select(TelegramBot.id).where(TelegramBot.id == bot_id))).scalar_one_or_none()
    if bot is None:
        raise NotFoundException("Telegram bot not found")


async def create_record_type(db: AsyncSession, data: RecordTypeCreate, user_id: int | None = None) -> RecordType:
    await _ensure_bot_exists(db, data.telegram_bot_id)
    base_slug = slugify(data.name)
    slug = base_slug
    counter = 1
    while True:
        existing = await db.execute(select(RecordType).where(RecordType.slug == slug))
        if not existing.scalar_one_or_none():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1
    rt = RecordType(name=data.name, slug=slug, description=data.description, icon=data.icon, created_by=user_id, telegram_bot_id=data.telegram_bot_id)
    db.add(rt)
    await db.flush()
    for idx, field_data in enumerate(data.fields):
        field = RecordField(
            record_type_id=rt.id, name=field_data.name, slug=slugify(field_data.name),
            field_type=field_data.field_type, required=field_data.required, unique=field_data.unique,
            searchable=field_data.searchable, sortable=field_data.sortable, filterable=field_data.filterable,
            show_in_list=field_data.show_in_list, show_in_details=field_data.show_in_details,
            show_in_reports=field_data.show_in_reports, display_order=field_data.display_order or idx,
            default_value=field_data.default_value, help_text=field_data.help_text,
        )
        db.add(field)
        protect(field)
        await db.flush()
        for opt_idx, opt in enumerate(field_data.options):
            db.add(RecordFieldOption(field_id=field.id, value=opt.value, label=opt.label, display_order=opt.display_order or opt_idx))
    await db.flush()
    rt = await get_record_type(db, rt.id)
    configure_renewal_fields(rt)
    await log_audit(db, "create", "record_type", rt.id, rt.name, user_id=user_id,
                    details=f"Created record type '{rt.name}' with {len(data.fields)} fields")
    return await get_record_type(db, rt.id)


async def delete_record_type(db: AsyncSession, type_id: int, user_id: int | None = None) -> None:
    rt = await get_record_type(db, type_id)
    from app.models.record import Record
    if (await db.execute(select(Record.id).where(Record.record_type_id == type_id).limit(1))).first():
        raise ConflictException('This type still contains records, including archived or trashed records. Deactivate it to preserve its data.')
    name = rt.name
    await log_audit(db, "delete", "record_type", type_id, name, user_id=user_id,
                    details=f"Deleted record type '{name}'")
    await db.delete(rt)


async def update_record_type(db: AsyncSession, type_id: int, data: RecordTypeUpdate) -> RecordType:
    if data.reminder_field_id is not None:
        await db.execute(select(RecordType.id).where(RecordType.id == type_id).with_for_update())
    rt = await get_record_type(db, type_id)
    if data.name is not None:
        rt.name = data.name
    if data.description is not None:
        rt.description = data.description
    if data.icon is not None:
        rt.icon = data.icon
    if data.active is not None:
        rt.active = data.active
    if data.reminder_field_id is not None:
        # Validate the field belongs to this record type
        field_ids = {f.id for f in rt.fields}
        if data.reminder_field_id not in field_ids:
            raise ConflictException("Reminder field must belong to this record type")
        rt.reminder_field_id = data.reminder_field_id
        configure_renewal_fields(rt)
    if "telegram_bot_id" in data.model_fields_set:
        await _ensure_bot_exists(db, data.telegram_bot_id)
        rt.telegram_bot_id = data.telegram_bot_id
    if data.renew_before_days is not None:
        rt.renew_before_days = data.renew_before_days or None
    if data.track_ownership is not None and data.track_ownership != rt.track_ownership:
        rt.track_ownership = data.track_ownership
        if data.track_ownership:
            # First enable: seed the ownership timeline from current field values.
            from app.services.assignment import ensure_baselines_for_type
            await ensure_baselines_for_type(db, rt)
    await log_audit(db, 'record_type.update', 'record_type', rt.id, rt.name, new_values=data.model_dump(exclude_unset=True))
    await db.flush()
    return await get_record_type(db, type_id)


async def reorder_fields(db: AsyncSession, type_id: int, field_ids: list[int], user_id: int | None = None) -> None:
    rt = await get_record_type(db, type_id)
    type_field_ids = {f.id for f in rt.fields}
    if set(field_ids) != type_field_ids:
        raise ConflictException("Reorder list must contain exactly the fields of this record type")
    for order, field_id in enumerate(field_ids):
        field = next(f for f in rt.fields if f.id == field_id)
        field.display_order = order
    await log_audit(db, 'field.reorder', 'record_type', type_id, user_id=user_id, new_values={'field_ids': field_ids})
    await db.flush()


async def add_field(db: AsyncSession, type_id: int, data: RecordFieldCreate) -> RecordField:
    is_date = data.field_type in {"date", "datetime"}
    await db.execute(select(RecordType.id).where(RecordType.id == type_id).with_for_update())
    rt = await get_record_type(db, type_id)
    field = RecordField(record_type_id=type_id, name=data.name, slug=slugify(data.name), field_type=data.field_type,
        required=data.required, unique=data.unique, searchable=data.searchable, sortable=data.sortable,
        filterable=data.filterable, show_in_list=data.show_in_list, show_in_details=data.show_in_details,
        show_in_reports=data.show_in_reports, display_order=data.display_order, default_value=data.default_value, help_text=data.help_text)
    db.add(field)
    protect(field)
    await db.flush()
    for idx, opt in enumerate(data.options):
        db.add(RecordFieldOption(field_id=field.id, value=opt.value, label=opt.label, display_order=opt.display_order or idx))
    await db.flush()
    if is_date:
        await db.refresh(rt, ["fields"])
        configure_renewal_fields(rt)
    await db.refresh(field, ["options", "updated_at", "created_at"])
    await log_audit(db, 'field.create', 'record_type', type_id, details=f'Created field {field.id}')
    return field


async def update_field(db: AsyncSession, field_id: int, data: RecordFieldUpdate) -> RecordField:
    result = await db.execute(select(RecordField).where(RecordField.id == field_id).options(selectinload(RecordField.options)))
    field = result.scalar_one_or_none()
    if not field:
        raise NotFoundException("Field not found")
    if field.field_type == 'secret' and data.field_type not in (None, 'secret'):
        raise ConflictException('Protected fields cannot be converted back to ordinary fields')
    if data.field_type == 'secret' and field.field_type not in ('text', 'long_text', 'secret'):
        raise ConflictException('Only text fields can be classified as protected text')
    if data.field_type == 'secret':
        from datetime import datetime, timezone
        from sqlalchemy import update
        from app.models.report_job import ReportJob
        from app.models.record import RecordValue, Record
        from app.models.audit import AuditLog
        if field.name.lower() in {'product name', 'assigned to', 'business unit', 'employee'}:
            raise ConflictException('Ownership fields cannot be classified as protected text')
        field = (await db.execute(select(RecordField).where(RecordField.id == field_id).with_for_update()
                                  .options(selectinload(RecordField.options)))).scalar_one()
        values = (await db.execute(select(RecordValue).where(RecordValue.field_id == field_id))).scalars().all()
        field.field_type = 'secret'
        for value in values:
            value.value = pack(field, unpack(value.value))
        # Historical field labels can have changed. Redact payloads for affected
        # records rather than attempting incomplete name-based redaction.
        from app.services.audit import seal
        logs = await db.stream_scalars(select(AuditLog).where(AuditLog.entity_type == 'record',
            AuditLog.entity_id.in_(select(Record.id).where(Record.record_type_id == field.record_type_id)))
            .execution_options(yield_per=200))
        async for entry in logs:
            entry.old_values = None
            entry.new_values = {'redacted': 'Protected field classification'}
            seal(entry)
        # Previously generated files can contain the newly classified text.
        # Expire pending/processing artifacts too, fencing in-flight renderers.
        await db.execute(update(ReportJob).where(ReportJob.record_type_id == field.record_type_id)
                         .values(expires_at=datetime.now(timezone.utc)))
    for attr in ["name", "field_type", "required", "unique", "searchable", "sortable", "filterable",
                 "show_in_list", "show_in_details", "show_in_reports", "display_order", "default_value", "help_text", "active"]:
        val = getattr(data, attr, None)
        if val is not None:
            setattr(field, attr, val)
    protect(field)
    await db.flush()
    await db.refresh(field, ["options", "updated_at", "created_at"])
    await log_audit(db, 'field.update', 'record_type', field.record_type_id, details=f'Updated field {field.id}')
    return field


async def delete_field(db: AsyncSession, field_id: int) -> None:
    result = await db.execute(select(RecordField).where(RecordField.id == field_id))
    field = result.scalar_one_or_none()
    if not field:
        raise NotFoundException("Field not found")
    await log_audit(db, 'field.delete', 'record_type', field.record_type_id, details=f'Deleted field {field_id}')
    await db.delete(field)


async def add_option(db: AsyncSession, field_id: int, value: str, label: str | None = None) -> RecordFieldOption:
    result = await db.execute(
        select(RecordField).where(RecordField.id == field_id).options(selectinload(RecordField.options))
    )
    field = result.scalar_one_or_none()
    if not field:
        raise NotFoundException("Field not found")
    if field.field_type not in ("select", "multi_select"):
        raise ConflictException("Options can only be added to select or multi_select fields")
    dup = await db.execute(
        select(RecordFieldOption).where(RecordFieldOption.field_id == field_id, RecordFieldOption.value == value)
    )
    if dup.scalar_one_or_none():
        raise ConflictException(f"Option '{value}' already exists")
    option = RecordFieldOption(
        field_id=field_id, value=value, label=label or value, display_order=len(field.options)
    )
    db.add(option)
    await db.flush()
    await log_audit(db, 'field.option_create', 'record_type', field.record_type_id, details=f'Added option to field {field_id}')
    return option


async def delete_option(db: AsyncSession, field_id: int, option_id: int) -> None:
    result = await db.execute(
        select(RecordFieldOption).where(RecordFieldOption.id == option_id, RecordFieldOption.field_id == field_id)
    )
    option = result.scalar_one_or_none()
    if not option:
        raise NotFoundException("Option not found")
    field = await db.get(RecordField, field_id)
    await log_audit(db, 'field.option_delete', 'record_type', field.record_type_id, details=f'Deleted option {option_id}')
    await db.delete(option)
