from fastapi import APIRouter, Depends, Query, Response
from app.api.v1.security import Verify, checked_user
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission, require_superuser
from app.core.exceptions import ForbiddenException
from app.db.session import get_db
from app.models.record import Record
from app.core.config import get_settings
from app.services.audit import log_audit
from datetime import timedelta
from app.schemas.common import PaginatedResponse
from app.schemas.record import RecordCreate, RecordUpdate, RecordResponse, RecordListResponse, RecordRenewalOptionsUpdate, BulkArchiveRequest, BulkStatusRequest, BulkDeleteRequest
from app.schemas.renewal import AutoRenewalLogEntry, RenewalCreate, RenewalUpdate, RenewalResponse
from app.services import record as record_service
from app.services import access as access_service

router = APIRouter(prefix="/records", tags=["records"])


@router.get("/auto-renewals", response_model=PaginatedResponse[AutoRenewalLogEntry])
async def automatic_renewals(
    page: int = Query(1, ge=1, le=1_000_000),
    page_size: int = Query(25, ge=1, le=100),
    search: str = Query("", max_length=200),
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(require_permission("record.view")),
):
    allowed = await access_service.allowed_type_ids(db, user)
    items, total = await record_service.list_automatic_renewals(db, allowed, page, page_size, search.strip())
    return {"items": items, "total": total, "page": page, "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size}


@router.post('/{record_id}/purge', status_code=204)
async def purge_record(record_id: int, data: Verify, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_superuser)):
    from datetime import datetime, timezone
    from app.core.exceptions import ValidationException, NotFoundException
    from app.services.mfa import verify
    from app.services.operations import backup_status
    user = await checked_user(db, user, data.password)
    if user.mfa_secret: verify(user, data.code)
    record = (await db.execute(select(Record).where(Record.id == record_id).with_for_update())).scalar_one_or_none()
    if not record: raise NotFoundException('Record not found')
    now = datetime.now(timezone.utc)
    if record.archived or not record.deleted_at or record.deleted_at + timedelta(days=get_settings().DELETED_RECORD_RETENTION_DAYS) > now:
        raise ValidationException('Only trashed records past the minimum recovery window can be permanently deleted')
    try:
        verified = datetime.fromisoformat(backup_status().get('last_restore_verified'))
        if now - verified > timedelta(days=2): raise ValueError()
    except (ValueError, TypeError):
        raise ValidationException('A restore-verified encrypted backup from the last two days is required before permanent deletion')
    await log_audit(db, 'record.purge', 'record', record.id, record.name, user_id=user.id)
    await db.delete(record)


@router.get('/trash')
async def trash(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission('record.view'))):
    from sqlalchemy import func
    from app.models.record_type import RecordType
    allowed = await access_service.allowed_type_ids(db, user)
    conditions = [Record.deleted_at.is_not(None), Record.archived == False]
    if allowed is not None: conditions.append(Record.record_type_id.in_(allowed))
    count = (await db.execute(select(func.count(Record.id)).where(*conditions))).scalar() or 0
    rows = (await db.execute(select(Record, RecordType.name.label('type_name')).join(RecordType).where(*conditions)
                            .order_by(Record.deleted_at.desc()).offset((page - 1) * page_size).limit(page_size))).all()
    days = get_settings().DELETED_RECORD_RETENTION_DAYS
    return {'items': [{'id': r.id, 'name': r.name, 'type': name, 'deleted_at': r.deleted_at,
                       'record_type_id': r.record_type_id, 'purge_eligible_at': r.deleted_at + timedelta(days=days)} for r, name in rows],
            'total': count, 'page': page, 'page_size': page_size, 'retention_days': days,
            'policy': 'Records stay recoverable until an administrator explicitly purges them after the retention window. No automatic purge.'}


@router.post('/{record_id}/fields/{field_id}/reveal')
async def reveal_secret(record_id: int, field_id: int, data: Verify,
                        response: Response, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_superuser)):
    from app.services.mfa import verify
    from app.services.sensitive import unpack
    from app.models.record import RecordValue
    from app.models.record_type import RecordField
    from app.core.exceptions import NotFoundException
    user = await checked_user(db, user, data.password)
    if user.mfa_secret:
        verify(user, data.code)
    record = await db.get(Record, record_id)
    field = await db.get(RecordField, field_id)
    if not record or record.deleted_at or not field or field.record_type_id != record.record_type_id or field.field_type != 'secret':
        raise NotFoundException('Protected field not found')
    value = (await db.execute(select(RecordValue).where(RecordValue.record_id == record_id, RecordValue.field_id == field_id))).scalar_one_or_none()
    await log_audit(db, 'field.reveal', 'record', record_id, user_id=user.id, details=f'Protected field {field_id} revealed')
    response.headers['Cache-Control'] = 'no-store'
    return {'value': unpack(value.value) if value else None}


async def _ensure_record_access(db: AsyncSession, user, record_id: int, write: bool = False) -> int:
    """Check the caller may see (or, with write, change) this record; returns its type id."""
    record_type_id = (await db.execute(
        select(Record.record_type_id).where(Record.id == record_id)
    )).scalar_one_or_none()
    if record_type_id is not None:
        await access_service.ensure_type_access(db, user, record_type_id, write=write)
    return record_type_id


