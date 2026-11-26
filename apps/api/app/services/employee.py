from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictException, NotFoundException
from app.models.employee import Employee
from app.schemas.employee import EmployeeCreate, EmployeeUpdate, EmployeeImportRequest, EmployeeBulkUpdate, EmployeeBulkDelete, clean_bus
from app.services.audit import log_audit


EXTRA_FIELDS = {"username", "regions", "gender", "avatar_url", "join_date", "resignation_date"}


def _serialize(e: Employee) -> dict[str, Any]:
    return {
        "id": e.id,
        "name": e.name,
        "email": e.email,
        "business_units": e.business_units,
        "title": e.title,
        "active": e.active,
        "username": e.username,
        "regions": e.regions or [],
        "gender": e.gender,
        "avatar_url": e.avatar_url,
        "join_date": e.join_date,
        "resignation_date": e.resignation_date,
        "created_at": e.created_at,
        "updated_at": e.updated_at,
    }


async def get_employee(db: AsyncSession, employee_id: int) -> dict[str, Any]:
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundException("Employee not found")
    return _serialize(employee)


async def list_employees(db: AsyncSession, include_inactive: bool = False) -> list[dict[str, Any]]:
    q = select(Employee).order_by(Employee.name)
    if not include_inactive:
        q = q.where(Employee.active == True)  # noqa: E712
    rows = (await db.execute(q)).scalars().all()
    return [_serialize(e) for e in rows]


async def _upsert(db: AsyncSession, data: EmployeeCreate) -> tuple[Employee, bool]:
    existing = (await db.execute(
        select(Employee).where(func_lower_name(data.name))
    )).scalar_one_or_none()
    if existing:
        existing.email = data.email
        existing.business_units = data.resolved_business_units()
        existing.title = data.title
        existing.active = data.active
        return existing, True
    employee = Employee(
        name=data.name.strip(),
        email=data.email,
        business_units=data.resolved_business_units(),
        title=data.title,
        active=data.active,
    )
    db.add(employee)
    return employee, False


def func_lower_name(name: str):
    from sqlalchemy import func
    return func.lower(func.btrim(func.coalesce(Employee.name, ""))) == name.strip().lower()


async def import_employees(db: AsyncSession, data: EmployeeImportRequest, user_id: int) -> dict[str, int]:
    created = updated = 0
    for item in data.items:
        _, was_existing = await _upsert(db, item)
        if was_existing:
            updated += 1
        else:
            created += 1
    await db.flush()
    await log_audit(db, "employee.import", "settings", None, None, user_id=user_id,
                    details=f"Imported {created} new employees, updated {updated}")
    return {"created": created, "updated": updated}


async def bulk_update_employees(db: AsyncSession, data: EmployeeBulkUpdate, user_id: int) -> dict[str, int]:
    ids = list(dict.fromkeys(data.ids))[:1000]
    rows = (await db.execute(select(Employee).where(Employee.id.in_(ids)))).scalars().all()
    updates: dict[str, Any] = {}
    if data.business_units is not None:
        updates["business_units"] = clean_bus(data.business_units)
    if data.active is not None:
        updates["active"] = data.active
    for emp in rows:
        for k, v in updates.items():
            setattr(emp, k, v)
    await db.flush()
    await log_audit(db, "employee.bulk_update", "settings", None, None, user_id=user_id,
                    details=f"Bulk-updated {len(rows)} employees")
    return {"updated": len(rows), "deleted": 0}


async def bulk_delete_employees(db: AsyncSession, data: EmployeeBulkDelete, user_id: int) -> dict[str, int]:
    ids = list(dict.fromkeys(data.ids))[:1000]
    rows = (await db.execute(select(Employee).where(Employee.id.in_(ids)))).scalars().all()
    for emp in rows:
        await db.delete(emp)
    await db.flush()
    await log_audit(db, "employee.bulk_delete", "settings", None, None, user_id=user_id,
                    details=f"Bulk-deleted {len(rows)} employees")
    return {"updated": 0, "deleted": len(rows)}


