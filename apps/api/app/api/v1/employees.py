import json

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import has_permission, require_any_permission, require_permission
from app.db.session import get_db
from app.schemas.employee import EmployeeCreate, EmployeeUpdate, EmployeeResponse, EmployeeImportRequest, EmployeeImportResponse, EmployeeBulkUpdate, EmployeeBulkDelete, EmployeeBulkResponse
from app.core.exceptions import ForbiddenException, NotFoundException
from app.models.employee import Employee
from app.schemas.assignment import Holding, ReleaseRequest
from app.schemas.asset import OffboardRequest
from app.services import access as access_service
from app.services import assignment as assignment_service
from app.services import employee as employee_service

router = APIRouter(prefix="/employees", tags=["employees"])


@router.get("", response_model=list[EmployeeResponse])
async def list_employees(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(require_any_permission("record.view", "employee.view")),
):
    """Employee master list (active by default) - used for pickers on tracked record types."""
    return await employee_service.list_employees(db, include_inactive)


@router.post("", response_model=EmployeeResponse, status_code=201)
async def create_employee(data: EmployeeCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    return await employee_service.create_employee(db, data, user.id)


@router.post("/import", response_model=EmployeeImportResponse)
async def import_employees(data: EmployeeImportRequest, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    """One-time bulk import; upserts by exact (case-insensitive) name."""
    return await employee_service.import_employees(db, data, user.id)


@router.post("/bulk", response_model=EmployeeBulkResponse)
async def bulk_update_employees(data: EmployeeBulkUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    """Bulk edit: set business units and/or active flag on many employees at once."""
    return await employee_service.bulk_update_employees(db, data, user.id)


@router.delete("/bulk", response_model=EmployeeBulkResponse)
async def bulk_delete_employees(data: EmployeeBulkDelete, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    """Bulk delete employees (history keeps name snapshots)."""
    return await employee_service.bulk_delete_employees(db, data, user.id)


@router.post("/import-file")
async def import_employees_file(
    file: UploadFile = File(...),
    preview: bool = Query(False, description="Parse + map only; do not save"),
    mapping: str | None = Form(None, description='Optional JSON: {"name": "Column", "email": "Column", ...}'),
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(require_permission("employee.manage")),
):
    """Import employees from a CSV or XLSX file.

    Columns are auto-matched (Name / Business Unit / Email / Title, case-insensitive
    with fuzzy fallback). Call with preview=true first to show the detection; pass a
    `mapping` form field (JSON of field -> column header) to override it.
    """
    if not file.filename:
        raise HTTPException(status_code=422, detail="No file provided")
    name = file.filename.lower()
    if not name.endswith((".csv", ".xlsx", ".xlsm")):
        raise HTTPException(status_code=422, detail="Only .csv and .xlsx files are supported")
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="File too large (max 5 MB)")
    mapping_dict: dict[str, str | None] | None = None
    if mapping:
        try:
            mapping_dict = json.loads(mapping)
        except ValueError:
            raise HTTPException(status_code=422, detail="mapping must be valid JSON")
    return await employee_service.import_employee_file(db, file.filename, content, user.id, preview=preview, mapping=mapping_dict)


@router.put("/{employee_id}", response_model=EmployeeResponse)
async def update_employee(employee_id: int, data: EmployeeUpdate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    return await employee_service.update_employee(db, employee_id, data, user.id)


@router.delete("/{employee_id}", status_code=204)
async def delete_employee(employee_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("employee.manage"))):
    await employee_service.delete_employee(db, employee_id, user.id)


@router.get("/{employee_id}/holdings", response_model=list[Holding])
async def employee_holdings(employee_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.view"))):
    """Seats (license records) this employee currently holds."""
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundException("Employee not found")
    allowed = await access_service.allowed_type_ids(db, user)
    return await assignment_service.holdings_for_employee(db, employee, allowed)


@router.post("/{employee_id}/release")
async def release_employee(employee_id: int, data: ReleaseRequest, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("record.edit"))):
    """Offboarding: unassign all of the employee's seats (they stay unassigned)."""
    if data.deactivate and not (user.is_superuser or "employee.manage" in user.permissions):
        raise ForbiddenException("You need permission to manage employees to deactivate them")
    allowed = await access_service.editable_type_ids(db, user)
    return await assignment_service.release_employee(db, employee_id, data, user.id, allowed)


@router.get("/{employee_id}")
async def employee_overview(employee_id: int, db: AsyncSession = Depends(get_db, scope="function"),
                            user=Depends(require_any_permission("record.view", "employee.view"))):
    """Employee 360: profile, held assets, asset history, borrows, license seats, documents."""
    from app.services import asset as asset_service
    from app.services import document as document_service
    employee = await employee_service.get_employee(db, employee_id)
    out: dict = {"employee": employee, "assets": [], "asset_history": [], "borrows": [], "seats": [], "documents": []}
    if has_permission(user, "asset.view"):
        summary = await asset_service.employee_asset_summary(db, employee_id)
        out.update(assets=summary["assets"], asset_history=summary["history"], borrows=summary["borrows"])
    if has_permission(user, "record.view"):
        allowed = await access_service.allowed_type_ids(db, user)
        out["seats"] = await assignment_service.holdings_for_employee(db, await db.get(Employee, employee_id), allowed)
    if has_permission(user, "document.view"):
        out["documents"] = await document_service.documents_for_entity(db, "employee", employee_id)
    return out


@router.post("/{employee_id}/offboard")
async def offboard_employee(employee_id: int, data: OffboardRequest, db: AsyncSession = Depends(get_db, scope="function"),
                            user=Depends(require_any_permission("employee.manage", "asset.edit", "record.edit"))):
    """One offboarding flow: return held assets, close open borrows, release
    license seats, then deactivate (with a resignation date)."""
    from app.schemas.assignment import ReleaseRequest
    from app.services import asset as asset_service
    employee = await db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundException("Employee not found")
    if (data.return_assets or data.close_borrows) and not has_permission(user, "asset.edit"):
        raise ForbiddenException("You need permission to edit assets to return them")
    if data.release_seats and not has_permission(user, "record.edit"):
        raise ForbiddenException("You need permission to edit records to release seats")
    if data.deactivate and not has_permission(user, "employee.manage"):
        raise ForbiddenException("You need permission to manage employees to deactivate them")
    result = await asset_service.offboard_assets(db, employee, data.effective_date, data.return_assets, data.close_borrows, user.id)
    result["seats_released"] = 0
    if data.release_seats:
        allowed = await access_service.editable_type_ids(db, user)
        released = await assignment_service.release_employee(
            db, employee_id, ReleaseRequest(effective_date=data.effective_date.isoformat(), reason=data.reason, deactivate=False),
            user.id, allowed)
        result["seats_released"] = released["released"]
    if data.deactivate:
        employee.active = False
        employee.resignation_date = employee.resignation_date or data.effective_date
    from app.services.audit import log_audit
    await log_audit(db, "employee.offboard", "employee", employee.id, employee.name, user_id=user.id,
                    new_values={**result, "deactivated": data.deactivate, "effective_date": data.effective_date.isoformat()})
    return {**result, "deactivated": data.deactivate}
