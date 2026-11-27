"""Activity history per asset, record or employee, with "restore this version".

GET  /history/{entity}/{id}                              newest first, paginated, optional ?kind=
GET  /history/{entity}/{id}/revert/{audit_id}/preview    fields that a restore would change
POST /history/{entity}/{id}/revert/{audit_id}            restore the state saved right after that entry

See app/services/history.py for what is restorable.
"""
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, has_permission
from app.core.exceptions import ForbiddenException, NotFoundException
from app.db.session import get_db
from app.models.user import User
from app.services import access as access_service
from app.services import history as history_service

router = APIRouter(prefix="/history", tags=["history"])

Entity = Literal["asset", "record", "employee"]
# Employee history follows the employee 360 page, which record viewers can open too.
VIEW = {"asset": ("asset.view",), "record": ("record.view",), "employee": ("employee.view", "record.view")}
EDIT = {"asset": ("asset.edit",), "record": ("record.edit",), "employee": ("employee.manage",)}


class HistoryChange(BaseModel):
    field: str
    label: str
    before: Any = None
    after: Any = None


class HistoryLink(BaseModel):
    type: str
    id: int
    slug: str | None = None


class HistoryEntry(BaseModel):
    id: str
    audit_id: int | None = None
    kind: str
    action: str
    summary: str
    actor_id: int | None = None
    actor_name: str | None = None
    timestamp: datetime
    changes: list[HistoryChange] = []
    details: str | None = None
    restorable: bool = False
    subject: bool = False
    link: HistoryLink | None = None


class HistoryKind(BaseModel):
    key: str
    label: str
    count: int


class HistoryPage(BaseModel):
    items: list[HistoryEntry]
    total: int
    page: int
    page_size: int
    total_pages: int
    kinds: list[HistoryKind]
    can_restore: bool


class RestorePreview(BaseModel):
    audit_id: int
    changes: list[HistoryChange]


class RestoreResult(RestorePreview):
    restored_entry_id: int | None = None


def _has(user: User, permissions: tuple[str, ...]) -> bool:
    return any(has_permission(user, p) for p in permissions)


def _require(user: User, permissions: tuple[str, ...]) -> None:
    if not _has(user, permissions):
        raise ForbiddenException(f"Missing permission: {' or '.join(permissions)}")


async def _check(db: AsyncSession, user: User, entity: str, entity_id: int, write: bool) -> int | None:
    """Permission + existence (+ record-type access). Returns the record type id for records."""
    _require(user, EDIT[entity] if write else VIEW[entity])
    if entity == "asset":
        from app.models.asset import Asset
        if (await db.execute(select(Asset.id).where(Asset.id == entity_id))).scalar_one_or_none() is None:
            raise NotFoundException("Asset not found")
        return None
    if entity == "employee":
        from app.models.employee import Employee
        if (await db.execute(select(Employee.id).where(Employee.id == entity_id))).scalar_one_or_none() is None:
            raise NotFoundException("Employee not found")
        return None
    from app.models.record import Record
    # Under RLS a hidden record simply is not found; the explicit type check covers non-RLS deployments.
    type_id = (await db.execute(select(Record.record_type_id).where(Record.id == entity_id))).scalar_one_or_none()
    if type_id is None:
        raise NotFoundException("Record not found")
    await access_service.ensure_type_access(db, user, type_id, write=write)
    return type_id


async def _can_restore(db: AsyncSession, user: User, entity: str, type_id: int | None) -> bool:
    if not _has(user, EDIT[entity]):
        return False
    if entity == "record" and type_id is not None:
        return access_service.type_is_allowed(await access_service.editable_type_ids(db, user), type_id)
    return True


@router.get("/{entity}/{entity_id}", response_model=HistoryPage)
async def entity_history(entity: Entity, entity_id: int, kind: str | None = Query(None, max_length=30),
                         page: int = Query(1, ge=1, le=100_000), page_size: int = Query(20, ge=1, le=100),
                         db: AsyncSession = Depends(get_db, scope="function"), user: User = Depends(get_current_user)):
    type_id = await _check(db, user, entity, entity_id, write=False)
    extra: dict[str, Any] = {}
    if entity == "employee":
        extra["employee_assets"] = has_permission(user, "asset.view")
        extra["employee_records"] = (await access_service.allowed_type_ids(db, user)
                                     if has_permission(user, "record.view") else False)
    data = await history_service.entity_history(db, entity, entity_id, kind=kind, page=page, page_size=page_size,
                                                record_type_id=type_id, **extra)
    data["can_restore"] = await _can_restore(db, user, entity, type_id)
    return data


@router.get("/{entity}/{entity_id}/revert/{audit_id}/preview", response_model=RestorePreview)
async def restore_preview(entity: Entity, entity_id: int, audit_id: int,
                          db: AsyncSession = Depends(get_db, scope="function"), user: User = Depends(get_current_user)):
    await _check(db, user, entity, entity_id, write=True)
    return await history_service.restore_preview(db, entity, entity_id, audit_id)


@router.post("/{entity}/{entity_id}/revert/{audit_id}", response_model=RestoreResult)
async def restore_version(entity: Entity, entity_id: int, audit_id: int,
                          db: AsyncSession = Depends(get_db, scope="function"), user: User = Depends(get_current_user)):
    await _check(db, user, entity, entity_id, write=True)
    return await history_service.restore_version(db, entity, entity_id, audit_id, user.id)
