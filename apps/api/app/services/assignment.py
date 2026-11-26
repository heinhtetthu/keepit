from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from types import SimpleNamespace
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ValidationException, NotFoundException
from app.models.assignment import RecordAssignment
from app.models.employee import Employee
from app.models.record import Record, RecordValue
from app.models.record_type import RecordType, RecordField
from app.schemas.assignment import AssignmentCreate, AssignmentUpdate, BulkAssignRequest, SwapRequest, ReleaseRequest
from app.services.audit import log_audit

UNASSIGNED = "Unassigned"

# Name conventions used to locate the "current state" fields on a tracked type
# when it predates the dedicated employee / business_unit field types.
ASSIGNEE_NAMES = {"Assigned To", "Assignee", "Holder", "User"}
BU_NAMES = {"Business Unit", "BU"}
COST_NAMES = {"Cost", "Seat Cost", "Seat Cost (Monthly)"}
CURRENCY_NAMES = {"Currency"}
PRODUCT_NAMES = {"Product Name", "Product", "License Plan", "Plan"}


def _find_field(names: set[str], record_type: RecordType) -> RecordField | None:
    wanted = {n.lower() for n in names} | {n.lower().replace(" ", "_") for n in names}
    for f in record_type.fields or []:
        if not f.active or f.field_type == 'secret':
            continue
        if f.name.lower() in wanted or f.slug in wanted:
            return f
    return None


def _field_by_type(field_type: str, record_type: RecordType, names: set[str]) -> RecordField | None:
    """Dedicated field-type field (e.g. employee/business_unit), else name-convention fallback."""
    typed = next((f for f in record_type.fields or []
                  if f.active and f.field_type == field_type), None)
    return typed if typed is not None else _find_field(names, record_type)


def _assignee_field(record_type: RecordType) -> RecordField | None:
    return _field_by_type("employee", record_type, ASSIGNEE_NAMES)


def _bu_field(record_type: RecordType) -> RecordField | None:
    return _field_by_type("business_unit", record_type, BU_NAMES)


def _email_field(record_type: RecordType) -> RecordField | None:
    """The holder's email on a tracked type (first active email field)."""
    return next((f for f in record_type.fields or [] if f.active and f.field_type == "email"), None)


def _unwrap(v: Any) -> Any:
    if isinstance(v, dict) and "value" in v:
        return v["value"]
    return v


async def _get_record(db: AsyncSession, record_id: int) -> Record:
    row = (await db.execute(
        select(Record).where(Record.id == record_id, Record.deleted_at.is_(None))
        .with_for_update().execution_options(populate_existing=True).options(selectinload(Record.values))
    )).scalar_one_or_none()
    if not row:
        raise NotFoundException("Record not found")
    return row


async def _get_type(db: AsyncSession, type_id: int) -> RecordType:
    return (await db.execute(
        select(RecordType).where(RecordType.id == type_id)
        .options(selectinload(RecordType.fields).selectinload(RecordField.options))
    )).scalar_one()


def _values_by_field(record: Record, record_type: RecordType | None = None) -> dict[Any, Any]:
    """Map a record's values by field slug (best) with a field-id fallback."""
    fields_by_id = {f.id: f for f in (record_type.fields or [])} if record_type else {}
    out: dict[Any, Any] = {}
    for rv in record.values or []:
        field = fields_by_id.get(rv.field_id)
        out[field.slug if field else rv.field_id] = _unwrap(rv.value)
    return out


async def _set_field(db: AsyncSession, record_id: int, field: RecordField, value: Any) -> None:
    """Store `value` in the record's cell for `field`; None clears the cell."""
    rv = (await db.execute(
        select(RecordValue).where(RecordValue.record_id == record_id, RecordValue.field_id == field.id)
    )).scalar_one_or_none()
    if value in (None, ""):
        if rv is not None:
            await db.delete(rv)
    elif rv is not None:
        rv.value = {"value": value}
    else:
        db.add(RecordValue(record_id=record_id, field_id=field.id, value={"value": value}))