# ---- CSV / XLSX file import with column matching ----

COLUMN_CANDIDATES: dict[str, tuple[str, ...]] = {
    "name": ("name", "full name", "employee", "employee name", "full_name", "emp_name"),
    "email": ("email", "e-mail", "email address", "mail"),
    "business_units": ("business unit", "business_units", "business_unit", "bu", "unit", "department", "dept"),
    "title": ("title", "position", "job title", "role"),
}


def _match_columns(headers: list[str]) -> dict[str, int | None]:
    """Exact-name match first, then fuzzy contains - first column wins per field."""
    mapping: dict[str, int | None] = {key: None for key in COLUMN_CANDIDATES}
    for idx, raw in enumerate(headers):
        h = (raw or "").strip().lower().replace("_", " ")
        for key, candidates in COLUMN_CANDIDATES.items():
            if mapping[key] is None and h in candidates:
                mapping[key] = idx
    for idx, raw in enumerate(headers):
        h = (raw or "").strip().lower()
        for key, candidates in COLUMN_CANDIDATES.items():
            if mapping[key] is None and any(c in h for c in candidates):
                mapping[key] = idx
    return mapping


def _read_table_rows(filename: str, content: bytes) -> tuple[list[str], list[list[str]]]:
    """Return (headers, data_rows) from a CSV or XLSX file."""
    from io import BytesIO, StringIO
    import csv
    lower = filename.lower()
    if lower.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        all_rows = [[("" if c is None else str(c).strip()) for c in row] for row in ws.iter_rows(values_only=True)]
        wb.close()
    else:
        text = content.decode("utf-8-sig", errors="replace")
        sample = text[:2048]
        delimiter = ";" if sample.count(";") > sample.count(",") else ","
        all_rows = list(csv.reader(StringIO(text), delimiter=delimiter))
    # drop fully-empty rows, find the first non-empty row as the header
    non_empty = [r for r in all_rows if any((c or "").strip() for c in r)]
    if not non_empty:
        return [], []
    headers = non_empty[0]
    rows = [r for r in non_empty[1:] if any((c or "").strip() for c in r)]
    return headers, rows


def _cell(row: list[str], idx: int | None) -> str | None:
    if idx is None or idx >= len(row):
        return None
    val = (row[idx] or "").strip()
    return val or None


def _resolve_mapping(headers: list[str], mapping: dict[str, str | None] | None) -> dict[str, int | None]:
    """Use the user-provided mapping (field → column header) when given, else auto-detect."""
    if mapping:
        lower_headers = [(h or "").strip().lower() for h in headers]
        resolved: dict[str, int | None] = {}
        for key in COLUMN_CANDIDATES:
            wanted = (mapping.get(key) or "").strip().lower()
            resolved[key] = lower_headers.index(wanted) if wanted and wanted in lower_headers else None
        if resolved.get("name") is None:
            raise ConflictException("The Name column must be mapped to import.")
        return resolved
    return _match_columns(headers)


