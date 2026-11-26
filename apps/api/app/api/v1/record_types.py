from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.db.session import get_db
from app.models.record_type import RecordField
from app.schemas.record_type import RecordTypeCreate, RecordTypeUpdate, RecordTypeResponse, RecordTypeSummary, RecordFieldCreate, RecordFieldUpdate, RecordFieldResponse, FieldReorderRequest, FieldOptionCreate, FieldOptionResponse
from app.services import record_type as rt_service
from app.services import access as access_service

router = APIRouter(prefix="/record-types", tags=["record-types"])


async def _ensure_field_access(db: AsyncSession, user, field_id: int) -> None:
    field_type_id = (await db.execute(
        select(RecordField.record_type_id).where(RecordField.id == field_id)
    )).scalar_one_or_none()
    if field_type_id is not None:
        await access_service.ensure_type_access(db, user, field_type_id, write=True)


@router.get("", response_model=list[RecordTypeSummary])
async def list_record_types(include_inactive: bool = False, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record_type.view"))):
    allowed = await access_service.allowed_type_ids(db, user)
    if allowed is not None and not allowed:
        return []
    types = await rt_service.get_record_types(db, include_inactive)
    return [t for t in types if allowed is None or t.id in allowed]


@router.post("", response_model=RecordTypeResponse, status_code=201)
async def create_record_type(data: RecordTypeCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record_type.create"))):
    return await rt_service.create_record_type(db, data, user.id)


@router.get("/{type_id}", response_model=RecordTypeResponse)
async def get_record_type(type_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record_type.view"))):
    await access_service.ensure_type_access(db, user, type_id)
    return await rt_service.get_record_type(db, type_id)


@router.put("/{type_id}", response_model=RecordTypeResponse)
async def update_record_type(type_id: int, data: RecordTypeUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record_type.edit"))):
    await access_service.ensure_type_access(db, user, type_id, write=True)
    return await rt_service.update_record_type(db, type_id, data)


@router.delete("/{type_id}", status_code=204)
async def delete_record_type(type_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record_type.delete"))):
    await access_service.ensure_type_access(db, user, type_id, write=True)
    await rt_service.delete_record_type(db, type_id, user.id)


@router.put("/{type_id}/fields/reorder", status_code=204)
async def reorder_fields(type_id: int, data: FieldReorderRequest, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("field.edit"))):
    await access_service.ensure_type_access(db, user, type_id, write=True)
    await rt_service.reorder_fields(db, type_id, data.field_ids)


@router.post("/{type_id}/fields", response_model=RecordFieldResponse, status_code=201)
async def add_field(type_id: int, data: RecordFieldCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("field.create"))):
    await access_service.ensure_type_access(db, user, type_id, write=True)
    return await rt_service.add_field(db, type_id, data)


@router.put("/fields/{field_id}", response_model=RecordFieldResponse)
async def update_field(field_id: int, data: RecordFieldUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("field.edit"))):
    await _ensure_field_access(db, user, field_id)
    return await rt_service.update_field(db, field_id, data)


@router.delete("/fields/{field_id}", status_code=204)
async def delete_field(field_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("field.delete"))):
    await _ensure_field_access(db, user, field_id)
    await rt_service.delete_field(db, field_id)


@router.post("/fields/{field_id}/options", response_model=FieldOptionResponse, status_code=201)
async def add_option(field_id: int, data: FieldOptionCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("field.edit"))):
    """Add a dropdown option to a select/multi-select field."""
    await _ensure_field_access(db, user, field_id)
    return await rt_service.add_option(db, field_id, data.value, data.label)


@router.delete("/fields/{field_id}/options/{option_id}", status_code=204)
async def delete_option(field_id: int, option_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("field.edit"))):
    """Remove a dropdown option from a select/multi-select field."""
    await _ensure_field_access(db, user, field_id)
    await rt_service.delete_option(db, field_id, option_id)