def _to_float(raw: Any) -> float | None:
    try:
        return float(raw) if raw not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _serialize(ea: RecordAssignment) -> dict[str, Any]:
    return {
        "id": ea.id,
        "record_id": ea.record_id,
        "employee_id": ea.employee_id,
        "employee_name": ea.employee_name,
        "business_unit": ea.business_unit,
        "effective_date": ea.effective_date,
        "cost": float(ea.cost) if ea.cost is not None else None,
        "currency": ea.currency,
        "reason": ea.reason,
        "notes": ea.notes,
        "created_by": ea.created_by,
        "created_at": ea.created_at,
    }


async def ensure_tracked(db: AsyncSession, record_type: RecordType) -> None:
    if not record_type.track_ownership:
        raise ValidationException("Ownership tracking is not enabled for this record type")


async def ensure_baseline(db: AsyncSession, record: Record, record_type: RecordType) -> None:
    """Create the initial ownership entry from the record's current field values."""
    count = (await db.execute(
        select(func.count(RecordAssignment.id)).where(RecordAssignment.record_id == record.id)
    )).scalar() or 0
    if count:
        return
    db.add(_baseline_entry(record, record_type))
    await db.flush()


def _baseline_entry(record, record_type):
    vals = _values_by_field(record, record_type)
    assignee_f = _assignee_field(record_type)
    bu_f = _bu_field(record_type)
    cost_f = _find_field(COST_NAMES, record_type)
    currency_f = _find_field(CURRENCY_NAMES, record_type)
    holder = str(vals.get(assignee_f.slug) or UNASSIGNED) if assignee_f else UNASSIGNED
    return RecordAssignment(
        record_id=record.id,
        employee_name=holder[:200],
        business_unit=(str(vals.get(bu_f.slug)) if bu_f and vals.get(bu_f.slug) else None),
        effective_date=record.created_at.date() if record.created_at else date.today(),
        cost=_to_float(vals.get(cost_f.slug)) if cost_f else None,
        currency=(str(vals.get(currency_f.slug)) if currency_f and vals.get(currency_f.slug) else None),
        reason="Initial assignment",
        created_by=None,
    )


async def ensure_baselines_for_type(db: AsyncSession, record_type: RecordType) -> int:
    created = cursor = 0
    while True:
        records = (await db.execute(select(Record).where(Record.record_type_id == record_type.id, Record.id > cursor)
            .order_by(Record.id).limit(500).with_for_update().options(selectinload(Record.values)))).scalars().all()
        if not records:
            break
        existing = set((await db.execute(select(RecordAssignment.record_id).where(
            RecordAssignment.record_id.in_([r.id for r in records])))).scalars())
        entries = [_baseline_entry(r, record_type) for r in records if r.id not in existing]
        db.add_all(entries)
        await db.flush()
        created += len(entries)
        cursor = records[-1].id
    return created


async def _latest(db: AsyncSession, record_id: int) -> RecordAssignment | None:
    return (await db.execute(
        select(RecordAssignment).where(RecordAssignment.record_id == record_id)
        .order_by(RecordAssignment.effective_date.desc(), RecordAssignment.id.desc())
        .limit(1)
    )).scalar_one_or_none()


async def list_assignments(db: AsyncSession, record_id: int) -> list[dict[str, Any]]:
    record = await _get_record(db, record_id)
    record_type = await _get_type(db, record.record_type_id)
    await ensure_tracked(db, record_type)
    await ensure_baseline(db, record, record_type)
    rows = (await db.execute(
        select(RecordAssignment).where(RecordAssignment.record_id == record_id)
        .order_by(RecordAssignment.effective_date.desc(), RecordAssignment.id.desc())
    )).scalars().all()
    return [_serialize(ea) for ea in rows]


