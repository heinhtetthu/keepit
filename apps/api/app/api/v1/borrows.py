from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.db.session import get_db
from app.schemas import asset as s
from app.services import asset as svc

router = APIRouter(prefix="/borrows", tags=["it-logs"])
DB = Depends(get_db, scope="function")


@router.get("")
async def list_borrows(status: str | None = Query(None, pattern="^((open|overdue|returned),?)+$"), q: str | None = None,
                       employee_id: int | None = None, employee_ids: str | None = None, asset_type: str | None = None,
                       borrowed_from: date | None = None, borrowed_to: date | None = None,
                       due_from: date | None = None, due_to: date | None = None,
                       returned_from: date | None = None, returned_to: date | None = None,
                       sort: str = "borrowed_date", order: str = Query("desc", pattern="^(asc|desc)$"), deleted: bool = False,
                       page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
                       db: AsyncSession = DB, user=Depends(require_permission("itlog.view"))):
    """Borrow log. status, employee_ids and asset_type take comma lists; asset_type "__none__" means not an asset."""
    return await svc.list_borrows(db, status=status, q=q, employee_id=employee_id, deleted=deleted, page=page, page_size=page_size,
                                  employee_ids=employee_ids, asset_type=asset_type, borrowed_from=borrowed_from, borrowed_to=borrowed_to,
                                  due_from=due_from, due_to=due_to, returned_from=returned_from, returned_to=returned_to,
                                  sort=sort, order=order)


@router.post("", response_model=s.BorrowResponse, status_code=201)
async def create_borrow(data: s.BorrowCreate, db: AsyncSession = DB, user=Depends(require_permission("itlog.manage"))):
    return svc.borrow_view(await svc.create_borrow(db, data, user.id))


@router.patch("/{borrow_id}", response_model=s.BorrowResponse)
async def update_borrow(borrow_id: int, data: s.BorrowUpdate, db: AsyncSession = DB, user=Depends(require_permission("itlog.manage"))):
    """Correct any detail of an entry (system admins and itlog.manage). Audited with old and new values."""
    return svc.borrow_view(await svc.update_borrow(db, borrow_id, data, user.id))


@router.post("/{borrow_id}/return", response_model=s.BorrowResponse)
async def return_borrow(borrow_id: int, data: s.ReturnRequest, db: AsyncSession = DB, user=Depends(require_permission("itlog.manage"))):
    return svc.borrow_view(await svc.return_borrow(db, borrow_id, data.returned_date, user.id,
                                                   condition=data.condition, notes=data.notes))


@router.delete("/{borrow_id}", status_code=204)
async def delete_borrow(borrow_id: int, db: AsyncSession = DB, user=Depends(require_permission("itlog.manage"))):
    await svc.delete_borrow(db, borrow_id, user.id)


@router.post("/{borrow_id}/restore", response_model=s.BorrowResponse)
async def restore_borrow(borrow_id: int, db: AsyncSession = DB, user=Depends(require_permission("itlog.manage"))):
    return svc.borrow_view(await svc.restore_borrow(db, borrow_id, user.id))
