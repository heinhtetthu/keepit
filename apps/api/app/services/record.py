import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update, func, and_, or_, desc, asc, cast, Numeric
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.core.exceptions import NotFoundException, ConflictException
from app.models.record import Record, RecordValue
from app.models.renewal import RecordRenewal
from app.models.record_type import RecordType, RecordField
from app.models.user import User
from app.schemas.record import RecordCreate, RecordUpdate, RecordRenewalOptionsUpdate
from app.schemas.renewal import RenewalCreate, RenewalUpdate
from app.services.audit import log_audit
from app.services.clock import app_today
from app.services.validation import validate_values
from app.services.date_query import dated_records
from app.services.sensitive import pack, unpack

NUMERIC_TYPES = ("integer", "decimal", "currency", "percentage")


def _unwrap_value(rv_value: Any) -> Any:
    if isinstance(rv_value, dict) and rv_value.get('secret'):
        return unpack(rv_value)
    if isinstance(rv_value, dict) and "value" in rv_value:
        return rv_value["value"]
    return None if rv_value is None else rv_value


def _format_value(field: RecordField, value: Any) -> str:
    if value is None:
        return ""
    if field.field_type == "boolean":
        return "Yes" if value else "No"
    if field.field_type in ("date", "datetime") and isinstance(value, str):
        return value[:10] if field.field_type == "date" else value[:16].replace("T", " ")
    if field.field_type in NUMERIC_TYPES and isinstance(value, (int, float)):
        if field.field_type == "percentage":
            return f"{value}%"
        return f"{value:,}"
    if field.field_type == "multi_select" and isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


def _raw_values(record: Record, fields_by_id: dict[int, RecordField]) -> dict[str, Any]:
    raw: dict[str, Any] = {}
    for rv in record.values or []:
        field = fields_by_id.get(rv.field_id)
        if field is None:
            continue
        if field.field_type == 'secret':
            raw[field.slug] = None
            continue
        raw[field.slug] = _unwrap_value(rv.value)
    return raw


def _parse_date(val: Any) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _reminder_date(record: Record, record_type: RecordType, raw: dict[str, Any]) -> datetime | None:
    if not record_type.reminder_field_id:
        return None
    field = next((f for f in record_type.fields if f.id == record_type.reminder_field_id), None)
    if field is None:
        return None
    return _parse_date(raw.get(field.slug))