async def _follow_name(db: AsyncSession, record: Record, record_type: RecordType, holder: str | None) -> None:
    """Keep '{Product} - {Holder}' names current; custom names are left alone.

    Record names are unique per type, so a clash (two unassigned seats of the
    same product) gets the record id appended.
    """
    product_f = _find_field(PRODUCT_NAMES, record_type)
    product = _values_by_field(record, record_type).get(product_f.slug) if product_f else None
    if not product or not record.name.startswith(f"{product} - "):
        return
    base = f"{product} - {holder or UNASSIGNED}"[:480]
    taken = (await db.execute(select(Record.id).where(
        Record.record_type_id == record.record_type_id, Record.name == base, Record.id != record.id,
    ).limit(1))).scalar_one_or_none()
    record.name = f"{base} #{record.id}" if taken else base


async def _employee_for(db: AsyncSession, employee_id: int | None, name: str | None) -> Employee | None:
    if employee_id is not None:
        employee = await db.get(Employee, employee_id)
        if employee is None:
            raise NotFoundException("Employee not found")
        return employee
    if name and name.strip() and name.strip() != UNASSIGNED:
        return (await db.execute(
            select(Employee).where(func.lower(Employee.name) == name.strip().lower()).limit(1)
        )).scalar_one_or_none()
    return None


async def _assign(
    db: AsyncSession, record: Record, record_type: RecordType, *,
    employee: Employee | None, holder: str | None, business_unit: str | None,
    effective: date, reason: str | None, notes: str | None, user_id: int | None,
    cost: float | None = None, currency: str | None = None,
) -> RecordAssignment:
    """Move a seat to `holder` (None = unassigned) and append a history entry.

    The record's current-state fields (assignee, email, BU, cost) follow the
    change so lists, filters and exports stay correct.
    """
    vals = _values_by_field(record, record_type)
    assignee_f = _assignee_field(record_type)
    email_f = _email_field(record_type)
    bu_f = _bu_field(record_type)
    cost_f = _find_field(COST_NAMES, record_type)
    currency_f = _find_field(CURRENCY_NAMES, record_type)

    if business_unit is None and employee is not None and len(employee.business_units or []) == 1:
        business_unit = employee.business_units[0]
    if business_unit is None and bu_f is not None and vals.get(bu_f.slug):
        business_unit = str(vals.get(bu_f.slug))  # seat stays charged to its unit

    if assignee_f is not None:
        await _set_field(db, record.id, assignee_f, holder)
    if email_f is not None:
        await _set_field(db, record.id, email_f, employee.email if employee and employee.email else None)
    if bu_f is not None and business_unit is not None:
        await _set_field(db, record.id, bu_f, business_unit)
    if cost_f is not None and cost is not None:
        await _set_field(db, record.id, cost_f, cost)
    if currency_f is not None and currency:
        await _set_field(db, record.id, currency_f, currency)
    await _follow_name(db, record, record_type, holder)

    entry = RecordAssignment(
        record_id=record.id,
        employee_id=employee.id if employee else None,
        employee_name=(holder or UNASSIGNED)[:200],
        business_unit=business_unit,
        effective_date=effective,
        cost=cost if cost is not None else (_to_float(vals.get(cost_f.slug)) if cost_f else None),
        currency=currency or (str(vals.get(currency_f.slug)) if currency_f and vals.get(currency_f.slug) else None),
        reason=reason,
        notes=notes,
        created_by=user_id,
    )
    record.updated_at = datetime.now(timezone.utc)
    db.add(entry)
    await db.flush()
    return entry


def _check_date(effective: date, latest: RecordAssignment | None) -> None:
    if latest and effective < latest.effective_date:
        raise ValidationException(
            f"Effective date must be on or after the current holder's start date ({latest.effective_date.isoformat()})"
        )


