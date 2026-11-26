import json
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.exceptions import NotFoundException
from app.db.session import get_db
from app.models.record_type import RecordField, RecordType
from app.models.user import User
from app.services import import_records
from app.services import access as access_service

router = APIRouter(prefix="/record-types", tags=["import"])

async def _load_type(db: AsyncSession, type_id: int) -> RecordType:
    result = await db.execute(
        select(RecordType).where(RecordType.id == type_id)
        .options(selectinload(RecordType.fields).selectinload(RecordField.options))
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise NotFoundException("Record type not found")
    return rt


def _parse_mapping(mapping: str | None) -> dict[str, str] | None:
    if not mapping:
        return None
    try:
        data = json.loads(mapping)
        if isinstance(data, dict):
            return {str(k): v for k, v in data.items()}
    except ValueError:
        pass
    return None


@router.get("/{type_id}/import/template")
async def download_import_template(
    type_id: int,
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(require_permission("record.view")),
):
    await access_service.ensure_type_access(db, user, type_id)
    record_type = await _load_type(db, type_id)
    content = await import_records.import_template(db, record_type)
    filename = f"{record_type.slug}-import-template.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{type_id}/import/preview")
async def preview_import(
    type_id: int,
    file: UploadFile = File(...),
    mapping: str | None = Form(None),
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(require_permission("record.view")),
):
    await access_service.ensure_type_access(db, user, type_id)
    record_type = await _load_type(db, type_id)
    return await import_records.preview_import(db, record_type, file, _parse_mapping(mapping))


@router.post("/{type_id}/import/commit")
async def commit_import(
    type_id: int,
    file: UploadFile = File(...),
    mapping: str | None = Form(None),
    on_name_conflict: str = Form("skip"),
    db: AsyncSession = Depends(get_db, scope="function"),
    user: User = Depends(require_permission("record.create")),
):
    await access_service.ensure_type_access(db, user, type_id, write=True)
    record_type = await _load_type(db, type_id)
    return await import_records.commit_import(
        db, record_type, file, _parse_mapping(mapping), user.id, on_name_conflict
    )
