from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictException, NotFoundException
from app.models.business_unit import BusinessUnit
from app.schemas.business_unit import BusinessUnitCreate, BusinessUnitUpdate
from app.services.audit import log_audit


def _serialize(bu: BusinessUnit) -> dict[str, Any]:
    return {
        "id": bu.id,
        "name": bu.name,
        "active": bu.active,
        "created_at": bu.created_at,
        "updated_at": bu.updated_at,
    }


async def _by_name(db: AsyncSession, name: str, exclude_id: int | None = None):
    from sqlalchemy import func
    q = select(BusinessUnit).where(func.lower(BusinessUnit.name) == name.strip().lower())
    if exclude_id is not None:
        q = q.where(BusinessUnit.id != exclude_id)
    return (await db.execute(q)).scalar_one_or_none()


async def list_business_units(db: AsyncSession, include_inactive: bool = False) -> list[dict[str, Any]]:
    q = select(BusinessUnit).order_by(BusinessUnit.name)
    if not include_inactive:
        q = q.where(BusinessUnit.active == True)  # noqa: E712
    rows = (await db.execute(q)).scalars().all()
    return [_serialize(bu) for bu in rows]


async def create_business_unit(db: AsyncSession, data: BusinessUnitCreate, user_id: int) -> dict[str, Any]:
    if await _by_name(db, data.name):
        raise ConflictException(f"Business unit '{data.name}' already exists")
    bu = BusinessUnit(name=data.name.strip(), active=data.active)
    db.add(bu)
    await db.flush()
    await db.refresh(bu)
    await log_audit(db, "business_unit.create", "settings", bu.id, bu.name,
                    user_id=user_id, details=f"Added business unit {bu.name}")
    return _serialize(bu)


async def update_business_unit(db: AsyncSession, bu_id: int, data: BusinessUnitUpdate, user_id: int) -> dict[str, Any]:
    bu = (await db.execute(select(BusinessUnit).where(BusinessUnit.id == bu_id))).scalar_one_or_none()
    if not bu:
        raise NotFoundException("Business unit not found")
    updates = data.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"]:
        dupe = await _by_name(db, updates["name"], exclude_id=bu_id)
        if dupe:
            raise ConflictException(f"Business unit '{updates['name']}' already exists")
        updates["name"] = updates["name"].strip()
    for k, v in updates.items():
        setattr(bu, k, v)
    await db.flush()
    await db.refresh(bu)
    await log_audit(db, "business_unit.update", "settings", bu.id, bu.name,
                    user_id=user_id, details=f"Updated business unit {bu.name}")
    return _serialize(bu)


async def delete_business_unit(db: AsyncSession, bu_id: int, user_id: int) -> None:
    bu = (await db.execute(select(BusinessUnit).where(BusinessUnit.id == bu_id))).scalar_one_or_none()
    if not bu:
        raise NotFoundException("Business unit not found")
    name = bu.name
    await db.delete(bu)
    await db.flush()
    await log_audit(db, "business_unit.delete", "settings", bu_id, name,
                    user_id=user_id, details=f"Deleted business unit {name}")