def _serialize_list(record: Record, record_type: RecordType, fields_by_id: dict[int, RecordField]) -> dict[str, Any]:
    raw = _raw_values(record, fields_by_id)
    reminder_date = _reminder_date(record, record_type, raw)
    return {
        "id": record.id,
        "name": record.name,
        "status": record.status,
        "archived": record.archived,
        "record_type_id": record.record_type_id,
        "record_type_name": record_type.name,
        "record_type_slug": record_type.slug,
        "reminder_date": reminder_date,
        "reminder_field_id": record_type.reminder_field_id,
        "values": raw,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _serialize_detail(record: Record, record_type: RecordType, fields_by_id: dict[int, RecordField]) -> dict[str, Any]:
    values_list = []
    for rv in record.values or []:
        field = fields_by_id.get(rv.field_id)
        if field is None:
            continue
        value = None if field.field_type == 'secret' else _unwrap_value(rv.value)
        values_list.append({
            "field_id": field.id,
            "field_name": field.name,
            "field_slug": field.slug,
            "field_type": field.field_type,
            "value": value,
            "display_value": '[Protected]' if field.field_type == 'secret' else _format_value(field, value),
        })
    return {
        "id": record.id,
        "record_type_id": record.record_type_id,
        "record_type_name": record_type.name,
        "record_type_slug": record_type.slug,
        "name": record.name,
        "status": record.status,
        "archived": record.archived,
        "reminder_field_id": record_type.reminder_field_id,
        "renew_before_days": record.renew_before_days,
        "values": values_list,
        "created_by": record.created_by,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "deleted_at": record.deleted_at,
    }


async def _load_type(db: AsyncSession, record_type_id: int) -> RecordType:
    result = await db.execute(
        select(RecordType).where(RecordType.id == record_type_id)
        .options(selectinload(RecordType.fields).selectinload(RecordField.options))
    )
    record_type = result.scalar_one_or_none()
    if not record_type:
        raise NotFoundException("Record type not found")
    return record_type


async def get_records(
    db: AsyncSession, record_type_id: int, page: int = 1, page_size: int = 25,
    search: str | None = None, status: str | None = None, filters: dict | None = None,
    sort: str | None = None, order: str = "asc", include_archived: bool = False,
):
    record_type = await _load_type(db, record_type_id)
    fields = {f.slug: f for f in record_type.fields if f.active}
    fields_by_id = {f.id: f for f in record_type.fields if f.active}

    base_conditions = [Record.record_type_id == record_type_id]
    if not include_archived:
        base_conditions.append(Record.archived == False)
        base_conditions.append(Record.deleted_at == None)
    query = select(Record).where(*base_conditions)
    count_query = select(func.count(Record.id)).where(*base_conditions)

    if status:
        query = query.where(Record.status == status)
        count_query = count_query.where(Record.status == status)

    if search:
        searchable_ids = [f.id for f in fields.values() if f.searchable]
        # A matching field must not multiply records, counts, or page slots.
        matches = select(RecordValue.record_id).where(
            RecordValue.field_id.in_(searchable_ids),
            RecordValue.value["value"].astext.icontains(search, autoescape=True),
        )
        condition = or_(Record.name.icontains(search, autoescape=True), Record.id.in_(matches))
        query = query.where(condition)
        count_query = count_query.where(condition)
    filters = dict(filters or {})
    logic = filters.pop('__logic', 'and')
    # "Renewed in the last N days" (manual or automatic), any record type.
    renewed_days = filters.pop('__renewed_days', None)
    if renewed_days not in (None, ""):
        try:
            days = max(0, min(3660, int(renewed_days)))
        except (TypeError, ValueError):
            days = None
        if days is not None:
            since = (await app_today(db)) - timedelta(days=days)
            renewed = select(RecordRenewal.record_id).where(
                func.coalesce(RecordRenewal.renewed_on, func.date(RecordRenewal.created_at)) >= since)
            query = query.where(Record.id.in_(renewed))
            count_query = count_query.where(Record.id.in_(renewed))

    # Collect per-field (join_alias, join_cond, conditions) for AND/OR combination
    field_filters: list[tuple] = []

    for slug, val in (filters or {}).items():
        if slug not in fields or val is None:
            continue
        if val == "" or val == {}:
            continue
        field = fields[slug]
        fv = aliased(RecordValue)
        join_cond = and_(fv.record_id == Record.id, fv.field_id == field.id)
        if isinstance(val, dict):
            # "is empty" / "not empty" operators
            if val.get("isEmpty"):
                field_filters.append((fv, join_cond, [fv.id.is_(None)]))
                continue
            if val.get("notEmpty"):
                field_filters.append((fv, join_cond, [fv.id.isnot(None)]))
                continue
            # boolean "off": false or never set (e.g. auto-renew off)
            if val.get("notTrue"):
                field_filters.append((fv, join_cond, [or_(fv.id.is_(None), fv.value["value"].astext != "true")]))
                continue
            # "any of these values" (OR) - e.g. a multi_select / in-list filter
            any_of = []
            if isinstance(val.get("in"), list):
                in_vals = [str(x) for x in val["in"] if x is not None]
                if field.field_type == "multi_select":
                    # stored as a JSON array: match when it contains any value
                    any_of = [fv.value["value"].contains([v]) for v in in_vals]
                elif in_vals:
                    any_of = [func.lower(fv.value["value"].astext).in_([v.strip().lower() for v in in_vals])]
            # range bounds (AND) - e.g. date/number ranges
            range_conds = []
            for op in ("gte", "lte", "gt", "lt"):
                if val.get(op) is not None and val.get(op) != "":
                    range_conds.append((op, val[op]))
            conditions = []
            if any_of:
                conditions.append(or_(*any_of))
            if range_conds:
                if field.field_type in NUMERIC_TYPES:
                    # bind numbers as numerics - PG has no numeric >= varchar operator;
                    # the UI sends bounds as strings, so coerce them here
                    rcol = cast(fv.value["value"], Numeric)
                    for op, opval in range_conds:
                        num = float(opval) if isinstance(opval, str) else opval
                        op_map = {"gte": rcol.__ge__, "lte": rcol.__le__, "gt": rcol.__gt__, "lt": rcol.__lt__}
                        conditions.append(op_map[op](num))
                else:
                    # ISO dates/strings compare lexicographically as text
                    rcol = fv.value["value"].astext
                    for op, opval in range_conds:
                        op_map = {"gte": rcol.__ge__, "lte": rcol.__le__, "gt": rcol.__gt__, "lt": rcol.__lt__}
                        conditions.append(op_map[op](str(opval)))
            if conditions:
                field_filters.append((fv, join_cond, conditions))
        else:
            if field.field_type == "boolean":
                # JSONB booleans astext to 'true'/'false'; binding a Python bool
                # arrives as a PG boolean type and fails operator resolution
                field_filters.append((fv, join_cond, [fv.value["value"].astext == ("true" if val else "false")]))
            elif field.field_type in NUMERIC_TYPES:
                num = float(val) if isinstance(val, str) else val
                field_filters.append((fv, join_cond, [cast(fv.value["value"], Numeric) == num]))
            elif field.field_type == "multi_select":
                field_filters.append((fv, join_cond, [fv.value["value"].contains([str(val)])]))
            elif field.field_type in ("text", "email", "url", "long_text", "phone"):
                # the filter UI advertises "contains" matching for text-like fields
                field_filters.append((fv, join_cond, [fv.value["value"].astext.icontains(str(val), autoescape=True)]))
            elif field.field_type in ("employee", "business_unit"):
                field_filters.append((fv, join_cond, [func.lower(fv.value["value"].astext) == str(val).strip().lower()]))
            else:
                field_filters.append((fv, join_cond, [fv.value["value"].astext == str(val)]))

    # Apply field filters with AND or OR logic
    if field_filters:
        if logic == 'or':
            # OR: join all value tables, combine all conditions with OR
            all_conds = []
            for fv, join_cond, conds in field_filters:
                query = query.outerjoin(fv, join_cond)
                count_query = count_query.outerjoin(fv, join_cond)
                all_conds.extend(conds)
            query = query.where(or_(*all_conds))
            count_query = count_query.where(or_(*all_conds))
        else:
            # AND: each field filter is a separate WHERE clause
            for fv, join_cond, conds in field_filters:
                query = query.outerjoin(fv, join_cond).where(*conds)
                count_query = count_query.outerjoin(fv, join_cond).where(*conds)

    total = (await db.execute(count_query)).scalar() or 0

    sort_slug = sort if sort in fields else "name"
    if sort_slug == "name":
        order_clause = desc(Record.name) if order == "desc" else asc(Record.name)
    else:
        field = fields[sort_slug]
        rv_sort = aliased(RecordValue)
        join_cond = and_(rv_sort.record_id == Record.id, rv_sort.field_id == field.id)
        query = query.outerjoin(rv_sort, join_cond)
        if field.field_type in NUMERIC_TYPES:
            sort_col = cast(rv_sort.value["value"], Numeric)
        else:
            sort_col = rv_sort.value["value"].astext
        order_clause = desc(sort_col) if order == "desc" else asc(sort_col)

    query = (
        query.order_by(order_clause, Record.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .options(selectinload(Record.values).selectinload(RecordValue.field))
    )
    items = (await db.execute(query)).scalars().unique().all()
    serialized = [_serialize_list(r, record_type, fields_by_id) for r in items]
    return serialized, total, record_type

async def get_record(db: AsyncSession, record_id: int) -> dict[str, Any]:
    result = await db.execute(
        select(Record).where(Record.id == record_id, or_(Record.deleted_at.is_(None), Record.archived == True))
        .options(selectinload(Record.values).selectinload(RecordValue.field))
    )
    record = result.scalar_one_or_none()
    if not record:
        raise NotFoundException("Record not found")
    record_type = await _load_type(db, record.record_type_id)
    fields_by_id = {f.id: f for f in record_type.fields if f.active}
    return _serialize_detail(record, record_type, fields_by_id)


async def create_record(db: AsyncSession, record_type_id: int, data: RecordCreate, user_id: int | None = None) -> dict[str, Any]:
    await db.execute(select(RecordField).where(RecordField.record_type_id == record_type_id).with_for_update(read=True))
    record_type = await _load_type(db, record_type_id)
    validate_values(record_type, data.values)
    fields_by_id = {f.id: f for f in record_type.fields if f.active}
    required_ids = {f.id for f in record_type.fields if f.active and f.required}
    provided_ids = {v.field_id for v in data.values if v.field_id in fields_by_id and v.value not in (None, "", [])}
    missing = required_ids - provided_ids
    if missing:
        names = ", ".join(fields_by_id[f].name for f in missing)
        raise ConflictException(f"Missing required fields: {names}")

    record = Record(record_type_id=record_type_id, name=data.name, status=data.status, created_by=user_id)
    db.add(record)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictException(f"A record named '{data.name}' already exists in this record type")
    for val in data.values:
        if val.field_id in fields_by_id:
            db.add(RecordValue(record_id=record.id, field_id=val.field_id, value=pack(fields_by_id[val.field_id], val.value)))
    await db.flush()
    result = await db.execute(
        select(Record).where(Record.id == record.id)
        .options(selectinload(Record.values).selectinload(RecordValue.field))
    )
    record = result.scalar_one()
    await log_audit(db, "create", "record", record.id, record.name, user_id=user_id,
                    details=f"Created {record_type.name} record")
    return _serialize_detail(record, record_type, fields_by_id)


async def update_record(db: AsyncSession, record_id: int, data: RecordUpdate, user_id: int | None = None) -> dict[str, Any]:
    record = await get_record_model(db, record_id)
    await db.execute(select(RecordField).where(RecordField.record_type_id == record.record_type_id).with_for_update(read=True)
                     .options(selectinload(RecordField.options)).execution_options(populate_existing=True))
    if data.expected_updated_at is not None and record.updated_at != data.expected_updated_at:
        raise ConflictException("This record changed since you opened it. Reload before saving.")
    record_type = await _load_type(db, record.record_type_id)
    if data.values is not None:
        validate_values(record_type, data.values, {v.field_id: _unwrap_value(v.value) for v in record.values})
    record.updated_at = datetime.now(timezone.utc)
    old_name, old_status = record.name, record.status
    existing_values = {v.field_id: v for v in record.values}
    changes: dict[str, Any] = {}
    if data.name is not None and data.name != record.name:
        changes["name"] = {"old": old_name, "new": data.name}
        record.name = data.name
    if data.status is not None and data.status != record.status:
        changes["status"] = {"old": old_status, "new": data.status}
        record.status = data.status
    if data.values is not None:
        for val in data.values:
            rv = existing_values.get(val.field_id)
            old_val = _unwrap_value(rv.value) if rv and rv.value else None
            if val.value in (None, ""):
                if rv:
                    await db.delete(rv)
                    changes[f"field:{val.field_id}"] = {"old": old_val, "new": None}
            elif rv:
                rv.value = pack(next(f for f in record_type.fields if f.id == val.field_id), val.value)
                if old_val != val.value:
                    changes[f"field:{val.field_id}"] = {"old": old_val, "new": val.value}
            else:
                db.add(RecordValue(record_id=record_id, field_id=val.field_id, value=pack(next(f for f in record_type.fields if f.id == val.field_id), val.value)))
                changes[f"field:{val.field_id}"] = {"old": None, "new": val.value}
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ConflictException(f"A record named '{data.name}' already exists in this record type")
    detail = await get_record(db, record_id)
    if changes:
        label_map = {f"field:{v['field_id']}": v["field_name"] for v in detail["values"]}
        secret_ids = {f'field:{f.id}' for f in record_type.fields if f.field_type == 'secret'}
        named_changes = {label_map.get(k, k): '[REDACTED]' if k in secret_ids else v for k, v in changes.items()}
        await log_audit(db, "update", "record", record_id, detail["name"], user_id=user_id,
                        new_values=named_changes, details=f"Updated {detail['name']}")
    return detail


async def archive_record(db: AsyncSession, record_id: int, user_id: int | None = None) -> dict[str, Any]:
    record = await get_record_model(db, record_id)
    record.archived = True
    record.deleted_at = datetime.now(timezone.utc)
    record.deleted_by = user_id
    await db.flush()
    await db.refresh(record, attribute_names=["updated_at", "archived", "deleted_at", "created_at", "updated_at"])
    record_type = await _load_type(db, record.record_type_id)
    fields_by_id = {f.id: f for f in record_type.fields if f.active}
    detail = _serialize_detail(record, record_type, fields_by_id)
    await log_audit(db, "archive", "record", record_id, detail["name"], user_id=user_id,
                    details=f"Archived {detail['name']}")
    return detail


async def delete_record(db: AsyncSession, record_id: int, user_id: int | None = None) -> None:
    result = await db.execute(select(Record).where(Record.id == record_id))
    record = result.scalar_one_or_none()
    if not record:
        raise NotFoundException("Record not found")
    record.deleted_at = datetime.now(timezone.utc)
    record.deleted_by = user_id
    record.archived = False
    await log_audit(db, 'record.trash', 'record', record_id, record.name, user_id=user_id)


async def bulk_archive(db: AsyncSession, ids: list[int], user_id: int | None = None) -> int:
    now = datetime.now(timezone.utc)
    result = await db.execute(update(Record).where(Record.id.in_(ids), Record.deleted_at.is_(None)).values(
        archived=True, deleted_at=now, deleted_by=user_id, updated_at=now,
    ).returning(Record.id))
    count = len(result.scalars().all())
    await log_audit(db, 'record.bulk_archive', 'record_batch', user_id=user_id, new_values={'record_ids': ids, 'count': count})
    return count


async def bulk_update_status(db: AsyncSession, ids: list[int], status: str, user_id: int | None = None) -> int:
    result = await db.execute(update(Record).where(Record.id.in_(ids), Record.deleted_at.is_(None)).values(
        status=status, updated_at=datetime.now(timezone.utc),
    ).returning(Record.id))
    count = len(result.scalars().all())
    await log_audit(db, 'record.bulk_status', 'record_batch', user_id=user_id, new_values={'record_ids': ids, 'count': count, 'status': status})
    return count


async def bulk_delete(db: AsyncSession, ids: list[int], user_id: int | None = None) -> int:
    now = datetime.now(timezone.utc)
    result = await db.execute(update(Record).where(Record.id.in_(ids), Record.deleted_at.is_(None)).values(
        deleted_at=now, deleted_by=user_id, archived=False, updated_at=now,
    ).returning(Record.id))
    count = len(result.scalars().all())
    await log_audit(db, 'record.bulk_trash', 'record_batch', user_id=user_id, new_values={'record_ids': ids, 'count': count})
    return count

async def get_record_model(db: AsyncSession, record_id: int) -> Record:
    result = await db.execute(
        select(Record).where(Record.id == record_id, Record.deleted_at.is_(None))
        .with_for_update().execution_options(populate_existing=True)
        .options(selectinload(Record.values).selectinload(RecordValue.field))
    )
    record = result.scalar_one_or_none()
    if not record:
        raise NotFoundException("Record not found")
    return record


async def duplicate_record(db: AsyncSession, record_id: int, user_id: int | None = None) -> dict[str, Any]:
    result = await db.execute(
        select(Record).where(Record.id == record_id, Record.deleted_at.is_(None))
        .options(selectinload(Record.values))
    )
    source = result.scalar_one_or_none()
    if not source:
        raise NotFoundException("Record not found")
    record_type = await _load_type(db, source.record_type_id)
    await db.execute(select(RecordField).where(RecordField.record_type_id == source.record_type_id).with_for_update(read=True)
        .options(selectinload(RecordField.options)).execution_options(populate_existing=True))
    fields_by_id = {f.id: f for f in record_type.fields if f.active}

    existing_names = set((await db.execute(
        select(Record.name).where(Record.record_type_id == source.record_type_id)
    )).scalars().all())
    base_name = f"{source.name} (Copy)"
    name = base_name
    n = 2
    while name in existing_names:
        name = f"{base_name} {n}"
        n += 1

    copy = Record(
        record_type_id=source.record_type_id,
        name=name,
        status=source.status,
        created_by=user_id,
    )
    db.add(copy)
    await db.flush()
    for rv in source.values:
        if rv.field_id in fields_by_id:
            db.add(RecordValue(record_id=copy.id, field_id=rv.field_id, value=pack(fields_by_id[rv.field_id], _unwrap_value(rv.value))))
    await db.flush()
    await log_audit(db, 'record.duplicate', 'record', copy.id, copy.name, user_id=user_id, details=f'Duplicated record {record_id}')
    return await get_record(db, copy.id)


async def restore_record(db: AsyncSession, record_id: int, user_id: int | None = None) -> dict[str, Any]:
    result = await db.execute(
        select(Record).where(Record.id == record_id)
        .with_for_update().execution_options(populate_existing=True)
        .options(selectinload(Record.values).selectinload(RecordValue.field))
    )
    record = result.scalar_one_or_none()
    if not record:
        raise NotFoundException("Record not found")
    record.archived = False
    record.deleted_at = None
    record.deleted_by = None
    await db.flush()
    await db.refresh(record, attribute_names=["updated_at", "archived", "deleted_at", "created_at"])
    record_type = await _load_type(db, record.record_type_id)
    fields_by_id = {f.id: f for f in record_type.fields if f.active}
    detail = _serialize_detail(record, record_type, fields_by_id)
    await log_audit(db, "restore", "record", record_id, detail["name"], user_id=user_id,
                    details=f"Restored {detail['name']} from archive")
    return detail

async def renew_record(db: AsyncSession, record_id: int, data: RenewalCreate, user_id: int | None = None) -> dict[str, Any]:
    record = await get_record_model(db, record_id)
    record_type = await _load_type(db, record.record_type_id)
    fields_by_id = {f.id: f for f in record_type.fields if f.active}
    if not record_type.reminder_field_id:
        raise ConflictException("This record type has no renewal/expiry field configured")
    reminder_field = next((f for f in record_type.fields if f.id == record_type.reminder_field_id), None)
    if reminder_field is None:
        raise ConflictException("Renewal/expiry field not found")

    old_raw = _raw_values(record, fields_by_id).get(reminder_field.slug)
    old_date = _parse_date(old_raw)

    new_date = datetime.strptime(data.new_date, "%Y-%m-%d").date()
    if old_date and new_date <= old_date.date():
        raise ConflictException("Renewal date must be after the current expiry date")
    renewed_on = (
        datetime.strptime(data.renewed_on, "%Y-%m-%d").date()
        if data.renewed_on
        else await app_today(db)
    )

    existing = await db.execute(
        select(RecordValue).where(RecordValue.record_id == record_id, RecordValue.field_id == reminder_field.id)
    )
    rv = existing.scalar_one_or_none()
    if rv:
        rv.value = {"value": data.new_date}
    else:
        db.add(RecordValue(record_id=record_id, field_id=reminder_field.id, value={"value": data.new_date}))
    record.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(record, attribute_names=["updated_at"])

    renewal = RecordRenewal(
        record_id=record_id,
        renewed_by=user_id,
        renewed_on=renewed_on,
        old_date=old_date.date() if old_date else None,
        new_date=new_date,
        cost=data.cost,
        currency=data.currency or None,
        payment_method=data.payment_method or None,
        payment_reference=data.payment_reference or None,
        location=data.location or None,
        notes=data.notes or None,
    )
    db.add(renewal)
    await db.flush()
    await log_audit(db, "renew", "record", record_id, record.name, user_id=user_id,
                    details=f"Renewed {record.name}: {old_date.date() if old_date else 'none'} -> {new_date}")

    return {"record": await get_record(db, record_id), "renewal_id": renewal.id}


async def set_renewal_options(
    db: AsyncSession, record_id: int, data: RecordRenewalOptionsUpdate, user_id: int | None = None
) -> dict[str, Any]:
    """Per-record renewal timing: renew N days before the expiry date.

    renew_before_days=None restores the default (renew on/after the expiry day).
    """
    record = await get_record_model(db, record_id)
    record.renew_before_days = data.renew_before_days
    await db.flush()
    days = data.renew_before_days
    detail_text = (
        f"Renew-before-expiry set to {days} day{'s' if days != 1 else ''} before"
        if days
        else "Renew-before-expiry cleared (renews at expiry)"
    )
    await log_audit(db, "update", "record", record_id, record.name, user_id=user_id,
                    details=detail_text)
    # Re-fetch fresh: the flush expires server-managed attributes, which a sync
    # serializer cannot lazy-load in async context.
    return await get_record(db, record_id)


# ---------------- Automatic renewal (auto-renew on, at expiry) ----------------

_CYCLE_MONTHS: dict[str, int] = {
    "monthly": 1, "quarterly": 3, "semi-annual": 6, "semiannual": 6, "semi annual": 6,
    "yearly": 12, "annual": 12, "biennial": 24,
}
AUTO_RENEW_FIELD_NAMES = {"Auto Renewal", "Auto-renewal", "Auto Renewal?", "Auto Renew", "Auto-renew"}


def auto_renew_enabled(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().casefold() in {"true", "yes", "1", "y"})


def _add_months(d: date, months: int) -> date:
    """Same day in a later month; clamps to the last day of short months."""
    m = d.month - 1 + months
    year, month = d.year + m // 12, m % 12 + 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(d.day, last))


def _find_field(names: set[str], record_type: RecordType) -> RecordField | None:
    wanted = {n.lower() for n in names} | {n.lower().replace(" ", "_") for n in names}
    for f in record_type.fields or []:
        if not f.active or f.field_type == 'secret':
            continue
        if f.name.lower() in wanted or f.slug in wanted:
            return f
    return None


def auto_renew_months(record_type: RecordType, raw: dict[str, Any]) -> int | None:
    """Months the engine will extend this record by, or None when it will not
    auto-renew (Auto Renew off, or a cycle such as 'One-time')."""
    auto_field = _find_field(AUTO_RENEW_FIELD_NAMES, record_type)
    if auto_field is None or not auto_renew_enabled(raw.get(auto_field.slug)):
        return None
    cycle_field = _find_field({"Billing Cycle", "Renewal Cycle"}, record_type)
    cycle = "" if cycle_field is None else str(raw.get(cycle_field.slug) or "").strip().lower()
    return _CYCLE_MONTHS.get(cycle) if cycle else 12


async def type_summary(db: AsyncSession, record_type_id: int) -> dict[str, Any]:
    """Counts behind the quick tabs on a record-type page."""
    from app.services.assignment import _assignee_field

    record_type = await _load_type(db, record_type_id)
    today = await app_today(db)

    async def count(filters: dict | None = None) -> int:
        _, total, _ = await get_records(db, record_type_id, 1, 1, filters=filters)
        return total

    reminder = next((f for f in record_type.fields if f.id == record_type.reminder_field_id and f.active), None)
    auto_field = _find_field(AUTO_RENEW_FIELD_NAMES, record_type)
    assignee = _assignee_field(record_type) if record_type.track_ownership else None
    out: dict[str, Any] = {"total": await count(), "expiring": None, "expired": None,
                           "unassigned": None, "auto_renew_off": None, "today": today.isoformat(),
                           "in_30_days": (today + timedelta(days=30)).isoformat()}
    if reminder is not None:
        out["expiring"] = await count({reminder.slug: {"gte": today.isoformat(), "lte": out["in_30_days"]}})
        out["expired"] = await count({reminder.slug: {"lt": today.isoformat()}})
    if assignee is not None:
        out["unassigned"] = await count({assignee.slug: {"isEmpty": True}})
    if auto_field is not None:
        out["auto_renew_off"] = await count({auto_field.slug: {"notTrue": True}})
    return out


def effective_lead(record: Record, record_type: RecordType) -> int:
    """Days before expiry to renew: the record's own setting, else the type default."""
    for days in (record.renew_before_days, record_type.renew_before_days):
        if days:
            try:
                return max(0, int(days))
            except (TypeError, ValueError):
                return 0
    return 0


async def auto_renew_due_records(db: AsyncSession) -> dict[str, int]:
    """Renew records with Auto Renew on once they enter their renewal window.

    The window opens `lead` days before expiry (record setting, else the type
    default, else on the expiry date). Renewing early behaves like the
    registrar does: the renewal happens now and the expiry moves forward by
    whole billing cycles straight away, so nothing keeps showing as expiring.
    A renewal pre-recorded by the old engine (same old_date) is reused rather
    than duplicated. Costs carry over from the record's Cost/Currency fields;
    a missing billing cycle means one year.
    """
    today = await app_today(db)

    types = (await db.execute(
        select(RecordType).where(RecordType.active.is_(True)).options(selectinload(RecordType.fields))
    )).scalars().all()

    auto_renewed = 0
    skipped = 0

    for rt in types:
        if not rt.reminder_field_id:
            continue
        reminder_field = next((f for f in rt.fields if f.id == rt.reminder_field_id and f.active), None)
        auto_field = _find_field(AUTO_RENEW_FIELD_NAMES, rt)
        cycle_field = _find_field({"Billing Cycle", "Renewal Cycle"}, rt)
        cost_field = _find_field({"Cost"}, rt)
        currency_field = _find_field({"Currency"}, rt)
        if reminder_field is None or reminder_field.field_type not in {"date", "datetime"} or auto_field is None:
            continue
        type_lead = rt.renew_before_days or 0

        records = await db.stream_scalars(
            select(Record).where(
                Record.record_type_id == rt.id,
                Record.archived == False,  # noqa: E712
                Record.deleted_at == None,  # noqa: E711
                Record.id.in_(dated_records(reminder_field.id, end=today + func.coalesce(Record.renew_before_days, type_lead))),
            ).with_for_update().execution_options(populate_existing=True).options(selectinload(Record.values))
            .execution_options(yield_per=100))
        async for record in records:
            v = _raw_values(record, {f.id: f for f in rt.fields if f.active})
            expiry = _parse_date(v.get(reminder_field.slug))
            if expiry is None:
                continue
            lead = effective_lead(record, rt)
            horizon = today + timedelta(days=lead)
            expiry_d = expiry.date()
            if expiry_d > horizon:
                continue  # not in the renewal window yet
            if not auto_renew_enabled(v.get(auto_field.slug)):
                skipped += 1
                continue  # Auto Renew off: the reminder pipeline alerts instead
            cycle = "" if cycle_field is None else str(v.get(cycle_field.slug) or "").strip().lower()
            months = _CYCLE_MONTHS.get(cycle) if cycle else 12
            if not months:
                skipped += 1
                continue  # e.g. "One-time": nothing to extend

            term = f"{cycle_field.name}: {v.get(cycle_field.slug)}" if cycle else "yearly default, no billing cycle set"
            note = f"Auto-renewed ({term})" + (f", {lead} day{'s' if lead != 1 else ''} before expiry" if lead else "")
            carried_cost = v.get(cost_field.slug) if cost_field else None
            carried_currency = v.get(currency_field.slug) if currency_field else None

            for _ in range(600):
                if expiry_d > horizon:
                    break
                existing = (await db.execute(select(RecordRenewal).where(
                    RecordRenewal.record_id == record.id, RecordRenewal.old_date == expiry_d,
                ).limit(1))).scalar_one_or_none()
                if existing:
                    expiry_d = existing.new_date
                    continue
                next_d = _add_months(expiry_d, months)
                db.add(RecordRenewal(
                    record_id=record.id, renewed_by=None, is_automatic=True,
                    renewed_on=min(today, expiry_d), old_date=expiry_d, new_date=next_d,
                    cost=carried_cost, currency=carried_currency, notes=note,
                ))
                expiry_d = next_d
                auto_renewed += 1

            record.updated_at = datetime.now(timezone.utc)
            rv = (await db.execute(select(RecordValue).where(
                RecordValue.record_id == record.id, RecordValue.field_id == reminder_field.id,
            ))).scalar_one_or_none()
            if rv:
                rv.value = {"value": expiry_d.isoformat()}
            else:
                db.add(RecordValue(record_id=record.id, field_id=reminder_field.id, value={"value": expiry_d.isoformat()}))
            if record.status == "expired":
                record.status = "active"
            await db.flush()

    return {"auto_renewed": auto_renewed, "auto_skipped": skipped}


async def list_automatic_renewals(db: AsyncSession, allowed: list[int] | None,
                                  page: int, page_size: int, search: str):
    query = (
        select(
            RecordRenewal.id, RecordRenewal.record_id, RecordRenewal.created_at,
            RecordRenewal.renewed_on, RecordRenewal.old_date, RecordRenewal.new_date,
            Record.name.label("record_name"), RecordType.name.label("record_type"),
            RecordType.slug.label("record_type_slug"),
            or_(Record.deleted_at.is_(None), Record.archived.is_(True)).label("can_open"),
        )
        .join(Record, Record.id == RecordRenewal.record_id)
        .join(RecordType, RecordType.id == Record.record_type_id)
        .where(RecordRenewal.is_automatic.is_(True))
    )
    if allowed is not None:
        query = query.where(Record.record_type_id.in_(allowed))
    if search:
        query = query.where(or_(
            Record.name.icontains(search, autoescape=True),
            RecordType.name.icontains(search, autoescape=True),
        ))
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = await db.execute(query.order_by(RecordRenewal.created_at.desc(), RecordRenewal.id.desc())
                            .offset((page - 1) * page_size).limit(page_size))
    return rows.mappings().all(), total or 0


async def get_record_renewals(db: AsyncSession, record_id: int) -> list[dict[str, Any]]:
    record = await db.execute(select(Record.id).where(Record.id == record_id))
    if record.scalar_one_or_none() is None:
        raise NotFoundException("Record not found")
    result = await db.execute(
        select(RecordRenewal, User.name.label("renewed_by_name"))
        .outerjoin(User, RecordRenewal.renewed_by == User.id)
        .where(RecordRenewal.record_id == record_id)
        .order_by(RecordRenewal.created_at.desc())
    )
    return [
        {
            "id": renewal.id,
            "record_id": renewal.record_id,
            "renewed_by_name": name,
            "renewed_on": renewal.renewed_on,
            "old_date": renewal.old_date,
            "new_date": renewal.new_date,
            "cost": float(renewal.cost) if renewal.cost is not None else None,
            "currency": renewal.currency,
            "payment_method": renewal.payment_method,
            "payment_reference": renewal.payment_reference,
            "location": renewal.location,
            "notes": renewal.notes,
            "renewed_at": renewal.created_at,
        }
        for renewal, name in result.all()
    ]


async def _sync_expiry_with_latest_renewal(db: AsyncSession, record_id: int) -> None:
    """Keep the record's reminder/expiry value equal to the newest history entry."""
    record = (await db.execute(
        select(Record).where(Record.id == record_id).options(selectinload(Record.values))
    )).scalar_one()
    latest = (await db.execute(
        select(RecordRenewal).where(RecordRenewal.record_id == record_id)
        .order_by(RecordRenewal.renewed_on.desc().nullslast(), RecordRenewal.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if latest is None:
        return  # nothing left to derive from; leave the record untouched
    record_type = await _load_type(db, record.record_type_id)
    if not record_type.reminder_field_id:
        return
    rv = (await db.execute(
        select(RecordValue).where(RecordValue.record_id == record_id, RecordValue.field_id == record_type.reminder_field_id)
    )).scalar_one_or_none()
    if rv:
        rv.value = {"value": latest.new_date.isoformat()}
    else:
        db.add(RecordValue(record_id=record_id, field_id=record_type.reminder_field_id, value={"value": latest.new_date.isoformat()}))
    await db.flush()


async def update_record_renewal(db: AsyncSession, record_id: int, renewal_id: int, data: RenewalUpdate, user_id: int) -> dict[str, Any]:
    record = await get_record_model(db, record_id)
    record.updated_at = datetime.now(timezone.utc)
    row = (await db.execute(
        select(RecordRenewal).where(RecordRenewal.id == renewal_id, RecordRenewal.record_id == record_id)
    )).scalar_one_or_none()
    if row is None:
        raise NotFoundException("Renewal entry not found")
    updates = data.model_dump(exclude_unset=True)
    if updates.get("new_date"):
        updates["new_date"] = datetime.strptime(updates["new_date"], "%Y-%m-%d").date()
    if "renewed_on" in updates and updates["renewed_on"]:
        updates["renewed_on"] = datetime.strptime(updates["renewed_on"], "%Y-%m-%d").date()
    for k, v in updates.items():
        setattr(row, k, v)
    await db.flush()
    was_latest = (await db.execute(
        select(func.count(RecordRenewal.id)).where(
            RecordRenewal.record_id == record_id,
            RecordRenewal.id != renewal_id,
            func.coalesce(RecordRenewal.renewed_on, RecordRenewal.new_date) > (row.renewed_on or row.new_date),
        )
    )).scalar() or 0
    if was_latest == 0:
        await _sync_expiry_with_latest_renewal(db, record_id)
    record_name = (await db.execute(select(Record.name).where(Record.id == record_id))).scalar_one_or_none() or str(record_id)
    await log_audit(db, "renewal.update", "record", record_id, record_name, user_id=user_id,
                    details=f"Admin edited renewal entry #{renewal_id}")
    return await get_record_renewal_serialized(db, record_id, renewal_id)


async def delete_record_renewal(db: AsyncSession, record_id: int, renewal_id: int, user_id: int) -> None:
    record = await get_record_model(db, record_id)
    record.updated_at = datetime.now(timezone.utc)
    row = (await db.execute(
        select(RecordRenewal).where(RecordRenewal.id == renewal_id, RecordRenewal.record_id == record_id)
    )).scalar_one_or_none()
    if row is None:
        raise NotFoundException("Renewal entry not found")
    revert_to = row.old_date  # if this was the only/newest entry, expiry rolls back to the pre-renewal date
    await db.delete(row)
    await db.flush()
    latest = (await db.execute(
        select(RecordRenewal).where(RecordRenewal.record_id == record_id)
        .order_by(RecordRenewal.renewed_on.desc().nullslast(), RecordRenewal.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if latest is None and revert_to is not None:
        # no history left - restore the expiry the renewal had moved away from
        record = await db.get(Record, record_id)
        record_type = await _load_type(db, record.record_type_id)
        if record_type.reminder_field_id:
            rv = (await db.execute(
                select(RecordValue).where(RecordValue.record_id == record_id, RecordValue.field_id == record_type.reminder_field_id)
            )).scalar_one_or_none()
            if rv:
                rv.value = {"value": revert_to.isoformat()}
            else:
                db.add(RecordValue(record_id=record_id, field_id=record_type.reminder_field_id, value={"value": revert_to.isoformat()}))
    else:
        await _sync_expiry_with_latest_renewal(db, record_id)
    record_name = (await db.execute(select(Record.name).where(Record.id == record_id))).scalar_one_or_none() or str(record_id)
    await log_audit(db, "renewal.delete", "record", record_id, record_name, user_id=user_id,
                    details=f"Admin deleted renewal entry #{renewal_id}")


async def get_record_renewal_serialized(db: AsyncSession, record_id: int, renewal_id: int) -> dict[str, Any]:
    all_renewals = await get_record_renewals(db, record_id)
    for r in all_renewals:
        if r["id"] == renewal_id:
            return r
    raise NotFoundException("Renewal entry not found")
