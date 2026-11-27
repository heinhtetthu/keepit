from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_any_permission, require_permission
from app.db.session import get_db
from app.schemas.department import DepartmentCreate, DepartmentResponse, DepartmentUpdate
from app.services import department as department_service

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", response_model=list[DepartmentResponse])
async def list_departments(
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(require_any_permission("record.view", "employee.view")),
):
    """Department master list, used by the employee form and filters."""
    return await department_service.list_departments(db)


@router.post("", response_model=DepartmentResponse, status_code=201)
async def create_department(data: DepartmentCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    return await department_service.create_department(db, data, user.id)


@router.put("/{dept_id}", response_model=DepartmentResponse)
async def update_department(dept_id: int, data: DepartmentUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    """Rename a department; employees holding the old name follow the rename."""
    return await department_service.update_department(db, dept_id, data, user.id)


@router.delete("/{dept_id}", status_code=204)
async def delete_department(dept_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    await department_service.delete_department(db, dept_id, user.id)
