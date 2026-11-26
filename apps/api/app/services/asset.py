"""Asset lifecycle: create/edit, assignment timeline, repairs, maintenance,
borrows, retire/delete/restore, bulk actions and auto serial numbers.

Ported from AssetWise's server actions (src/app/assets/actions.ts,
src/app/it-log/actions.ts) onto normalized tables. Every mutation is audited.
"""
from datetime import date, datetime, timezone
from math import ceil
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictException, NotFoundException, ValidationException
from app.models.asset import (
    Asset, AssetAssignment, AssetBorrow, AssetMaintenance, AssetRepair, AssetSerialSetting, AssetTypeTemplate,
)
from app.models.employee import Employee
from app.schemas import asset as s
from app.services.audit import log_audit
from app.services.serial_format import format_serial_number, validate_serial_format

SORTABLE = {"created_at": Asset.created_at, "updated_at": Asset.updated_at, "asset_type": Asset.asset_type,
            "brand": Asset.brand, "model": Asset.model, "serial_number": Asset.serial_number,
            "warranty_end_date": Asset.warranty_end_date, "purchase_date": Asset.purchase_date,
            "purchase_cost": Asset.purchase_cost, "location": Asset.location, "supplier": Asset.supplier,
            "assignment_status": Asset.assignment_status, "condition_status": Asset.condition_status}


WARRANTY_STATES = ("active", "expiring", "expired", "none")


def _today() -> date:
    from app.services.clock import today
    return today()


def _snapshot(a: Asset) -> dict[str, Any]:
    return {k: (str(v) if isinstance(v, (date, datetime)) or v.__class__.__name__ == "Decimal" else v)
            for k, v in {
                "asset_type": a.asset_type, "brand": a.brand, "model": a.model, "serial_number": a.serial_number,
                "location": a.location, "specs": a.specs, "purchase_date": a.purchase_date,
                "purchase_cost": a.purchase_cost, "currency": a.currency, "supplier": a.supplier,
                "warranty_end_date": a.warranty_end_date, "employee_id": a.employee_id,
                "assignment_status": a.assignment_status, "condition_status": a.condition_status,
            }.items()}


async def get_asset(db: AsyncSession, asset_id: int, include_deleted: bool = False) -> Asset:
    asset = await db.get(Asset, asset_id)
    if asset is None or (asset.deleted_at is not None and not include_deleted):
        raise NotFoundException("Asset not found")
    return asset


async def _employee(db: AsyncSession, employee_id: int) -> Employee:
    emp = await db.get(Employee, employee_id)
    if emp is None:
        raise NotFoundException("Employee not found")
    return emp


# ---------------------------------------------------------------- queries
def _csv(v: str | None) -> list[str]:
    return [x.strip() for x in (v or "").split(",") if x.strip()]


def asset_filter_stmt(f: "s.AssetFilters"):
    """One definition of every asset filter, shared by the list and the reports."""
    stmt = select(Asset).where(Asset.deleted_at.isnot(None) if f.deleted else Asset.deleted_at.is_(None))
    if f.q:
        like = f"%{f.q.strip()}%"
        stmt = stmt.where(or_(
            (func.coalesce(Asset.brand, "") + " " + func.coalesce(Asset.model, "") + " "
             + func.coalesce(Asset.serial_number, "")).ilike(like),
            Asset.asset_type.ilike(like), Asset.location.ilike(like), Asset.supplier.ilike(like), Asset.notes.ilike(like),
            Asset.employee_id.in_(select(Employee.id).where(Employee.name.ilike(like))),
        ))
    for col, raw in ((Asset.asset_type, f.asset_type), (Asset.assignment_status, f.assignment_status),
                     (Asset.condition_status, f.condition_status), (Asset.location, f.location),
                     (Asset.brand, f.brand), (Asset.supplier, f.supplier)):
        vals = _csv(raw)
        if vals:
            stmt = stmt.where(col.in_(vals))
    if f.model:
        stmt = stmt.where(Asset.model.ilike(f"%{f.model.strip()}%"))
    if f.employee_id:
        stmt = stmt.where(Asset.employee_id == f.employee_id)
    emp_ids = [int(x) for x in _csv(f.employee_ids) if x.isdigit()]
    if emp_ids:
        stmt = stmt.where(Asset.employee_id.in_(emp_ids))
    if f.hide_written_off:
        stmt = stmt.where(Asset.condition_status != "Written-Off")
    units = _csv(f.business_unit)
    if units:
        stmt = stmt.where(Asset.employee_id.in_(select(Employee.id).where(or_(*[Employee.business_units.contains([u]) for u in units]))))
    if f.purchase_from:
        stmt = stmt.where(Asset.purchase_date >= f.purchase_from)
    if f.purchase_to:
        stmt = stmt.where(Asset.purchase_date <= f.purchase_to)
    if f.warranty_from:
        stmt = stmt.where(Asset.warranty_end_date >= f.warranty_from)
    if f.warranty_to or f.warranty_before:
        stmt = stmt.where(Asset.warranty_end_date <= (f.warranty_to or f.warranty_before))
    states = [w for w in _csv(f.warranty) if w in WARRANTY_STATES]
    if states:
        from datetime import timedelta
        d0 = _today()
        conds = {
            "active": Asset.warranty_end_date >= d0,
            "expiring": Asset.warranty_end_date.between(d0, d0 + timedelta(days=90)),
            "expired": Asset.warranty_end_date < d0,
            "none": Asset.warranty_end_date.is_(None),
        }
        stmt = stmt.where(or_(*[conds[w] for w in states]))
    if f.cost_min is not None:
        stmt = stmt.where(Asset.purchase_cost >= f.cost_min)
    if f.cost_max is not None:
        stmt = stmt.where(Asset.purchase_cost <= f.cost_max)
    if f.open_repair is not None:
        open_ids = select(AssetRepair.asset_id).where(AssetRepair.status == "In Progress")
        stmt = stmt.where(Asset.id.in_(open_ids) if f.open_repair else Asset.id.notin_(open_ids))
    return stmt