async def create_assignment(db: AsyncSession, record_id: int, data: AssignmentCreate, user_id: int | None) -> dict[str, Any]:
    record = await _get_record(db, record_id)
    record_type = await _get_type(db, record.record_type_id)
    await ensure_tracked(db, record_type)
    await ensure_baseline(db, record, record_type)

    latest = await _latest(db, record_id)
    eff = datetime.strptime(data.effective_date, "%Y-%m-%d").date()
    _check_date(eff, latest)

    if data.unassign:
        employee, holder = None, None
        if latest and latest.employee_name == UNASSIGNED:
            raise ValidationException("This seat is already unassigned")
    else:
        employee = await _employee_for(db, data.employee_id, data.employee_name)
        holder = employee.name if employee else (data.employee_name or "").strip()
        if not holder or holder == UNASSIGNED:
            raise ValidationException("Pick an employee or type a holder name")
        if latest and latest.employee_name.lower() == holder.lower():
            raise ValidationException(f"{holder} already holds this seat")

    entry = await _assign(
        db, record, record_type, employee=employee, holder=holder,
        business_unit=data.business_unit, effective=eff,
        reason=data.reason or ("Unassigned" if data.unassign else None), notes=data.notes,
        user_id=user_id, cost=data.cost, currency=data.currency,
    )
    action = "Unassigned" if holder is None else f"Assigned to {holder}"
    await log_audit(db, "assignment.create", "record", record_id, record.name, user_id=user_id,
                    details=f"{action}{f' ({entry.business_unit})' if entry.business_unit and holder else ''} effective {eff.isoformat()}"
                            + (f", cost changed to {data.cost} {entry.currency or ''}".rstrip() if data.cost is not None else ""))
    return _serialize(entry)


async def swap_assignments(db: AsyncSession, record_id: int, data: SwapRequest, user_id: int | None) -> list[dict[str, Any]]:
    """Exchange the holders of two seats in one step (each seat keeps its own cost)."""
    if data.other_record_id == record_id:
        raise ValidationException("Pick a different seat to swap with")
    # Lock in id order so two concurrent swaps cannot deadlock.
    first, second = sorted((record_id, data.other_record_id))
    locked = {first: await _get_record(db, first), second: await _get_record(db, second)}
    a, b = locked[record_id], locked[data.other_record_id]
    if a.record_type_id != b.record_type_id:
        raise ValidationException("Seats can only be swapped within the same record type")
    record_type = await _get_type(db, a.record_type_id)
    await ensure_tracked(db, record_type)
    await ensure_baseline(db, a, record_type)
    await ensure_baseline(db, b, record_type)

    eff = datetime.strptime(data.effective_date, "%Y-%m-%d").date()
    latest_a, latest_b = await _latest(db, a.id), await _latest(db, b.id)
    _check_date(eff, latest_a)
    _check_date(eff, latest_b)

    def holder_of(entry: RecordAssignment | None) -> str | None:
        return None if entry is None or entry.employee_name == UNASSIGNED else entry.employee_name

    holder_a, holder_b = holder_of(latest_a), holder_of(latest_b)
    if holder_a is None and holder_b is None:
        raise ValidationException("Both seats are unassigned; there is nothing to swap")
    emp_a = await _employee_for(db, latest_a.employee_id if latest_a else None, holder_a)
    emp_b = await _employee_for(db, latest_b.employee_id if latest_b else None, holder_b)

    # Free both names first: '{Product} - {Holder}' names would otherwise
    # collide with the unique (type, name) constraint mid-swap.
    suffix = " (swapping)"
    a.name, b.name = f"{a.name[:480]}{suffix}", f"{b.name[:480]}{suffix}"
    await db.flush()

    reason = "Swap"
    entry_a = await _assign(db, a, record_type, employee=emp_b, holder=holder_b,
                            business_unit=latest_b.business_unit if latest_b and holder_b else None,
                            effective=eff, reason=reason, notes=data.notes, user_id=user_id)
    entry_b = await _assign(db, b, record_type, employee=emp_a, holder=holder_a,
                            business_unit=latest_a.business_unit if latest_a and holder_a else None,
                            effective=eff, reason=reason, notes=data.notes, user_id=user_id)
    for rec in (a, b):  # custom names do not follow the holder: restore them
        rec.name = rec.name.removesuffix(suffix)
    await db.flush()
    detail = f"Swapped holders: {holder_a or UNASSIGNED} <-> {holder_b or UNASSIGNED} effective {eff.isoformat()}"
    await log_audit(db, "assignment.swap", "record", a.id, a.name, user_id=user_id, details=detail)
    await log_audit(db, "assignment.swap", "record", b.id, b.name, user_id=user_id, details=detail)
    return [_serialize(entry_a), _serialize(entry_b)]