async def import_employee_file(
    db: AsyncSession, filename: str, content: bytes, user_id: int, preview: bool = False,
    mapping: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    headers, rows = _read_table_rows(filename, content)
    if not headers:
        raise ConflictException("The file appears to be empty")

    mapping = _resolve_mapping(headers, mapping)
    if mapping.get("name") is None:
        raise ConflictException(
            "Could not find a name column. Expected a column called 'Name' (or 'Full Name' / 'Employee Name')."
        )

    def row_to_item(row: list[str]) -> EmployeeCreate | None:
        name = (_cell(row, mapping["name"]) or "").strip()
        if not name:
            return None
        bus = _cell(row, mapping.get("business_units"))
        return EmployeeCreate(
            name=name,
            email=_cell(row, mapping["email"]) if mapping.get("email") is not None else None,
            business_units=[bus] if bus else [],
            title=_cell(row, mapping["title"]) if mapping.get("title") is not None else None,
            active=True,
        )

    if preview:
        previews = []
        for r in rows[:5]:
            it = row_to_item(r)
            previews.append({
                "name": it.name if it else "",
                "business_units": it.business_units if it else [],
                "email": it.email if it else None,
                "title": it.title if it else None,
            })
        return {
            "columns": headers,
            "mapping": {k: (headers[v] if v is not None and v < len(headers) else None) for k, v in mapping.items()},
            "total_rows": len(rows),
            "preview_rows": previews,
        }
    created = updated = skipped = 0
    errors: list[str] = []
    for n, row in enumerate(rows, start=2):  # row 1 = header
        try:
            item = row_to_item(row)
            if item is None:
                skipped += 1
                errors.append(f"Row {n}: missing name - skipped")
                continue
            if item.email and ("@" not in item.email or item.email.startswith("@") or item.email.endswith("@")):
                skipped += 1
                errors.append(f"Row {n}: invalid email '{item.email}' - skipped")
                continue
            _, was_existing = await _upsert(db, item)
            if was_existing:
                updated += 1
            else:
                created += 1
        except Exception as exc:  # per-row resilience
            skipped += 1
            errors.append(f"Row {n}: {str(exc)[:120]}")
    await db.flush()
    await log_audit(db, "employee.import_file", "settings", None, None, user_id=user_id,
                    details=f"File import {filename}: {created} created, {updated} updated, {skipped} skipped")
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "errors": errors[:10],
        "total_rows": len(rows),
    }


async def create_employee(db: AsyncSession, data: EmployeeCreate, user_id: int) -> dict[str, Any]:
    dupe = (await db.execute(
        select(Employee).where(func_lower_name(data.name))
    )).scalar_one_or_none()
    if dupe:
        raise ConflictException(f"An employee named '{data.name}' already exists")
    employee = Employee(
        name=data.name.strip(),
        email=data.email,
        business_units=data.resolved_business_units(),
        title=data.title,
        active=data.active,
        **data.model_dump(include=EXTRA_FIELDS),
    )
    db.add(employee)
    await db.flush()
    await db.refresh(employee)
    await log_audit(db, "employee.create", "settings", employee.id, employee.name,
                    user_id=user_id, details=f"Added employee {employee.name}")
    return _serialize(employee)


async def update_employee(db: AsyncSession, employee_id: int, data: EmployeeUpdate, user_id: int) -> dict[str, Any]:
    employee = (await db.execute(select(Employee).where(Employee.id == employee_id))).scalar_one_or_none()
    if not employee:
        raise NotFoundException("Employee not found")
    updates = data.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"]:
        dupe = (await db.execute(
            select(Employee).where(func_lower_name(updates["name"]), Employee.id != employee_id)
        )).scalar_one_or_none()
        if dupe:
            raise ConflictException(f"An employee named '{updates['name']}' already exists")
        updates["name"] = updates["name"].strip()
    resolved_bus = data.resolved_business_units()
    if resolved_bus is not None:
        updates["business_units"] = resolved_bus
    updates.pop("business_unit", None)
    for k, v in updates.items():
        setattr(employee, k, v)
    await db.flush()
    if "name" in updates:
        from app.services.asset import detach_employee_name
        await detach_employee_name(db, employee)
    await db.refresh(employee)
    await log_audit(db, "employee.update", "settings", employee.id, employee.name,
                    user_id=user_id, details=f"Updated employee {employee.name}")
    return _serialize(employee)


async def delete_employee(db: AsyncSession, employee_id: int, user_id: int) -> None:
    employee = (await db.execute(select(Employee).where(Employee.id == employee_id))).scalar_one_or_none()
    if not employee:
        raise NotFoundException("Employee not found")
    name = employee.name
    await db.delete(employee)
    await db.flush()
    await log_audit(db, "employee.delete", "settings", employee_id, name,
                    user_id=user_id, details=f"Deleted employee {name}")
