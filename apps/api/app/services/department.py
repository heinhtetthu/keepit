from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictException, NotFoundException
from app.models.department import Department
from app.models.employee import Employee
from app.schemas.department import DepartmentCreate, DepartmentUpdate
from app.services.audit import log_audit


def _serialize(d: Department, count: int = 0) -> dict[str, Any]:
    return {
        "id": d.id,
        "name": d.name,
        "employee_count": count,
        "created_at": d.created_at,
        "updated_at": d.updated_at,
    }


async def _by_name(db: AsyncSession, name: str, exclude_id: int | None = None):
    q = select(Department).where(func.lower(Department.name) == name.strip().lower())
    if exclude_id is not None:
        q = q.where(Department.id != exclude_id)
    return (await db.execute(q)).scalar_one_or_none()


async def _count(db: AsyncSession, name: str) -> int:
    return (await db.execute(select(func.count()).select_from(Employee).where(Employee.department == name))).scalar_one()


async def _get(db: AsyncSession, dept_id: int) -> Department:
    dept = await db.get(Department, dept_id)
    if dept is None:
        raise NotFoundException("Department not found")
    return dept


async def list_departments(db: AsyncSession) -> list[dict[str, Any]]:
    rows = (await db.execute(select(Department).order_by(Department.name))).scalars().all()
    counts = dict((await db.execute(
        select(Employee.department, func.count()).where(Employee.department.is_not(None)).group_by(Employee.department)
    )).all())
    return [_serialize(d, counts.get(d.name, 0)) for d in rows]


async def create_department(db: AsyncSession, data: DepartmentCreate, user_id: int) -> dict[str, Any]:
    name = data.name.strip()
    if not name:
        raise ConflictException("Department name is required")
    if await _by_name(db, name):
        raise ConflictException(f"Department '{name}' already exists")
    dept = Department(name=name)
    db.add(dept)
    await db.flush()
    await db.refresh(dept)
    await log_audit(db, "department.create", "settings", dept.id, dept.name,
                    user_id=user_id, details=f"Added department {dept.name}")
    return _serialize(dept, await _count(db, dept.name))


async def update_department(db: AsyncSession, dept_id: int, data: DepartmentUpdate, user_id: int) -> dict[str, Any]:
    dept = await _get(db, dept_id)
    new_name = (data.name or "").strip()
    if new_name and new_name != dept.name:
        if await _by_name(db, new_name, exclude_id=dept_id):
            raise ConflictException(f"Department '{new_name}' already exists")
        old_name = dept.name
        dept.name = new_name
        # Employees keep the department name as a snapshot: follow the rename.
        await db.execute(update(Employee).where(Employee.department == old_name).values(department=new_name))
        await db.flush()
        await log_audit(db, "department.update", "settings", dept.id, dept.name, user_id=user_id,
                        details=f"Renamed department {old_name} to {new_name}")
    await db.refresh(dept)
    return _serialize(dept, await _count(db, dept.name))


async def delete_department(db: AsyncSession, dept_id: int, user_id: int) -> None:
    dept = await _get(db, dept_id)
    name = dept.name
    await db.delete(dept)
    await db.flush()
    await log_audit(db, "department.delete", "settings", dept_id, name,
                    user_id=user_id, details=f"Deleted department {name}")