async def _ensure_records_access(db: AsyncSession, user, record_ids: list[int], write: bool = True) -> None:
    """Check the caller may change every listed record (bulk operations need Edit grants)."""
    allowed = await (access_service.editable_type_ids(db, user) if write else access_service.allowed_type_ids(db, user))
    if allowed is None or not record_ids:
        return
    type_ids = set((await db.execute(
        select(Record.record_type_id).where(Record.id.in_(record_ids))
    )).scalars().all())
    if any(tid not in allowed for tid in type_ids):
        raise ForbiddenException("You do not have edit access to one or more of these records")


@router.get("/by-type/{record_type_id}", response_model=PaginatedResponse[RecordListResponse])
async def list_records(
    record_type_id: int,
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    search: str | None = Query(None, max_length=200), status: str | None = Query(None, max_length=50),
    filters: str | None = Query(None, max_length=8000),
    sort: str | None = Query(None, max_length=255), order: str = Query("asc", pattern="^(asc|desc)$"),
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.view")),
):
    await access_service.ensure_type_access(db, user, record_type_id)
    parsed_filters = None
    if filters:
        try:
            parsed_filters = json.loads(filters)
            if not isinstance(parsed_filters, dict):
                parsed_filters = None
        except ValueError:
            parsed_filters = None
    items, total, _ = await record_service.get_records(db, record_type_id, page, page_size, search, status, parsed_filters, sort, order, include_archived)
    return PaginatedResponse(items=items, page=page, page_size=page_size, total=total, total_pages=(total + page_size - 1) // page_size)


@router.get("/by-type/{record_type_id}/summary")
async def type_summary(record_type_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.view"))):
    """Counts for the quick tabs: total, expiring in 30 days, expired, unassigned, auto-renew off."""
    await access_service.ensure_type_access(db, user, record_type_id)
    return await record_service.type_summary(db, record_type_id)


@router.post("/by-type/{record_type_id}", response_model=RecordResponse, status_code=201)
async def create_record(record_type_id: int, data: RecordCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.create"))):
    await access_service.ensure_type_access(db, user, record_type_id, write=True)
    return await record_service.create_record(db, record_type_id, data, user.id)


@router.get("/{record_id}", response_model=RecordResponse)
async def get_record(record_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.view"))):
    await _ensure_record_access(db, user, record_id)
    return await record_service.get_record(db, record_id)


@router.put("/{record_id}", response_model=RecordResponse)
async def update_record(record_id: int, data: RecordUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.edit"))):
    await _ensure_record_access(db, user, record_id, write=True)
    return await record_service.update_record(db, record_id, data, user.id)


@router.post("/{record_id}/archive", response_model=RecordResponse)
async def archive_record(record_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.delete"))):
    await _ensure_record_access(db, user, record_id, write=True)
    return await record_service.archive_record(db, record_id, user.id)


@router.post("/{record_id}/restore", response_model=RecordResponse)
async def restore_record(record_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.delete"))):
    await _ensure_record_access(db, user, record_id, write=True)
    return await record_service.restore_record(db, record_id, user.id)


@router.post("/{record_id}/duplicate", response_model=RecordResponse, status_code=201)
async def duplicate_record(record_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.create"))):
    await _ensure_record_access(db, user, record_id, write=True)
    return await record_service.duplicate_record(db, record_id, user.id)


@router.post("/{record_id}/renew", response_model=RecordResponse)
async def renew_record(record_id: int, data: RenewalCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.edit"))):
    await _ensure_record_access(db, user, record_id, write=True)
    result = await record_service.renew_record(db, record_id, data, user.id)
    return result["record"]


@router.put("/{record_id}/renewal-options", response_model=RecordResponse)
async def put_renewal_options(record_id: int, data: RecordRenewalOptionsUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.edit"))):
    """Per-record renewal timing: renew N days before the expiry date."""
    await _ensure_record_access(db, user, record_id, write=True)
    return await record_service.set_renewal_options(db, record_id, data, user.id)


@router.get("/{record_id}/renewals", response_model=list[RenewalResponse])
async def list_record_renewals(record_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.view"))):
    await _ensure_record_access(db, user, record_id)
    return await record_service.get_record_renewals(db, record_id)


@router.put("/{record_id}/renewals/{renewal_id}", response_model=RenewalResponse)
async def edit_record_renewal(record_id: int, renewal_id: int, data: RenewalUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_superuser)):
    """System admin only: fix or remove a mistaken renewal-history entry."""
    return await record_service.update_record_renewal(db, record_id, renewal_id, data, user.id)


@router.delete("/{record_id}/renewals/{renewal_id}", status_code=204)
async def delete_record_renewal(record_id: int, renewal_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_superuser)):
    """System admin only: remove a renewal-history entry (rolls the record's expiry back if it was the latest)."""
    await record_service.delete_record_renewal(db, record_id, renewal_id, user.id)


@router.delete("/{record_id}", status_code=204)
async def delete_record(record_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.delete"))):
    await _ensure_record_access(db, user, record_id, write=True)
    await record_service.delete_record(db, record_id, user.id)


@router.post("/bulk/archive")
async def bulk_archive(data: BulkArchiveRequest, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.delete"))):
    await _ensure_records_access(db, user, data.ids)
    count = await record_service.bulk_archive(db, data.ids, user.id)
    return {"archived": count}


@router.post("/bulk/status")
async def bulk_status(data: BulkStatusRequest, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.edit"))):
    await _ensure_records_access(db, user, data.ids)
    count = await record_service.bulk_update_status(db, data.ids, data.status, user.id)
    return {"updated": count}


@router.post("/bulk/delete")
async def bulk_delete(data: BulkDeleteRequest, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.delete"))):
    await _ensure_records_access(db, user, data.ids)
    count = await record_service.bulk_delete(db, data.ids, user.id)
    return {"deleted": count}