async def list_assets(db: AsyncSession, f: "s.AssetFilters", *, sort: str = "created_at", order: str = "desc",
                      page: int = 1, page_size: int = 50) -> dict[str, Any]:
    stmt = asset_filter_stmt(f)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    if sort == "holder":
        holder = select(Employee.name).where(Employee.id == Asset.employee_id).scalar_subquery()
        col = holder
    else:
        col = SORTABLE.get(sort, Asset.created_at)
    stmt = stmt.order_by(col.desc().nullslast() if order == "desc" else col.asc().nullslast(), Asset.id.desc())
    rows = (await db.execute(stmt.offset((page - 1) * page_size).limit(page_size))).unique().scalars().all()
    return {"items": rows, "page": page, "page_size": page_size, "total": total,
            "total_pages": max(1, ceil(total / page_size))}


async def asset_summary(db: AsyncSession) -> dict[str, int]:
    """Counts behind the asset list's preset tabs."""
    from datetime import timedelta
    d0 = _today()
    live = Asset.deleted_at.is_(None)
    kept = Asset.condition_status != "Written-Off"

    def n(*conds):
        return func.count(Asset.id).filter(*conds)
    row = (await db.execute(select(
        n(kept), n(kept, Asset.assignment_status == "Assigned"),
        n(kept, Asset.assignment_status == "Unassigned", Asset.condition_status == "Operational"),
        n(kept, Asset.assignment_status == "Borrowed"),
        n(Asset.condition_status == "In Repair"),
        n(kept, Asset.warranty_end_date.between(d0, d0 + timedelta(days=90))),
        n(Asset.condition_status == "Written-Off"),
    ).where(live))).one()
    keys = ("total", "assigned", "available", "borrowed", "in_repair", "warranty_expiring", "written_off")
    return dict(zip(keys, (int(x) for x in row)))


async def asset_detail(db: AsyncSession, asset_id: int) -> dict[str, Any]:
    asset = await get_asset(db, asset_id, include_deleted=True)
    assignments = (await db.execute(select(AssetAssignment).where(AssetAssignment.asset_id == asset_id)
                                    .order_by(AssetAssignment.assigned_from.desc(), AssetAssignment.id.desc()))).scalars().all()
    repairs = (await db.execute(select(AssetRepair).where(AssetRepair.asset_id == asset_id)
                                .order_by(AssetRepair.repair_date.desc(), AssetRepair.id.desc()))).scalars().all()
    maintenance = (await db.execute(select(AssetMaintenance).where(AssetMaintenance.asset_id == asset_id)
                                    .order_by(AssetMaintenance.maintenance_date.desc(), AssetMaintenance.id.desc()))).scalars().all()
    borrows = (await db.execute(select(AssetBorrow).where(AssetBorrow.asset_id == asset_id, AssetBorrow.deleted_at.is_(None))
                                .order_by(AssetBorrow.borrowed_date.desc(), AssetBorrow.id.desc()))).scalars().all()
    data = s.AssetResponse.model_validate(asset).model_dump()
    data.update(assignments=assignments, repairs=repairs, maintenance=maintenance,
                borrows=[borrow_view(b) for b in borrows])
    return data


