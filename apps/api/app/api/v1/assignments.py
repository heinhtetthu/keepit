from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission, require_superuser
from app.db.session import get_db
from app.schemas.assignment import AssignmentCreate, AssignmentUpdate, AssignmentResponse, BulkAssignRequest, SwapRequest
from app.services import access as access_service
from app.services import assignment as assignment_service

router = APIRouter(prefix="/records", tags=["assignments"])


async def _ensure_access(db: AsyncSession, user, record_id: int, write: bool = False) -> None:
    type_id = (await assignment_service._get_record(db, record_id)).record_type_id
    await access_service.ensure_type_access(db, user, type_id, write=write)


@router.post("/bulk/assignments")
async def bulk_assign(data: BulkAssignRequest, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.edit"))):
    """Reassign, unassign or swap several seats in one go."""
    for item in data.items:
        await _ensure_access(db, user, item.record_id, write=True)
    return await assignment_service.bulk_assign(db, data, user.id)


@router.get("/{record_id}/assignments", response_model=list[AssignmentResponse])
async def list_assignments(record_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.view"))):
    await _ensure_access(db, user, record_id)
    return await assignment_service.list_assignments(db, record_id)


@router.post("/{record_id}/assignments", response_model=AssignmentResponse, status_code=201)
async def create_assignment(record_id: int, data: AssignmentCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.edit"))):
    """Reassign a seat to someone else, or release it with `unassign: true`."""
    await _ensure_access(db, user, record_id, write=True)
    return await assignment_service.create_assignment(db, record_id, data, user.id)


@router.post("/{record_id}/swap", response_model=list[AssignmentResponse], status_code=201)
async def swap_assignments(record_id: int, data: SwapRequest, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.edit"))):
    """Exchange the holders of two seats of the same type in one step."""
    await _ensure_access(db, user, record_id, write=True)
    await _ensure_access(db, user, data.other_record_id, write=True)
    return await assignment_service.swap_assignments(db, record_id, data, user.id)


@router.put("/{record_id}/assignments/{assignment_id}", response_model=AssignmentResponse)
async def update_assignment(record_id: int, assignment_id: int, data: AssignmentUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_superuser)):
    """System admin only: fix a mistaken ownership-history entry."""
    return await assignment_service.update_assignment(db, record_id, assignment_id, data, user.id)


@router.delete("/{record_id}/assignments/{assignment_id}", status_code=204)
async def delete_assignment(record_id: int, assignment_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_superuser)):
    """System admin only: remove an ownership-history entry."""
    await assignment_service.delete_assignment(db, record_id, assignment_id, user.id)