async def holdings_for_employee(db: AsyncSession, employee: Employee, allowed: list[int] | None = None) -> list[dict[str, Any]]:
    """Live records of tracked types currently held by `employee`.

    Matches the holder field by name or the email field by address, so seats
    assigned before employees were linked are found too.
    """
    conditions = [RecordType.track_ownership.is_(True), RecordType.active.is_(True)]
    if allowed is not None:
        conditions.append(RecordType.id.in_(allowed))
    types = (await db.execute(select(RecordType).where(*conditions)
                              .options(selectinload(RecordType.fields)))).scalars().all()
    out: list[dict[str, Any]] = []
    for rt in types:
        assignee_f, email_f, product_f = _assignee_field(rt), _email_field(rt), _find_field(PRODUCT_NAMES, rt)
        matchers = []
        if assignee_f is not None:
            matchers.append(select(RecordValue.record_id).where(
                RecordValue.field_id == assignee_f.id,
                func.lower(RecordValue.value["value"].astext) == employee.name.strip().lower()))
        if email_f is not None and employee.email:
            matchers.append(select(RecordValue.record_id).where(
                RecordValue.field_id == email_f.id,
                func.lower(RecordValue.value["value"].astext) == employee.email.strip().lower()))
        if not matchers:
            continue
        ids: set[int] = set()
        for m in matchers:
            ids.update((await db.execute(m)).scalars().all())
        if not ids:
            continue
        records = (await db.execute(select(Record).where(
            Record.id.in_(ids), Record.deleted_at.is_(None), Record.archived.is_(False),
        ).order_by(Record.name).options(selectinload(Record.values)))).scalars().all()
        for r in records:
            vals = _values_by_field(r, rt)
            latest = await _latest(db, r.id)
            out.append({
                "record_id": r.id, "name": r.name, "record_type_id": rt.id,
                "record_type_name": rt.name, "record_type_slug": rt.slug,
                "product": str(vals.get(product_f.slug)) if product_f and vals.get(product_f.slug) else None,
                "since": latest.effective_date if latest else None,
            })
    return out


async def release_employee(db: AsyncSession, employee_id: int, data: ReleaseRequest,
                           user_id: int | None, allowed: list[int] | None = None) -> dict[str, Any]:
    """Offboarding: unassign every seat the employee holds, optionally deactivate them."""
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundException("Employee not found")
    eff = datetime.strptime(data.effective_date, "%Y-%m-%d").date()
    released: list[int] = []
    for holding in await holdings_for_employee(db, employee, allowed):
        record = await _get_record(db, holding["record_id"])
        record_type = await _get_type(db, record.record_type_id)
        await ensure_baseline(db, record, record_type)
        latest = await _latest(db, record.id)
        # Never rewrite history: keep the later date when the seat moved after `eff`.
        effective = max(eff, latest.effective_date) if latest else eff
        await _assign(db, record, record_type, employee=None, holder=None, business_unit=None,
                      effective=effective, reason=data.reason, notes=f"Released from {employee.name}",
                      user_id=user_id)
        released.append(record.id)
    if data.deactivate and employee.active:
        employee.active = False
    await log_audit(db, "employee.release", "employee", employee.id, employee.name, user_id=user_id,
                    details=f"Unassigned {len(released)} seat(s) effective {eff.isoformat()}"
                            + ("; employee deactivated" if data.deactivate else ""))
    return {"released": len(released), "record_ids": released, "deactivated": bool(data.deactivate)}