def borrow_view(b: AssetBorrow, serial: str | None = None) -> dict[str, Any]:
    overdue = bool(b.returned_date is None and b.expected_return_date and b.expected_return_date < _today())
    d = {c: getattr(b, c) for c in ("id", "asset_id", "item_name", "employee_id", "borrower_name", "borrower_email",
                                    "borrowed_date", "expected_return_date", "returned_date", "notes", "created_at")}
    d.update(overdue=overdue, serial_number=serial)
    return d


# ---------------------------------------------------------------- serials
async def _consume_serial(db: AsyncSession, asset_type: str, serial: str | None) -> None:
    """If the saved serial equals the pending generated one, advance the counter."""
    if not serial:
        return
    setting = await db.get(AssetSerialSetting, asset_type, with_for_update=True)
    if not setting or not setting.enabled or setting.reserved_number is None:
        return
    if format_serial_number(setting.format, setting.reserved_number, _today(), asset_type) == serial:
        setting.next_number = setting.reserved_number + 1
        setting.reserved_number = None


async def generate_serial(db: AsyncSession, asset_type: str) -> str:
    setting = await db.get(AssetSerialSetting, asset_type, with_for_update=True)
    if not setting or not setting.enabled or not setting.format:
        raise ValidationException("Auto product numbers are not enabled for this asset type")
    if setting.reserved_number is None:
        n = setting.next_number
        # Skip numbers already used by an existing asset (manual entries).
        for _ in range(1000):
            candidate = format_serial_number(setting.format, n, _today(), asset_type)
            taken = (await db.execute(select(Asset.id).where(Asset.serial_number == candidate).limit(1))).first()
            if not taken:
                break
            n += 1
        setting.reserved_number = n
    return format_serial_number(setting.format, setting.reserved_number, _today(), asset_type)


async def list_serial_settings(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(AssetSerialSetting).order_by(AssetSerialSetting.asset_type))).scalars().all()
    return [{**s.SerialSettingResponse.model_validate(r).model_dump(),
             "preview": format_serial_number(r.format, r.reserved_number or r.next_number, _today(), r.asset_type) if r.format else None}
            for r in rows]


async def upsert_serial_setting(db: AsyncSession, asset_type: str, data: s.SerialSettingUpsert, user_id: int) -> dict[str, Any]:
    if data.enabled:
        if not data.format.strip():
            raise ValidationException("A format is required when auto numbering is enabled")
        err = validate_serial_format(data.format)
        if err:
            raise ValidationException(err)
    row = await db.get(AssetSerialSetting, asset_type)
    if row is None:
        row = AssetSerialSetting(asset_type=asset_type, enabled=data.enabled, format=data.format.strip(), next_number=data.next_number or 1)
        db.add(row)
    else:
        if row.format != data.format.strip() or data.next_number:
            row.reserved_number = None
        row.enabled, row.format = data.enabled, data.format.strip()
        if data.next_number:
            row.next_number = data.next_number
    await db.flush()
    await log_audit(db, "asset_serial.update", "settings", None, asset_type, new_values=data.model_dump(), user_id=user_id)
    return {**s.SerialSettingResponse.model_validate(row).model_dump(),
            "preview": format_serial_number(row.format, row.next_number, _today(), asset_type) if row.format else None}


# ---------------------------------------------------------------- templates
async def list_templates(db: AsyncSession) -> list[AssetTypeTemplate]:
    return list((await db.execute(select(AssetTypeTemplate).order_by(AssetTypeTemplate.asset_type))).scalars().all())


async def upsert_template(db: AsyncSession, asset_type: str, data: s.TemplateUpsert, user_id: int) -> AssetTypeTemplate:
    attrs = list(dict.fromkeys(a.strip()[:50] for a in data.attributes if a.strip()))
    row = await db.get(AssetTypeTemplate, asset_type)
    if row is None:
        row = AssetTypeTemplate(asset_type=asset_type, attributes=attrs)
        db.add(row)
    else:
        row.attributes = attrs
    await db.flush()
    await log_audit(db, "asset_template.update", "settings", None, asset_type, new_values={"attributes": attrs}, user_id=user_id)
    return row


async def delete_template(db: AsyncSession, asset_type: str, user_id: int) -> None:
    row = await db.get(AssetTypeTemplate, asset_type)
    if row:
        await db.delete(row)
        await log_audit(db, "asset_template.delete", "settings", None, asset_type, user_id=user_id)


