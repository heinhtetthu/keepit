from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_permission
from app.core.exceptions import ConflictException, NotFoundException, ValidationException
from app.db.session import get_db
from app.models.reference import REFERENCE_KINDS, ReferenceItem
from app.services.audit import log_audit

router = APIRouter(prefix="/reference", tags=["reference"])
DB = Depends(get_db, scope="function")


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sort_order: int | None = None
    meta: dict | None = None  # vendor: contact_person, phone, email, categories


def _out(r: ReferenceItem) -> dict:
    return {"id": r.id, "kind": r.kind, "name": r.name, "sort_order": r.sort_order, "meta": r.meta}


def _kind(kind: str) -> str:
    if kind not in REFERENCE_KINDS:
        raise ValidationException(f"Unknown list. Use one of: {', '.join(REFERENCE_KINDS)}")
    return kind


@router.get("")
async def all_lists(db: AsyncSession = DB, user=Depends(get_current_user)):
    """Every lookup list in one round trip (forms load this once and cache it)."""
    rows = (await db.execute(select(ReferenceItem).order_by(ReferenceItem.kind, ReferenceItem.sort_order, ReferenceItem.name))).scalars().all()
    out: dict[str, list] = {k: [] for k in REFERENCE_KINDS}
    for r in rows:
        out.setdefault(r.kind, []).append(_out(r))
    return out


@router.post("/{kind}", status_code=201)
async def add_item(kind: str, data: ItemIn, db: AsyncSession = DB, user=Depends(require_permission("reference.manage"))):
    _kind(kind)
    name = data.name.strip()
    if (await db.execute(select(ReferenceItem.id).where(ReferenceItem.kind == kind, func.lower(ReferenceItem.name) == name.lower()))).first():
        raise ConflictException(f"'{name}' already exists")
    max_order = (await db.execute(select(func.coalesce(func.max(ReferenceItem.sort_order), -1)).where(ReferenceItem.kind == kind))).scalar_one()
    item = ReferenceItem(kind=kind, name=name, sort_order=data.sort_order if data.sort_order is not None else max_order + 1, meta=data.meta or {})
    db.add(item)
    await db.flush()
    await log_audit(db, "reference.create", "settings", item.id, f"{kind}: {name}", user_id=user.id)
    return _out(item)


@router.put("/{kind}/{item_id}")
async def update_item(kind: str, item_id: int, data: ItemIn, db: AsyncSession = DB, user=Depends(require_permission("reference.manage"))):
    item = await db.get(ReferenceItem, item_id)
    if item is None or item.kind != _kind(kind):
        raise NotFoundException("Item not found")
    old = item.name
    name = data.name.strip()
    if name.lower() != old.lower() and (await db.execute(select(ReferenceItem.id).where(
            ReferenceItem.kind == kind, func.lower(ReferenceItem.name) == name.lower()))).first():
        raise ConflictException(f"'{name}' already exists")
    item.name = name
    if data.sort_order is not None:
        item.sort_order = data.sort_order
    if data.meta is not None:
        item.meta = data.meta
    await log_audit(db, "reference.update", "settings", item.id, f"{kind}: {name}", old_values={"name": old}, user_id=user.id)
    return _out(item)


@router.delete("/{kind}/{item_id}", status_code=204)
async def delete_item(kind: str, item_id: int, db: AsyncSession = DB, user=Depends(require_permission("reference.manage"))):
    item = await db.get(ReferenceItem, item_id)
    if item is None or item.kind != _kind(kind):
        raise NotFoundException("Item not found")
    await db.delete(item)
    await log_audit(db, "reference.delete", "settings", item_id, f"{kind}: {item.name}", user_id=user.id)
