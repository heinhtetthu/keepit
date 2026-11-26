from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_permission
from app.core.exceptions import NotFoundException
from app.db.session import get_db
from app.models.settings import SavedView
from app.models.user import User
from app.schemas.saved_view import SavedViewCreate, SavedViewUpdate, SavedViewResponse
from app.services import access as access_service

router = APIRouter(prefix="/views", tags=["saved-views"])


@router.get("", response_model=list[SavedViewResponse])
async def list_views(
    record_type_id: int | None = None,
    db: AsyncSession = Depends(get_db, scope="function"),
    user: User = Depends(get_current_user),
):
    query = select(SavedView).where(SavedView.user_id == user.id)
    allowed = await access_service.allowed_type_ids(db, user)
    if record_type_id is not None:
        await access_service.ensure_type_access(db, user, record_type_id)
        query = query.where(SavedView.record_type_id == record_type_id)
    elif allowed is not None:
        query = query.where(
            SavedView.record_type_id.in_(allowed) if allowed else SavedView.id == -1
        )
    result = await db.execute(query.order_by(SavedView.created_at))
    return result.scalars().all()


@router.post("", response_model=SavedViewResponse, status_code=201)
async def create_view(
    data: SavedViewCreate,
    db: AsyncSession = Depends(get_db, scope="function"),
    user: User = Depends(require_permission("record.view")),
):
    await access_service.ensure_type_access(db, user, data.record_type_id)
    view = SavedView(user_id=user.id, **data.model_dump())
    db.add(view)
    await db.flush()
    await db.refresh(view)
    return view


@router.put("/{view_id}", response_model=SavedViewResponse)
async def update_view(
    view_id: int,
    data: SavedViewUpdate,
    db: AsyncSession = Depends(get_db, scope="function"),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(SavedView).where(SavedView.id == view_id, SavedView.user_id == user.id))
    view = result.scalar_one_or_none()
    if not view:
        raise NotFoundException("Saved view not found")
    updates = data.model_dump(exclude_unset=True, exclude_none=False)
    if updates.get("record_type_id") is not None:
        await access_service.ensure_type_access(db, user, updates["record_type_id"])
    for k, v in updates.items():
        setattr(view, k, v)
    await db.flush()
    await db.refresh(view)
    return view


@router.delete("/{view_id}", status_code=204)
async def delete_view(
    view_id: int,
    db: AsyncSession = Depends(get_db, scope="function"),
    user: User = Depends(get_current_user),
):
    result = await db.execute(select(SavedView).where(SavedView.id == view_id, SavedView.user_id == user.id))
    view = result.scalar_one_or_none()
    if not view:
        raise NotFoundException("Saved view not found")
    await db.delete(view)