# ---------------------------------------------------------------- create / edit
async def _check_serial_unique(db: AsyncSession, serial: str | None, exclude_id: int | None = None) -> None:
    if not serial:
        return
    q = select(Asset.id).where(func.lower(Asset.serial_number) == serial.lower(), Asset.deleted_at.is_(None))
    if exclude_id:
        q = q.where(Asset.id != exclude_id)
    if (await db.execute(q.limit(1))).first():
        raise ConflictException(f"An asset with serial/product number '{serial}' already exists")


async def create_asset(db: AsyncSession, data: s.AssetCreate, user_id: int, audit: bool = True) -> Asset:
    await _check_serial_unique(db, data.serial_number)
    fields = data.model_dump(exclude={"employee_id", "assigned_from"})
    asset = Asset(**fields, created_by=user_id)
    db.add(asset)
    await db.flush()
    await _consume_serial(db, data.asset_type, data.serial_number)
    if data.employee_id:
        await _open_assignment(db, asset, await _employee(db, data.employee_id), data.assigned_from or _today(), None, user_id)
    if audit:
        await log_audit(db, "asset.create", "asset", asset.id, asset.display_name, new_values=_snapshot(asset), user_id=user_id)
    await db.refresh(asset)
    return asset


async def update_asset(db: AsyncSession, asset_id: int, data: s.AssetUpdate, user_id: int) -> Asset:
    asset = await get_asset(db, asset_id)
    old = _snapshot(asset)
    changes = data.model_dump(exclude_unset=True)
    if "serial_number" in changes:
        await _check_serial_unique(db, changes["serial_number"], asset.id)
    for k, v in changes.items():
        setattr(asset, k, v)
    if changes.get("condition_status") == "Written-Off" and asset.employee_id:
        await _close_assignment(db, asset, _today(), user_id)
    await db.flush()
    if "serial_number" in changes:
        await _consume_serial(db, asset.asset_type, asset.serial_number)
    await log_audit(db, "asset.update", "asset", asset.id, asset.display_name, old_values=old, new_values=_snapshot(asset), user_id=user_id)
    await db.refresh(asset)
    return asset


async def import_assets(db: AsyncSession, data: s.AssetImportRequest, user_id: int) -> dict[str, int]:
    created = skipped = 0
    for item in data.items:
        if item.serial_number:
            exists = (await db.execute(select(Asset.id).where(func.lower(Asset.serial_number) == item.serial_number.lower(),
                                                              Asset.deleted_at.is_(None)).limit(1))).first()
            if exists:
                skipped += 1
                continue
        await create_asset(db, item, user_id, audit=False)
        created += 1
    await log_audit(db, "asset.import", "asset", None, None, user_id=user_id, details=f"Imported {created} assets, skipped {skipped} duplicates")
    return {"created": created, "skipped": skipped}


# ---------------------------------------------------------------- assignment timeline
async def _current_assignment(db: AsyncSession, asset_id: int) -> AssetAssignment | None:
    return (await db.execute(select(AssetAssignment).where(AssetAssignment.asset_id == asset_id, AssetAssignment.assigned_to.is_(None))
                             .order_by(AssetAssignment.assigned_from.desc(), AssetAssignment.id.desc()).limit(1))).scalar_one_or_none()


async def _close_assignment(db: AsyncSession, asset: Asset, on: date, user_id: int) -> None:
    current = await _current_assignment(db, asset.id)
    if current:
        current.assigned_to = max(on, current.assigned_from)
    asset.employee_id = None
    if asset.assignment_status == "Assigned":
        asset.assignment_status = "Unassigned"


async def _open_assignment(db: AsyncSession, asset: Asset, emp: Employee, on: date, remark: str | None, user_id: int) -> None:
    db.add(AssetAssignment(asset_id=asset.id, employee_id=emp.id, employee_name=emp.name,
                           assigned_from=on, remark=remark, created_by=user_id))
    asset.employee_id = emp.id
    asset.assignment_status = "Assigned"


async def assign_asset(db: AsyncSession, asset_id: int, data: s.AssignRequest, user_id: int, audit: bool = True) -> Asset:
    asset = await get_asset(db, asset_id)
    on = data.effective_date or _today()
    if data.employee_id is not None:
        if asset.condition_status == "Written-Off":
            raise ValidationException("A written-off asset cannot be assigned")
        if asset.assignment_status == "Borrowed":
            raise ValidationException("Return the borrowed asset before assigning it")
        if asset.employee_id == data.employee_id:
            raise ValidationException("The asset is already assigned to this employee")
    old_holder = asset.employee.name if asset.employee else None
    if asset.employee_id:
        await _close_assignment(db, asset, on, user_id)
    new_holder = None
    if data.employee_id is not None:
        emp = await _employee(db, data.employee_id)
        if not emp.active:
            raise ValidationException("Cannot assign to an inactive employee")
        await _open_assignment(db, asset, emp, on, data.remark, user_id)
        new_holder = emp.name
    if data.location is not None:
        asset.location = data.location or None
    await db.flush()
    if audit:
        action = "asset.assign" if new_holder else "asset.unassign"
        await log_audit(db, action, "asset", asset.id, asset.display_name, old_values={"employee": old_holder},
                        new_values={"employee": new_holder, "effective_date": on.isoformat()}, user_id=user_id)
    await db.refresh(asset)
    return asset