async def bulk_assign(db: AsyncSession, data: BulkAssignRequest, user_id: int | None) -> dict[str, Any]:
    """Apply many seat changes atomically.

    All target records are renamed out of the way first so seats can trade
    holders (A->B, B->A) without tripping the unique (type, name) constraint.
    A seat whose holder would not change is skipped.
    """
    ids = [i.record_id for i in data.items]
    if len(set(ids)) != len(ids):
        raise ValidationException("Each seat can appear only once")
    eff = datetime.strptime(data.effective_date, "%Y-%m-%d").date()
    records = {rid: await _get_record(db, rid) for rid in sorted(ids)}  # id order: no deadlocks
    types: dict[int, RecordType] = {}
    plan = []
    for item in data.items:
        record = records[item.record_id]
        if record.record_type_id not in types:
            types[record.record_type_id] = await _get_type(db, record.record_type_id)
            await ensure_tracked(db, types[record.record_type_id])
        rt = types[record.record_type_id]
        await ensure_baseline(db, record, rt)
        latest = await _latest(db, record.id)
        _check_date(eff, latest)
        if item.unassign:
            employee, holder = None, None
        else:
            employee = await _employee_for(db, item.employee_id, item.employee_name)
            holder = employee.name if employee else (item.employee_name or "").strip()
            if not holder or holder == UNASSIGNED:
                raise ValidationException(f"Pick a person for {record.name}, or unassign it")
        current = None if latest is None or latest.employee_name == UNASSIGNED else latest.employee_name
        if (current or "").lower() == (holder or "").lower():
            continue
        plan.append((record, rt, employee, holder, item.business_unit))

    suffix = " (reassigning)"
    for record, *_ in plan:
        record.name = f"{record.name[:480]}{suffix}"
    await db.flush()
    changed = []
    for record, rt, employee, holder, bu in plan:
        await _assign(db, record, rt, employee=employee, holder=holder, business_unit=bu, effective=eff,
                      reason=data.reason or ("Unassigned" if holder is None else "Reassigned"),
                      notes=data.notes, user_id=user_id)
        changed.append(record)
    for record in changed:
        record.name = record.name.removesuffix(suffix)
        await log_audit(db, "assignment.bulk", "record", record.id, record.name, user_id=user_id,
                        details=f"Bulk change effective {eff.isoformat()}")
    await db.flush()
    return {"changed": len(changed), "skipped": len(data.items) - len(changed)}


async def _resync_from_latest(db: AsyncSession, record: Record, record_type: RecordType) -> None:
    """Point the record's current-state fields at its newest history entry."""
    latest = await _latest(db, record.id)
    if latest is None:
        return
    holder = None if latest.employee_name == UNASSIGNED else latest.employee_name
    employee = await db.get(Employee, latest.employee_id) if latest.employee_id else None
    assignee_f, email_f, bu_f = _assignee_field(record_type), _email_field(record_type), _bu_field(record_type)
    cost_f, currency_f = _find_field(COST_NAMES, record_type), _find_field(CURRENCY_NAMES, record_type)
    if assignee_f is not None:
        await _set_field(db, record.id, assignee_f, holder)
    if email_f is not None and (employee is not None or holder is None):
        await _set_field(db, record.id, email_f, employee.email if employee else None)
    if bu_f is not None and latest.business_unit is not None:
        await _set_field(db, record.id, bu_f, latest.business_unit)
    if cost_f is not None and latest.cost is not None:
        await _set_field(db, record.id, cost_f, float(latest.cost))
    if currency_f is not None and latest.currency:
        await _set_field(db, record.id, currency_f, latest.currency)
    await _follow_name(db, record, record_type, holder)


