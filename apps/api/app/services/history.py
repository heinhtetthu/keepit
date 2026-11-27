"""Per-entity activity history and "restore this version".

The timeline for an asset, record or employee is built from ``audit_logs``
(every mutation writes one) plus a few related tables whose events are not
audited against the entity itself (an employee's asset/seat/borrow periods,
automatic renewals done by the worker).

Restore semantics: "Restore this version" puts the entity's editable fields
back to the state they had RIGHT AFTER the chosen entry. Only entries that
carry a full snapshot of that state are restorable: asset create/update,
record create/update and employee create/update (and earlier restores).
Ids, timestamps, deleted/archived state, holder/assignment, condition and
secret or sensitive fields are never restored. The restore runs through the
normal update service (validation, uniqueness, RLS) and its audit entry is
relabelled "Restored a previous version".
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Any, Iterable

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundException, ValidationException
from app.models.audit import AuditLog
from app.models.user import User

SENSITIVE = re.compile(r"password|token|secret|recovery|license.?key|api.?key", re.I)
MAX_ROWS = 2000

ASSET_LABELS = {
    "asset_type": "Type", "other_type_name": "Type name", "brand": "Brand", "model": "Model",
    "serial_number": "Serial number", "location": "Location", "specs": "Specs", "purchase_date": "Purchase date",
    "purchase_cost": "Purchase cost", "currency": "Currency", "supplier": "Supplier",
    "warranty_end_date": "Warranty end", "notes": "Notes", "assignment_status": "Assignment",
    "condition_status": "Condition", "employee": "Holder", "effective_date": "Effective date",
    "repair_date": "Repair date", "issue": "Issue", "status": "Status", "cost": "Cost", "vendor": "Vendor",
    "warranty": "Warranty", "maintenance_date": "Maintenance date", "asset_status": "Asset status",
    "operating_system": "Operating system", "body_condition": "Body condition", "components": "Components",
    "item_name": "Item", "borrower_name": "Borrower", "borrower_email": "Borrower email",
    "borrowed_date": "Borrowed on", "expected_return_date": "Expected return", "returned_date": "Returned on",
    "employee_name": "Employee", "assigned_from": "From", "assigned_to": "To", "remark": "Remark",
}
ASSET_RESTORE = ("asset_type", "other_type_name", "brand", "model", "serial_number", "location", "specs",
                 "purchase_date", "purchase_cost", "currency", "supplier", "warranty_end_date", "notes")
ASSET_HIDDEN = {"employee_id"}

EMPLOYEE_LABELS = {
    "name": "Name", "email": "Email", "phone": "Phone", "username": "Username", "business_units": "Business units",
    "regions": "Regions", "title": "Title", "department": "Department", "country": "Country", "gender": "Gender",
    "join_date": "Join date", "resignation_date": "Resignation date", "active": "Active",
    "deactivated": "Deactivated", "effective_date": "Effective date",
}
EMPLOYEE_RESTORE = ("name", "email", "phone", "username", "business_units", "regions", "title", "department",
                    "country", "gender", "join_date", "resignation_date")

KIND_LABELS = {"edit": "Changes", "assignment": "Assignments", "repair": "Repairs", "maintenance": "Maintenance",
               "borrow": "Borrows", "renewal": "Renewals", "seat": "Seats", "offboarding": "Offboarding"}

REVERT_ACTION = {"asset": "asset.revert", "record": "record.revert", "employee": "employee.revert"}
RESTORABLE_ACTIONS = {
    "asset": {"asset.create", "asset.update", "asset.revert"},
    "record": {"create", "update", "record.revert"},
    "employee": {"employee.create", "employee.update", "employee.revert"},
}


# ---------------------------------------------------------------- snapshots (used by the services)
def _plain(v: Any) -> Any:
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    return v


def employee_snapshot(e) -> dict[str, Any]:
    """Full editable state of an employee for the audit trail (no avatar, no ids)."""
    return {k: _plain(getattr(e, k, None)) for k in EMPLOYEE_LABELS if k not in ("deactivated", "effective_date")}


def _restorable_field(field) -> bool:
    return bool(field.active) and field.field_type != "secret" and not SENSITIVE.search(field.name or "")


def record_snapshot(detail: dict[str, Any], fields: Iterable) -> dict[str, Any]:
    """State of a record after a change: name, status and every active, non-secret field (None = empty)."""
    values = {v["field_id"]: v["value"] for v in detail.get("values") or []}
    return {"name": detail.get("name"), "status": detail.get("status"),
            "fields": {str(f.id): _plain(values.get(f.id)) for f in fields if _restorable_field(f)}}


# ---------------------------------------------------------------- diff + wording
def _empty(v: Any) -> bool:
    return v is None or v == "" or v == [] or v == {}


def _humanize(key: str) -> str:
    return key.replace("_", " ").strip().capitalize()


def _changes(old: dict | None, new: dict | None, labels: dict[str, str], hidden: set[str] = frozenset()) -> list[dict]:
    old = {k: v for k, v in (old or {}).items() if not str(k).startswith("_") and k not in hidden}
    new = {k: v for k, v in (new or {}).items() if not str(k).startswith("_") and k not in hidden}
    out: list[dict] = []
    for key in list(dict.fromkeys([*old.keys(), *new.keys()])):
        o, n = old.get(key), new.get(key)
        if isinstance(n, dict) and n and set(n) <= {"old", "new"}:
            o, n = n.get("old"), n.get("new")
        elif key not in old and key in new and _empty(n):
            continue
        if key == "specs" and (isinstance(o, dict) or isinstance(n, dict)):
            o, n = o if isinstance(o, dict) else {}, n if isinstance(n, dict) else {}
            for sk in dict.fromkeys([*o.keys(), *n.keys()]):
                if o.get(sk) != n.get(sk):
                    out.append({"field": f"specs.{sk}", "label": f"Specs: {sk}", "before": o.get(sk), "after": n.get(sk)})
            continue
        if o == n and key in old:
            continue
        out.append({"field": str(key), "label": labels.get(key) or _humanize(str(key)), "before": _plain(o), "after": _plain(n)})
    return out


def _list(labels: list[str]) -> str:
    if not labels:
        return ""
    if len(labels) <= 3:
        return labels[0] if len(labels) == 1 else ", ".join(labels[:-1]) + " and " + labels[-1]
    return ", ".join(labels[:2]) + f" and {len(labels) - 2} more"


def _field_list(changes: list[dict]) -> str:
    return _list(list(dict.fromkeys(c["label"] for c in changes)))


def _val(values: dict | None, key: str) -> str | None:
    v = (values or {}).get(key)
    return None if _empty(v) else str(v)


ASSET_TEXT = {
    "asset.create": ("edit", "created this asset"),
    "asset.delete": ("edit", "moved this asset to trash"),
    "asset.restore": ("edit", "restored this asset from trash"),
    "asset.revert": ("edit", "restored a previous version"),
    "asset_assignment.delete": ("assignment", "removed a past assignment"),
    "asset_repair.create": ("repair", "logged a repair"),
    "asset_repair.update": ("repair", "updated a repair"),
    "asset_repair.delete": ("repair", "deleted a repair"),
    "asset_maintenance.create": ("maintenance", "logged maintenance"),
    "asset_maintenance.update": ("maintenance", "updated a maintenance entry"),
    "asset_maintenance.delete": ("maintenance", "deleted a maintenance entry"),
    "borrow.create": ("borrow", "lent this asset out"),
    "borrow.update": ("borrow", "updated a loan"),
    "borrow.return": ("borrow", "marked the loan returned"),
    "borrow.delete": ("borrow", "deleted a loan"),
    "borrow.restore": ("borrow", "restored a loan"),
}
RECORD_TEXT = {
    "create": ("edit", "created this record"),
    "archive": ("edit", "archived this record"),
    "restore": ("edit", "restored this record"),
    "record.trash": ("edit", "moved this record to trash"),
    "record.duplicate": ("edit", "created this record as a copy"),
    "record.revert": ("edit", "restored a previous version"),
    "record.bulk_archive": ("edit", "archived this record in a bulk action"),
    "record.bulk_status": ("edit", "changed the status in a bulk action"),
    "record.bulk_trash": ("edit", "moved this record to trash in a bulk action"),
    "renew": ("renewal", "renewed this record"),
    "renewal.update": ("renewal", "edited a renewal entry"),
    "renewal.delete": ("renewal", "deleted a renewal entry"),
    "assignment.create": ("seat", "changed the seat holder"),
    "assignment.update": ("seat", "edited a seat assignment"),
    "assignment.delete": ("seat", "deleted a seat assignment"),
    "assignment.swap": ("seat", "swapped seat holders"),
    "assignment.bulk": ("seat", "changed the seat holder in a bulk action"),
}
EMPLOYEE_TEXT = {
    "employee.create": ("edit", "added this employee"),
    "employee.delete": ("edit", "deleted this employee"),
    "employee.revert": ("edit", "restored a previous version"),
    "employee.release": ("offboarding", "released license seats"),
    "employee.offboard": ("offboarding", "offboarded this employee"),
}


def _describe(entity: str, log: AuditLog, changes: list[dict]) -> tuple[str, str]:
    a, old, new = log.action, log.old_values, log.new_values
    if entity == "asset":
        if a == "asset.update":
            return "edit", f"updated {_field_list(changes)}" if changes else "saved the asset without changes"
        if a == "asset.assign":
            return "assignment", f"assigned this asset to {_val(new, 'employee') or 'an employee'}"
        if a == "asset.unassign":
            who = _val(old, "employee")
            return "assignment", f"unassigned this asset from {who}" if who else "unassigned this asset"
        kind, text = ASSET_TEXT.get(a, ("edit", _humanize(a.split(".")[-1]).lower()))
        if a == "asset_repair.create" and _val(new, "issue"):
            text += f": {_val(new, 'issue')}"
        if a == "borrow.create" and _val(new, "borrower_name"):
            text = f"lent this asset to {_val(new, 'borrower_name')}"
        return kind, text
    if entity == "record":
        if a == "update":
            if changes:
                return "edit", f"updated {_field_list(changes)}"
            return "edit", "changed the renewal settings" if log.details and "Renew-before" in log.details else "updated this record"
        kind, text = RECORD_TEXT.get(a, ("edit", _humanize(a.split(".")[-1]).lower()))
        return kind, text
    if a == "employee.update":
        return "edit", f"updated {_field_list(changes)}" if changes else "updated this employee"
    kind, text = EMPLOYEE_TEXT.get(a, ("edit", _humanize(a.split(".")[-1]).lower()))
    return kind, text


def _stamp(d: date | datetime | None, fallback: datetime) -> datetime:
    if isinstance(d, datetime):
        return d
    if isinstance(d, date):
        return datetime.combine(d, time(12), tzinfo=timezone.utc)
    return fallback


# ---------------------------------------------------------------- loading
async def _names(db: AsyncSession, ids: set[int]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return dict((await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all())


def _is_restorable(entity: str, log: AuditLog) -> bool:
    if log.action not in RESTORABLE_ACTIONS[entity] or not isinstance(log.new_values, dict):
        return False
    if entity == "record":
        snap = log.new_values.get("_snapshot")
        return isinstance(snap, dict) and isinstance(snap.get("fields"), dict)
    keys = ASSET_RESTORE if entity == "asset" else EMPLOYEE_RESTORE
    return any(k in log.new_values for k in keys) and ("asset_type" in log.new_values or "name" in log.new_values)


async def _record_labels(db: AsyncSession, record_type_id: int) -> dict[str, str]:
    from app.models.record_type import RecordField
    rows = (await db.execute(select(RecordField.id, RecordField.name).where(RecordField.record_type_id == record_type_id))).all()
    return {**{f"field:{i}": n for i, n in rows}, **{str(i): n for i, n in rows}, "name": "Name", "status": "Status"}


async def _audit_rows(db: AsyncSession, entity: str, entity_id: int) -> list[AuditLog]:
    if entity == "asset":
        from app.models.asset import AssetBorrow
        borrow_ids = select(AssetBorrow.id).where(AssetBorrow.asset_id == entity_id).scalar_subquery()
        cond = or_(and_(AuditLog.entity_type == "asset", AuditLog.entity_id == entity_id),
                   and_(AuditLog.entity_type == "borrow", AuditLog.entity_id.in_(borrow_ids)))
    elif entity == "record":
        cond = or_(and_(AuditLog.entity_type == "record", AuditLog.entity_id == entity_id),
                   and_(AuditLog.entity_type == "record_batch", AuditLog.new_values.contains({"record_ids": [entity_id]})))
    else:
        cond = and_(AuditLog.entity_id == entity_id, AuditLog.entity_type.in_(("settings", "employee")),
                    AuditLog.action.like("employee.%"))
    q = select(AuditLog).where(cond).order_by(AuditLog.timestamp.desc(), AuditLog.id.desc()).limit(MAX_ROWS)
    return list((await db.execute(q)).scalars().all())


def _audit_entry(entity: str, log: AuditLog, labels: dict[str, str]) -> dict[str, Any]:
    if isinstance(log.new_values, dict) and "redacted" in log.new_values and len(log.new_values) == 1:
        changes: list[dict] = []
    elif entity == "asset":
        changes = _changes(log.old_values, log.new_values, labels, ASSET_HIDDEN)
    elif entity == "record":
        new = dict(log.new_values or {})
        if log.action == "create" and isinstance(new.get("_snapshot"), dict):
            snap = new["_snapshot"] or {}
            new = {"name": snap.get("name"), "status": snap.get("status"), **(snap.get("fields") or {})}
        changes = _changes(log.old_values, new, labels)
        if log.action == "record.bulk_status":
            changes = [{"field": "status", "label": "Status", "before": None, "after": (log.new_values or {}).get("status")}]
        elif log.action.startswith("record.bulk"):
            changes = []
    else:
        changes = _changes(log.old_values, log.new_values, labels)
        if log.action == "employee.create":
            changes = [c for c in changes if c["field"] != "active"]
    kind, summary = _describe(entity, log, changes)
    return {
        "id": f"audit:{log.id}", "audit_id": log.id, "kind": kind, "action": log.action, "summary": summary,
        "actor_id": log.user_id, "timestamp": log.timestamp, "changes": changes, "details": log.details,
        "restorable": _is_restorable(entity, log), "link": None,
    }


async def _employee_events(db: AsyncSession, employee_id: int, *, assets: bool, records: list[int] | None | bool) -> list[dict]:
    """Asset holding periods, loans and license seats of an employee (not audited against the employee)."""
    from app.models.asset import Asset, AssetAssignment, AssetBorrow
    out: list[dict] = []
    if assets:
        rows = (await db.execute(select(AssetAssignment, Asset).join(Asset, Asset.id == AssetAssignment.asset_id)
                                 .where(AssetAssignment.employee_id == employee_id).limit(MAX_ROWS))).all()
        for row, asset in rows:
            changes = [{"field": "assigned_from", "label": "From", "before": None, "after": _plain(row.assigned_from)},
                       {"field": "assigned_to", "label": "To", "before": None, "after": _plain(row.assigned_to) or "Now"}]
            if row.remark:
                changes.append({"field": "remark", "label": "Remark", "before": None, "after": row.remark})
            verb = "held" if row.assigned_to else "holds"
            out.append({"id": f"asset-assignment:{row.id}", "audit_id": None, "kind": "assignment",
                        "action": "asset_assignment", "summary": f"{verb} {asset.display_name}",
                        "actor_id": row.created_by, "timestamp": _stamp(row.assigned_from, row.created_at),
                        "changes": changes, "details": None, "restorable": False,
                        "link": {"type": "asset", "id": asset.id}, "subject": True})
        borrows = (await db.execute(select(AssetBorrow).where(AssetBorrow.employee_id == employee_id,
                                                              AssetBorrow.deleted_at.is_(None)).limit(MAX_ROWS))).scalars().all()
        for b in borrows:
            changes = [{"field": "borrowed_date", "label": "Borrowed on", "before": None, "after": _plain(b.borrowed_date)}]
            if b.expected_return_date:
                changes.append({"field": "expected_return_date", "label": "Expected return", "before": None,
                                "after": _plain(b.expected_return_date)})
            changes.append({"field": "returned_date", "label": "Returned on", "before": None,
                            "after": _plain(b.returned_date) or "Not yet"})
            out.append({"id": f"borrow:{b.id}", "audit_id": None, "kind": "borrow", "action": "borrow",
                        "summary": f"borrowed {b.item_name}", "actor_id": b.created_by,
                        "timestamp": _stamp(b.borrowed_date, b.created_at), "changes": changes, "details": b.notes,
                        "restorable": False, "link": {"type": "asset", "id": b.asset_id} if b.asset_id else None,
                        "subject": True})
    if records is not False:
        from app.models.assignment import RecordAssignment
        from app.models.record import Record
        from app.models.record_type import RecordType
        q = (select(RecordAssignment, Record, RecordType.slug).join(Record, Record.id == RecordAssignment.record_id)
             .join(RecordType, RecordType.id == Record.record_type_id)
             .where(RecordAssignment.employee_id == employee_id, Record.deleted_at.is_(None)).limit(MAX_ROWS))
        if isinstance(records, list):
            q = q.where(Record.record_type_id.in_(records or [-1]))
        for row, record, slug in (await db.execute(q)).all():
            changes = [{"field": "effective_date", "label": "Effective date", "before": None, "after": _plain(row.effective_date)}]
            if row.reason:
                changes.append({"field": "reason", "label": "Reason", "before": None, "after": row.reason})
            if row.business_unit:
                changes.append({"field": "business_unit", "label": "Business unit", "before": None, "after": row.business_unit})
            out.append({"id": f"seat:{row.id}", "audit_id": None, "kind": "seat", "action": "seat",
                        "summary": f"got a seat on {record.name}", "actor_id": row.created_by,
                        "timestamp": _stamp(row.effective_date, row.created_at), "changes": changes, "details": row.notes,
                        "restorable": False, "link": {"type": "record", "id": record.id, "slug": slug}, "subject": True})
    return out


async def _record_events(db: AsyncSession, record_id: int) -> list[dict]:
    """Automatic renewals are written by the worker without an audit entry."""
    from app.models.renewal import RecordRenewal
    rows = (await db.execute(select(RecordRenewal).where(RecordRenewal.record_id == record_id,
                                                         RecordRenewal.is_automatic.is_(True)).limit(MAX_ROWS))).scalars().all()
    return [{"id": f"renewal:{r.id}", "audit_id": None, "kind": "renewal", "action": "renew.auto",
             "summary": "renewed automatically", "actor_id": None, "timestamp": r.created_at,
             "changes": [{"field": "expiry", "label": "Expiry", "before": _plain(r.old_date), "after": _plain(r.new_date)}],
             "details": None, "restorable": False, "link": None} for r in rows]


async def entity_history(db: AsyncSession, entity: str, entity_id: int, *, kind: str | None, page: int, page_size: int,
                         record_type_id: int | None = None, employee_assets: bool = False,
                         employee_records: list[int] | None | bool = False) -> dict[str, Any]:
    logs = await _audit_rows(db, entity, entity_id)
    if entity == "asset":
        labels = ASSET_LABELS
    elif entity == "record":
        labels = await _record_labels(db, record_type_id) if record_type_id else {}
    else:
        labels = EMPLOYEE_LABELS
    items = [_audit_entry(entity, log, labels) for log in logs]
    if entity == "employee":
        items += await _employee_events(db, entity_id, assets=employee_assets, records=employee_records)
    elif entity == "record":
        items += await _record_events(db, entity_id)
    items.sort(key=lambda e: (e["timestamp"], e["audit_id"] or 0), reverse=True)
    counts: dict[str, int] = {}
    for e in items:
        counts[e["kind"]] = counts.get(e["kind"], 0) + 1
    if kind:
        items = [e for e in items if e["kind"] == kind]
    total = len(items)
    chunk = items[(page - 1) * page_size: page * page_size]
    names = await _names(db, {e["actor_id"] for e in chunk if e["actor_id"]})
    for e in chunk:
        e["actor_name"] = names.get(e["actor_id"]) if e["actor_id"] else None
        e.setdefault("subject", False)
    kinds = [{"key": k, "label": KIND_LABELS.get(k, _humanize(k)), "count": n}
             for k, n in sorted(counts.items(), key=lambda kv: list(KIND_LABELS).index(kv[0]) if kv[0] in KIND_LABELS else 99)]
    return {"items": chunk, "total": total, "page": page, "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size, "kinds": kinds}


# ---------------------------------------------------------------- restore
async def _entry(db: AsyncSession, entity: str, entity_id: int, audit_id: int) -> AuditLog:
    log = await db.get(AuditLog, audit_id)
    types = {"asset": ("asset",), "record": ("record",), "employee": ("settings", "employee")}[entity]
    if log is None or log.entity_id != entity_id or log.entity_type not in types:
        raise NotFoundException("History entry not found")
    if not _is_restorable(entity, log):
        raise ValidationException("This entry does not hold a full saved version, so it cannot be restored")
    return log


async def _plan(db: AsyncSession, entity: str, entity_id: int, log: AuditLog) -> tuple[list[dict], dict[str, Any]]:
    """Which fields would change (current -> saved version), and the update payload."""
    changes: list[dict] = []
    payload: dict[str, Any] = {}
    if entity == "asset":
        from app.services.asset import _snapshot, get_asset
        current = _snapshot(await get_asset(db, entity_id))
        target = log.new_values
        for k in ASSET_RESTORE:
            if k in target and _plain(current.get(k)) != target[k] and not (_empty(current.get(k)) and _empty(target[k])):
                payload[k] = target[k]
                if k == "specs":
                    changes += _changes({"specs": current.get(k)}, {"specs": target[k]}, ASSET_LABELS)
                else:
                    changes.append({"field": k, "label": ASSET_LABELS[k], "before": _plain(current.get(k)), "after": target[k]})
    elif entity == "record":
        from app.services.record import _load_type, get_record
        detail = await get_record(db, entity_id)
        record_type = await _load_type(db, detail["record_type_id"])
        current = record_snapshot(detail, record_type.fields)
        target = log.new_values["_snapshot"]
        allowed = {str(f.id): f for f in record_type.fields if _restorable_field(f)}
        for k in ("name", "status"):
            if target.get(k) and target[k] != current[k]:
                payload[k] = target[k]
                changes.append({"field": k, "label": k.capitalize(), "before": current[k], "after": target[k]})
        values = []
        for fid, value in (target.get("fields") or {}).items():
            if fid not in allowed:
                continue
            before = current["fields"].get(fid)
            if before == value or (_empty(before) and _empty(value)):
                continue
            values.append({"field_id": int(fid), "value": value})
            changes.append({"field": f"field:{fid}", "label": allowed[fid].name, "before": before, "after": value})
        if values:
            payload["values"] = values
    else:
        from app.models.employee import Employee
        emp = await db.get(Employee, entity_id)
        if emp is None:
            raise NotFoundException("Employee not found")
        current = employee_snapshot(emp)
        target = log.new_values
        for k in EMPLOYEE_RESTORE:
            if k in target and current.get(k) != target[k] and not (_empty(current.get(k)) and _empty(target[k])):
                if k == "name" and _empty(target[k]):
                    continue
                payload[k] = target[k]
                changes.append({"field": k, "label": EMPLOYEE_LABELS[k], "before": current.get(k), "after": target[k]})
    return changes, payload


async def restore_preview(db: AsyncSession, entity: str, entity_id: int, audit_id: int) -> dict[str, Any]:
    log = await _entry(db, entity, entity_id, audit_id)
    changes, _ = await _plan(db, entity, entity_id, log)
    return {"audit_id": audit_id, "changes": changes}


async def restore_version(db: AsyncSession, entity: str, entity_id: int, audit_id: int, user_id: int) -> dict[str, Any]:
    from app.services.audit import seal
    log = await _entry(db, entity, entity_id, audit_id)
    changes, payload = await _plan(db, entity, entity_id, log)
    if not payload:
        raise ValidationException("Nothing to restore: the current values already match this version")
    marker = (await db.execute(select(func.coalesce(func.max(AuditLog.id), 0)))).scalar_one()
    if entity == "asset":
        from app.schemas.asset import AssetUpdate
        from app.services.asset import update_asset
        await update_asset(db, entity_id, AssetUpdate(**payload), user_id)
        action = "asset.update"
    elif entity == "record":
        from app.schemas.record import RecordUpdate
        from app.services.record import update_record
        await update_record(db, entity_id, RecordUpdate(**payload), user_id)
        action = "update"
    else:
        from app.schemas.employee import EmployeeUpdate
        from app.services.employee import update_employee
        fields = EmployeeUpdate.model_fields
        await update_employee(db, entity_id, EmployeeUpdate(**{k: v for k, v in payload.items() if k in fields}), user_id)
        action = "employee.update"
    written = (await db.execute(select(AuditLog).where(AuditLog.id > marker, AuditLog.entity_id == entity_id,
                                                       AuditLog.action == action, AuditLog.user_id == user_id)
                                .order_by(AuditLog.id.desc()).limit(1))).scalar_one_or_none()
    if written is not None:
        written.action = REVERT_ACTION[entity]
        written.details = f"Restored a previous version (history entry #{audit_id})"
        seal(written)
        await db.flush()
    return {"audit_id": audit_id, "restored_entry_id": written.id if written else None, "changes": changes}