async def bulk_assign(db: AsyncSession, data: s.BulkAssignRequest, user_id: int) -> dict[str, int]:
    ids = [i.asset_id for i in data.items]
    if len(set(ids)) != len(ids):
        raise ValidationException("Each asset can appear only once")
    changed = 0
    for item in sorted(data.items, key=lambda i: i.asset_id):
        asset = await get_asset(db, item.asset_id)
        if asset.employee_id == item.employee_id:
            continue
        await assign_asset(db, item.asset_id, s.AssignRequest(employee_id=item.employee_id, effective_date=data.effective_date,
                                                               remark=data.remark), user_id, audit=False)
        changed += 1
    await log_audit(db, "asset.bulk_assign", "asset", None, None, user_id=user_id, details=f"Changed holder of {changed} asset(s)")
    return {"updated": changed}


async def delete_assignment(db: AsyncSession, asset_id: int, assignment_id: int, user_id: int) -> None:
    row = await db.get(AssetAssignment, assignment_id)
    if row is None or row.asset_id != asset_id:
        raise NotFoundException("Assignment not found")
    if row.assigned_to is None:
        raise ValidationException("Unassign the asset instead of deleting the current assignment")
    await log_audit(db, "asset_assignment.delete", "asset", asset_id, row.employee_name,
                    old_values={"employee_name": row.employee_name, "assigned_from": str(row.assigned_from),
                                "assigned_to": str(row.assigned_to), "employee_id": row.employee_id}, user_id=user_id)
    await db.delete(row)


async def import_assignment_history(db: AsyncSession, items: list[s.AssignmentHistoryImportItem], user_id: int) -> dict[str, int]:
    created = 0
    for item in items:
        await get_asset(db, item.asset_id)
        emp = await _employee(db, item.employee_id)
        db.add(AssetAssignment(asset_id=item.asset_id, employee_id=emp.id, employee_name=emp.name,
                               assigned_from=item.assigned_from, assigned_to=item.assigned_to or item.assigned_from,
                               remark=item.remark, created_by=user_id))
        created += 1
    await log_audit(db, "asset_assignment.import", "asset", None, None, user_id=user_id, details=f"Imported {created} history rows")
    return {"created": created}


# ---------------------------------------------------------------- retire / delete / bulk
async def retire_asset(db: AsyncSession, asset_id: int, user_id: int) -> Asset:
    return await update_asset(db, asset_id, s.AssetUpdate(condition_status="Written-Off"), user_id)


async def soft_delete(db: AsyncSession, asset_id: int, user_id: int) -> None:
    asset = await get_asset(db, asset_id)
    if asset.assignment_status == "Borrowed":
        raise ValidationException("Return the borrowed asset before deleting it")
    if asset.employee_id:
        await _close_assignment(db, asset, _today(), user_id)
    asset.deleted_at = datetime.now(timezone.utc)
    asset.deleted_by = user_id
    await log_audit(db, "asset.delete", "asset", asset.id, asset.display_name, old_values=_snapshot(asset), user_id=user_id)


async def restore(db: AsyncSession, asset_id: int, user_id: int) -> Asset:
    asset = await get_asset(db, asset_id, include_deleted=True)
    if asset.deleted_at is None:
        return asset
    await _check_serial_unique(db, asset.serial_number, asset.id)
    asset.deleted_at = None
    asset.deleted_by = None
    await log_audit(db, "asset.restore", "asset", asset.id, asset.display_name, user_id=user_id)
    await db.flush()
    await db.refresh(asset)
    return asset


async def bulk_update(db: AsyncSession, data: s.BulkUpdateRequest, user_id: int) -> dict[str, int]:
    values = {k: v for k, v in data.model_dump(exclude={"ids"}, exclude_unset=True).items()}
    if not values:
        raise ValidationException("Nothing to update")
    n = 0
    for asset_id in sorted(set(data.ids)):
        await update_asset(db, asset_id, s.AssetUpdate(**values), user_id)
        n += 1
    return {"updated": n}