async def _get_entry(db: AsyncSession, record_id: int, assignment_id: int) -> RecordAssignment:
    entry = (await db.execute(select(RecordAssignment).where(
        RecordAssignment.id == assignment_id, RecordAssignment.record_id == record_id))).scalar_one_or_none()
    if entry is None:
        raise NotFoundException("Assignment entry not found")
    return entry


async def update_assignment(db: AsyncSession, record_id: int, assignment_id: int, data: AssignmentUpdate, user_id: int) -> dict[str, Any]:
    """Admin correction of a history entry; the record follows if it is the newest."""
    record = await _get_record(db, record_id)
    record.updated_at = datetime.now(timezone.utc)
    entry = await _get_entry(db, record_id, assignment_id)
    record_type = await _get_type(db, record.record_type_id)
    await ensure_tracked(db, record_type)

    updates = data.model_dump(exclude_unset=True)
    if updates.get("effective_date"):
        updates["effective_date"] = datetime.strptime(updates["effective_date"], "%Y-%m-%d").date()
    if updates.get("employee_id") is not None:
        employee = await _employee_for(db, updates["employee_id"], None)
        updates["employee_name"] = employee.name
    if "employee_name" in updates and not (updates["employee_name"] or "").strip():
        updates["employee_name"] = UNASSIGNED
    for k, v in updates.items():
        setattr(entry, k, v)
    await db.flush()
    if (await _latest(db, record_id)).id == entry.id:
        await _resync_from_latest(db, record, record_type)

    await log_audit(db, "assignment.update", "record", record_id, record.name,
                    user_id=user_id, details=f"Admin edited assignment entry #{assignment_id}")
    await db.flush()
    await db.refresh(entry)
    return _serialize(entry)


async def delete_assignment(db: AsyncSession, record_id: int, assignment_id: int, user_id: int) -> None:
    record = await _get_record(db, record_id)
    record.updated_at = datetime.now(timezone.utc)
    entry = await _get_entry(db, record_id, assignment_id)
    record_type = await _get_type(db, record.record_type_id)
    await ensure_tracked(db, record_type)
    await db.delete(entry)
    await db.flush()
    await _resync_from_latest(db, record, record_type)
    await log_audit(db, "assignment.delete", "record", record_id, record.name,
                    user_id=user_id, details=f"Admin deleted assignment entry #{assignment_id}")


