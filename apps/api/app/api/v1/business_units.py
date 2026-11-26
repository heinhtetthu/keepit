from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.db.session import get_db
from app.schemas.business_unit import BusinessUnitCreate, BusinessUnitUpdate, BusinessUnitResponse
from app.services import business_unit as bu_service

router = APIRouter(prefix="/business-units", tags=["business-units"])


@router.get("", response_model=list[BusinessUnitResponse])
async def list_business_units(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(require_permission("record.view")),
):
    """Business unit master list (active by default) - used by 'business_unit' fields."""
    return await bu_service.list_business_units(db, include_inactive)


@router.post("", response_model=BusinessUnitResponse, status_code=201)
async def create_business_unit(data: BusinessUnitCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    return await bu_service.create_business_unit(db, data, user.id)


@router.put("/{bu_id}", response_model=BusinessUnitResponse)
async def update_business_unit(bu_id: int, data: BusinessUnitUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    return await bu_service.update_business_unit(db, bu_id, data, user.id)


@router.delete("/{bu_id}", status_code=204)
async def delete_business_unit(bu_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    await bu_service.delete_business_unit(db, bu_id, user.id)