async def bulk_retire(db: AsyncSession, ids: list[int], user_id: int) -> dict[str, int]:
    for asset_id in sorted(set(ids)):
        await retire_asset(db, asset_id, user_id)
    return {"updated": len(set(ids))}


# ---------------------------------------------------------------- repairs
async def _sync_repair_condition(db: AsyncSession, asset: Asset) -> None:
    if asset.condition_status == "Written-Off":
        return
    open_count = (await db.execute(select(func.count()).where(AssetRepair.asset_id == asset.id,
                                                              AssetRepair.status == "In Progress"))).scalar_one()
    asset.condition_status = "In Repair" if open_count else "Operational"


async def add_repair(db: AsyncSession, asset_id: int, data: s.RepairCreate, user_id: int, audit: bool = True) -> AssetRepair:
    asset = await get_asset(db, asset_id)
    row = AssetRepair(asset_id=asset.id, **data.model_dump(), created_by=user_id)
    db.add(row)
    await db.flush()
    await _sync_repair_condition(db, asset)
    if audit:
        await log_audit(db, "asset_repair.create", "asset", asset.id, asset.display_name, new_values=data.model_dump(mode="json"), user_id=user_id)
    return row


async def _child(db: AsyncSession, model, asset_id: int, row_id: int):
    row = await db.get(model, row_id)
    if row is None or row.asset_id != asset_id:
        raise NotFoundException("Entry not found")
    return row