async def allocation_report(
    db: AsyncSession,
    record_type_id: int,
    start: date,
    end: date,
    product: str | None = None,
) -> dict[str, Any]:
    """Exact-day cost allocation of tracked seats across business units.

    For each record: its ownership entries split the reporting window into
    spans; each span contributes (span days / window days) x span cost to the
    span's business unit. Spans missing an explicit cost inherit the record's
    current Cost value.
    """
    record_type = (await db.execute(
        select(RecordType).where(RecordType.id == record_type_id)
        .options(selectinload(RecordType.fields).selectinload(RecordField.options))
    )).scalar_one_or_none()
    if record_type is None:
        raise NotFoundException("Record type not found")
    await ensure_tracked(db, record_type)

    window_days = (end - start).days + 1
    if window_days <= 0:
        raise ValidationException("End date must be on or after the start date")

    product_f = _find_field({"Product Name", "Product", "License Plan"}, record_type)
    cost_f = _find_field(COST_NAMES, record_type)
    currency_f = _find_field(CURRENCY_NAMES, record_type)

    records = (await db.execute(
        select(Record).where(
            Record.record_type_id == record_type_id,
            Record.archived == False,  # noqa: E712
            Record.deleted_at.is_(None),
        ).options(selectinload(Record.values.and_(RecordValue.field_id.in_([
            f.id for f in (product_f, cost_f, currency_f, _assignee_field(record_type), _bu_field(record_type)) if f is not None
        ]))))
    )).scalars().all()

    histories = defaultdict(list)
    rows = (await db.execute(select(RecordAssignment).join(Record).where(
        Record.record_type_id == record_type_id, Record.archived == False, Record.deleted_at.is_(None),
    ).order_by(RecordAssignment.effective_date, RecordAssignment.id))).scalars().all()
    for entry in rows:
        histories[entry.record_id].append(entry)
    bu_totals: dict[tuple[str | None, str | None], Decimal] = {}
    out_records: list[dict[str, Any]] = []

    for record in records:
        vals = _values_by_field(record, record_type)
        if product_f is not None and product:
            cur = str(vals.get(product_f.slug) or "").strip().lower()
            if cur != product.strip().lower():
                continue
        entries = histories[record.id]
        if not entries:
            assignee_f, bu_f = _assignee_field(record_type), _bu_field(record_type)
            entries = [SimpleNamespace(
                id=None, effective_date=record.created_at.date(),
                employee_name=str(vals.get(assignee_f.slug) or "Unassigned") if assignee_f else "Unassigned",
                business_unit=vals.get(bu_f.slug) if bu_f else None,
                cost=None, currency=vals.get(currency_f.slug) if currency_f else None,
            )]

        record_cost = vals.get(cost_f.slug) if cost_f else None
        try:
            record_cost = Decimal(str(record_cost)) if record_cost not in (None, "") else None
            if record_cost is not None and not record_cost.is_finite():
                record_cost = None
        except (TypeError, ValueError, InvalidOperation):
            record_cost = None
        currency = str(vals.get(currency_f.slug)) if currency_f and vals.get(currency_f.slug) else None

        spans: list[dict[str, Any]] = []
        record_allocated = Decimal("0")
        for i, ea in enumerate(entries):
            span_start = ea.effective_date
            # The previous holder keeps each day up to the day before the next
            # holder's effective date (no double-counting on transfer day).
            span_end = (entries[i + 1].effective_date - timedelta(days=1) if i + 1 < len(entries) else end)
            ovl_start = max(span_start, start)
            ovl_end = min(span_end, end)
            days = (ovl_end - ovl_start).days + 1
            if days <= 0:
                continue
            cost = Decimal(str(ea.cost)) if ea.cost is not None else record_cost
            allocated = ((cost or Decimal("0")) * days / window_days).quantize(Decimal("0.01"))
            bu_key = (ea.business_unit, ea.currency or currency)
            bu_totals[bu_key] = bu_totals.get(bu_key, Decimal("0")) + allocated
            record_allocated += allocated
            spans.append({
                "assignment_id": ea.id,
                "employee_name": ea.employee_name,
                "business_unit": ea.business_unit,
                "from": ovl_start.isoformat(),
                "to": ovl_end.isoformat(),
                "days": days,
                "cost": cost,
                "currency": ea.currency or currency,
                "allocated": allocated,
            })
        if spans:
            product_label = None
            if product_f is not None:
                product_label = "\n".join(
                    o.label for o in product_f.options
                    if o.value == vals.get(product_f.slug)
                ) or (str(vals.get(product_f.slug)) if vals.get(product_f.slug) is not None else None)
            out_records.append({
                "record_id": record.id,
                "name": record.name,
                "status": record.status,
                "product": product_label,
                "spans": spans,
                "allocated": round(record_allocated, 2),
            })

    out_records.sort(key=lambda r: -(r["allocated"]))
    business_units = [
        {"business_unit": bu, "currency": cur, "allocated": round(total, 2)}
        for (bu, cur), total in sorted(
            bu_totals.items(),
            key=lambda kv: -kv[1],
        )
    ]
    return {
        "record_type_id": record_type.id,
        "record_type_name": record_type.name,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "window_days": window_days,
        "records": out_records,
        "business_units": business_units,
    }