async def update_repair(db: AsyncSession, asset_id: int, repair_id: int, data: s.RepairUpdate, user_id: int) -> AssetRepair:
    asset = await get_asset(db, asset_id)
    row = await _child(db, AssetRepair, asset_id, repair_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    await db.flush()
    await _sync_repair_condition(db, asset)
    await log_audit(db, "asset_repair.update", "asset", asset.id, asset.display_name, new_values=data.model_dump(mode="json", exclude_unset=True), user_id=user_id)
    return row


async def delete_repair(db: AsyncSession, asset_id: int, repair_id: int, user_id: int) -> None:
    asset = await get_asset(db, asset_id)
    row = await _child(db, AssetRepair, asset_id, repair_id)
    await db.delete(row)
    await db.flush()
    await _sync_repair_condition(db, asset)
    await log_audit(db, "asset_repair.delete", "asset", asset.id, asset.display_name, old_values={"issue": row.issue, "repair_date": str(row.repair_date)}, user_id=user_id)


async def import_repairs(db: AsyncSession, items: list[s.RepairImportItem], user_id: int) -> dict[str, int]:
    for item in items:
        await add_repair(db, item.asset_id, s.RepairCreate(**item.model_dump(exclude={"asset_id"})), user_id, audit=False)
    await log_audit(db, "asset_repair.import", "asset", None, None, user_id=user_id, details=f"Imported {len(items)} repairs")
    return {"created": len(items)}


# ---------------------------------------------------------------- maintenance
async def add_maintenance(db: AsyncSession, asset_id: int, data: s.MaintenanceCreate, user_id: int) -> AssetMaintenance:
    asset = await get_asset(db, asset_id)
    row = AssetMaintenance(asset_id=asset.id, **data.model_dump(mode="json") | {"maintenance_date": data.maintenance_date}, created_by=user_id)
    db.add(row)
    await db.flush()
    await log_audit(db, "asset_maintenance.create", "asset", asset.id, asset.display_name, new_values=data.model_dump(mode="json"), user_id=user_id)
    return row


async def update_maintenance(db: AsyncSession, asset_id: int, log_id: int, data: s.MaintenanceUpdate, user_id: int) -> AssetMaintenance:
    asset = await get_asset(db, asset_id)
    row = await _child(db, AssetMaintenance, asset_id, log_id)
    changes = data.model_dump(exclude_unset=True)
    if "components" in changes:
        changes["components"] = [c.model_dump() for c in data.components or []]
    for k, v in changes.items():
        setattr(row, k, v)
    await log_audit(db, "asset_maintenance.update", "asset", asset.id, asset.display_name, new_values=data.model_dump(mode="json", exclude_unset=True), user_id=user_id)
    return row


async def delete_maintenance(db: AsyncSession, asset_id: int, log_id: int, user_id: int) -> None:
    asset = await get_asset(db, asset_id)
    row = await _child(db, AssetMaintenance, asset_id, log_id)
    await db.delete(row)
    await log_audit(db, "asset_maintenance.delete", "asset", asset.id, asset.display_name, old_values={"maintenance_date": str(row.maintenance_date)}, user_id=user_id)


# ---------------------------------------------------------------- borrows
async def create_borrow(db: AsyncSession, data: s.BorrowCreate, user_id: int) -> AssetBorrow:
    asset = None
    if data.asset_id:
        asset = await get_asset(db, data.asset_id)
        if asset.assignment_status != "Unassigned" or asset.condition_status != "Operational":
            raise ValidationException("Only unassigned, operational assets can be borrowed")
    emp = await _employee(db, data.employee_id) if data.employee_id else None
    row = AssetBorrow(
        asset_id=asset.id if asset else None,
        item_name=(data.item_name or "").strip() or (asset.display_name if asset else ""),
        employee_id=emp.id if emp else None,
        borrower_name=emp.name if emp else (data.borrower_name or "").strip(),
        borrower_email=(emp.email if emp else data.borrower_email),
        borrowed_date=data.borrowed_date, expected_return_date=data.expected_return_date,
        notes=data.notes, created_by=user_id,
    )
    db.add(row)
    if asset:
        asset.assignment_status = "Borrowed"
    await db.flush()
    await log_audit(db, "borrow.create", "borrow", row.id, row.item_name,
                    new_values={"borrower": row.borrower_name, "asset_id": row.asset_id,
                                "expected_return_date": str(row.expected_return_date)}, user_id=user_id)
    return row


async def _borrow(db: AsyncSession, borrow_id: int, include_deleted: bool = False) -> AssetBorrow:
    row = await db.get(AssetBorrow, borrow_id)
    if row is None or (row.deleted_at is not None and not include_deleted):
        raise NotFoundException("Borrow entry not found")
    return row


async def _release_borrowed_asset(db: AsyncSession, row: AssetBorrow) -> None:
    if row.asset_id:
        asset = await db.get(Asset, row.asset_id)
        others = (await db.execute(select(func.count()).where(AssetBorrow.asset_id == row.asset_id, AssetBorrow.id != row.id,
                                                              AssetBorrow.returned_date.is_(None), AssetBorrow.deleted_at.is_(None)))).scalar_one()
        if asset and asset.assignment_status == "Borrowed" and not others:
            asset.assignment_status = "Unassigned"


async def update_borrow(db: AsyncSession, borrow_id: int, data: s.BorrowUpdate, user_id: int) -> AssetBorrow:
    row = await _borrow(db, borrow_id)
    changes = data.model_dump(exclude_unset=True)
    if "employee_id" in changes and changes["employee_id"]:
        emp = await _employee(db, changes["employee_id"])
        changes.setdefault("borrower_name", emp.name)
        changes.setdefault("borrower_email", emp.email)
    was_open = row.returned_date is None
    for k, v in changes.items():
        setattr(row, k, v)
    if row.expected_return_date and row.expected_return_date < row.borrowed_date:
        raise ValidationException("Expected return date cannot be before the borrow date")
    if was_open and row.returned_date is not None:
        await _release_borrowed_asset(db, row)
    await log_audit(db, "borrow.update", "borrow", row.id, row.item_name, new_values=data.model_dump(mode="json", exclude_unset=True), user_id=user_id)
    return row


async def return_borrow(db: AsyncSession, borrow_id: int, on: date | None, user_id: int) -> AssetBorrow:
    row = await _borrow(db, borrow_id)
    if row.returned_date is not None:
        raise ValidationException("Already returned")
    row.returned_date = on or _today()
    if row.returned_date < row.borrowed_date:
        raise ValidationException("Return date cannot be before the borrow date")
    await _release_borrowed_asset(db, row)
    await log_audit(db, "borrow.return", "borrow", row.id, row.item_name, new_values={"returned_date": str(row.returned_date)}, user_id=user_id)
    return row


async def delete_borrow(db: AsyncSession, borrow_id: int, user_id: int) -> None:
    row = await _borrow(db, borrow_id)
    if row.returned_date is None:
        await _release_borrowed_asset(db, row)
    row.deleted_at = datetime.now(timezone.utc)
    await log_audit(db, "borrow.delete", "borrow", row.id, row.item_name, user_id=user_id)


async def restore_borrow(db: AsyncSession, borrow_id: int, user_id: int) -> AssetBorrow:
    row = await _borrow(db, borrow_id, include_deleted=True)
    if row.deleted_at is None:
        return row
    if row.returned_date is None and row.asset_id:
        asset = await db.get(Asset, row.asset_id)
        if asset and asset.assignment_status != "Unassigned":
            raise ConflictException("The asset is no longer available; mark the entry returned first")
        if asset:
            asset.assignment_status = "Borrowed"
    row.deleted_at = None
    await log_audit(db, "borrow.restore", "borrow", row.id, row.item_name, user_id=user_id)
    return row


async def list_borrows(db: AsyncSession, *, status: str | None = None, q: str | None = None, employee_id: int | None = None,
                       deleted: bool = False, page: int = 1, page_size: int = 50) -> dict[str, Any]:
    stmt = select(AssetBorrow, Asset.serial_number).outerjoin(Asset, Asset.id == AssetBorrow.asset_id).where(
        AssetBorrow.deleted_at.isnot(None) if deleted else AssetBorrow.deleted_at.is_(None))
    if status == "open":
        stmt = stmt.where(AssetBorrow.returned_date.is_(None))
    elif status == "overdue":
        stmt = stmt.where(AssetBorrow.returned_date.is_(None), AssetBorrow.expected_return_date < _today())
    elif status == "returned":
        stmt = stmt.where(AssetBorrow.returned_date.isnot(None))
    if employee_id:
        stmt = stmt.where(AssetBorrow.employee_id == employee_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(AssetBorrow.item_name.ilike(like), AssetBorrow.borrower_name.ilike(like), Asset.serial_number.ilike(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(AssetBorrow.borrowed_date.desc(), AssetBorrow.id.desc())
                             .offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [borrow_view(b, serial) for b, serial in rows], "page": page, "page_size": page_size,
            "total": total, "total_pages": max(1, ceil(total / page_size))}


async def list_log(db: AsyncSession, model, date_col, *, q: str | None, page: int, page_size: int) -> dict[str, Any]:
    """Cross-asset repair or maintenance log (IT Logs page)."""
    stmt = select(model, Asset).join(Asset, Asset.id == model.asset_id).where(Asset.deleted_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        conds = [Asset.serial_number.ilike(like), Asset.brand.ilike(like), Asset.model.ilike(like)]
        if model is AssetRepair:
            conds += [AssetRepair.issue.ilike(like), AssetRepair.vendor.ilike(like)]
        stmt = stmt.where(or_(*conds))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(date_col.desc(), model.id.desc()).offset((page - 1) * page_size).limit(page_size))).unique().all()
    items = []
    for row, asset in rows:
        d = {c.key: getattr(row, c.key) for c in model.__table__.columns}
        d["asset_name"] = asset.display_name
        items.append(d)
    return {"items": items, "page": page, "page_size": page_size, "total": total, "total_pages": max(1, ceil(total / page_size))}


# ---------------------------------------------------------------- offboarding
async def offboard_assets(db: AsyncSession, employee: Employee, on: date, return_assets: bool, close_borrows: bool,
                          user_id: int) -> dict[str, int]:
    returned = closed = 0
    if return_assets:
        held = (await db.execute(select(Asset).where(Asset.employee_id == employee.id, Asset.deleted_at.is_(None)))).unique().scalars().all()
        for asset in held:
            await _close_assignment(db, asset, on, user_id)
            returned += 1
    if close_borrows:
        open_rows = (await db.execute(select(AssetBorrow).where(AssetBorrow.employee_id == employee.id,
                                                                AssetBorrow.returned_date.is_(None),
                                                                AssetBorrow.deleted_at.is_(None)))).scalars().all()
        for row in open_rows:
            row.returned_date = max(on, row.borrowed_date)
            await _release_borrowed_asset(db, row)
            closed += 1
    await db.flush()
    return {"assets_returned": returned, "borrows_closed": closed}


async def employee_asset_summary(db: AsyncSession, employee_id: int) -> dict[str, Any]:
    assets = (await db.execute(select(Asset).where(Asset.employee_id == employee_id, Asset.deleted_at.is_(None))
                               .order_by(Asset.asset_type))).unique().scalars().all()
    history = (await db.execute(select(AssetAssignment, Asset).join(Asset, Asset.id == AssetAssignment.asset_id)
                                .where(AssetAssignment.employee_id == employee_id)
                                .order_by(AssetAssignment.assigned_from.desc()))).unique().all()
    borrows = (await db.execute(select(AssetBorrow).where(AssetBorrow.employee_id == employee_id, AssetBorrow.deleted_at.is_(None))
                                .order_by(AssetBorrow.borrowed_date.desc()))).scalars().all()
    return {
        "assets": [s.AssetResponse.model_validate(a).model_dump() for a in assets],
        "history": [{**s.AssetAssignmentResponse.model_validate(h).model_dump(), "asset_name": a.display_name} for h, a in history],
        "borrows": [borrow_view(b) for b in borrows],
    }


async def detach_employee_name(db: AsyncSession, employee: Employee) -> None:
    """Keep snapshot names current when an employee is renamed."""
    await db.execute(update(AssetAssignment).where(AssetAssignment.employee_id == employee.id,
                                                   AssetAssignment.assigned_to.is_(None)).values(employee_name=employee.name))
