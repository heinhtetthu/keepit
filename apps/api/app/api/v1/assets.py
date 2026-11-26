from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.db.session import get_db
from app.models.asset import AssetMaintenance, AssetRepair
from app.schemas import asset as s
from app.services import asset as svc

router = APIRouter(prefix="/assets", tags=["assets"])
DB = Depends(get_db, scope="function")


@router.get("", response_model=s.AssetListResponse)
async def list_assets(
    q: str | None = Query(None, max_length=200), asset_type: str | None = None,
    assignment_status: str | None = None, condition_status: str | None = None,
    employee_id: int | None = None, location: str | None = None, warranty_before: date | None = None,
    deleted: bool = False, sort: str = "created_at", order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
    db: AsyncSession = DB, user=Depends(require_permission("asset.view")),
):
    return await svc.list_assets(db, q=q, asset_type=asset_type, assignment_status=assignment_status,
                                 condition_status=condition_status, employee_id=employee_id, location=location,
                                 warranty_before=warranty_before, deleted=deleted, sort=sort, order=order,
                                 page=page, page_size=page_size)


@router.post("", response_model=s.AssetResponse, status_code=201)
async def create_asset(data: s.AssetCreate, db: AsyncSession = DB, user=Depends(require_permission("asset.create"))):
    return await svc.create_asset(db, data, user.id)


@router.post("/import")
async def import_assets(data: s.AssetImportRequest, db: AsyncSession = DB, user=Depends(require_permission("asset.create"))):
    return await svc.import_assets(db, data, user.id)


@router.post("/bulk-assign")
async def bulk_assign(data: s.BulkAssignRequest, db: AsyncSession = DB, user=Depends(require_permission("asset.edit"))):
    """Quick Assign / Reassignment: many holder changes in one transaction."""
    return await svc.bulk_assign(db, data, user.id)


@router.post("/bulk-update")
async def bulk_update(data: s.BulkUpdateRequest, db: AsyncSession = DB, user=Depends(require_permission("asset.edit"))):
    return await svc.bulk_update(db, data, user.id)


@router.post("/bulk-retire")
async def bulk_retire(data: s.BulkIdsRequest, db: AsyncSession = DB, user=Depends(require_permission("asset.edit"))):
    return await svc.bulk_retire(db, data.ids, user.id)


@router.post("/assignment-history/import")
async def import_assignment_history(items: list[s.AssignmentHistoryImportItem], db: AsyncSession = DB,
                                    user=Depends(require_permission("asset.edit"))):
    return await svc.import_assignment_history(db, items, user.id)


@router.post("/repairs/import")
async def import_repairs(items: list[s.RepairImportItem], db: AsyncSession = DB, user=Depends(require_permission("itlog.manage"))):
    return await svc.import_repairs(db, items, user.id)


@router.get("/repairs")
async def repair_log(q: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
                     db: AsyncSession = DB, user=Depends(require_permission("itlog.view"))):
    return await svc.list_log(db, AssetRepair, AssetRepair.repair_date, q=q, page=page, page_size=page_size)


@router.get("/maintenance")
async def maintenance_log(q: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
                          db: AsyncSession = DB, user=Depends(require_permission("itlog.view"))):
    return await svc.list_log(db, AssetMaintenance, AssetMaintenance.maintenance_date, q=q, page=page, page_size=page_size)


# ---- settings: templates + auto serials (static paths before /{asset_id})
@router.get("/templates")
async def list_templates(db: AsyncSession = DB, user=Depends(require_permission("asset.view"))):
    return [{"asset_type": t.asset_type, "attributes": t.attributes} for t in await svc.list_templates(db)]


@router.put("/templates/{asset_type}")
async def upsert_template(asset_type: str, data: s.TemplateUpsert, db: AsyncSession = DB,
                          user=Depends(require_permission("reference.manage"))):
    t = await svc.upsert_template(db, asset_type, data, user.id)
    return {"asset_type": t.asset_type, "attributes": t.attributes}


@router.delete("/templates/{asset_type}", status_code=204)
async def delete_template(asset_type: str, db: AsyncSession = DB, user=Depends(require_permission("reference.manage"))):
    await svc.delete_template(db, asset_type, user.id)


@router.get("/serial-settings", response_model=list[s.SerialSettingResponse])
async def list_serial_settings(db: AsyncSession = DB, user=Depends(require_permission("asset.view"))):
    return await svc.list_serial_settings(db)


@router.put("/serial-settings/{asset_type}", response_model=s.SerialSettingResponse)
async def upsert_serial_setting(asset_type: str, data: s.SerialSettingUpsert, db: AsyncSession = DB,
                                user=Depends(require_permission("reference.manage"))):
    return await svc.upsert_serial_setting(db, asset_type, data, user.id)


@router.post("/serial-settings/{asset_type}/generate")
async def generate_serial(asset_type: str, db: AsyncSession = DB, user=Depends(require_permission("asset.create"))):
    """Reserve (or re-return the pending) next product number for this type."""
    return {"serial": await svc.generate_serial(db, asset_type)}


# ---- single asset
@router.get("/{asset_id}", response_model=s.AssetDetailResponse)
async def get_asset(asset_id: int, db: AsyncSession = DB, user=Depends(require_permission("asset.view"))):
    return await svc.asset_detail(db, asset_id)


@router.patch("/{asset_id}", response_model=s.AssetResponse)
async def update_asset(asset_id: int, data: s.AssetUpdate, db: AsyncSession = DB, user=Depends(require_permission("asset.edit"))):
    return await svc.update_asset(db, asset_id, data, user.id)


@router.delete("/{asset_id}", status_code=204)
async def delete_asset(asset_id: int, db: AsyncSession = DB, user=Depends(require_permission("asset.delete"))):
    """Soft delete: the asset moves to Trash and can be restored."""
    await svc.soft_delete(db, asset_id, user.id)


@router.post("/{asset_id}/restore", response_model=s.AssetResponse)
async def restore_asset(asset_id: int, db: AsyncSession = DB, user=Depends(require_permission("asset.delete"))):
    return await svc.restore(db, asset_id, user.id)


@router.post("/{asset_id}/assign", response_model=s.AssetResponse)
async def assign_asset(asset_id: int, data: s.AssignRequest, db: AsyncSession = DB, user=Depends(require_permission("asset.edit"))):
    return await svc.assign_asset(db, asset_id, data, user.id)


@router.post("/{asset_id}/retire", response_model=s.AssetResponse)
async def retire_asset(asset_id: int, db: AsyncSession = DB, user=Depends(require_permission("asset.edit"))):
    return await svc.retire_asset(db, asset_id, user.id)


@router.delete("/{asset_id}/assignments/{assignment_id}", status_code=204)
async def delete_assignment(asset_id: int, assignment_id: int, db: AsyncSession = DB, user=Depends(require_permission("asset.edit"))):
    await svc.delete_assignment(db, asset_id, assignment_id, user.id)


@router.post("/{asset_id}/repairs", response_model=s.RepairResponse, status_code=201)
async def add_repair(asset_id: int, data: s.RepairCreate, db: AsyncSession = DB, user=Depends(require_permission("itlog.manage"))):
    return await svc.add_repair(db, asset_id, data, user.id)


@router.patch("/{asset_id}/repairs/{repair_id}", response_model=s.RepairResponse)
async def update_repair(asset_id: int, repair_id: int, data: s.RepairUpdate, db: AsyncSession = DB,
                        user=Depends(require_permission("itlog.manage"))):
    return await svc.update_repair(db, asset_id, repair_id, data, user.id)


@router.delete("/{asset_id}/repairs/{repair_id}", status_code=204)
async def delete_repair(asset_id: int, repair_id: int, db: AsyncSession = DB, user=Depends(require_permission("itlog.manage"))):
    await svc.delete_repair(db, asset_id, repair_id, user.id)


@router.post("/{asset_id}/maintenance", response_model=s.MaintenanceResponse, status_code=201)
async def add_maintenance(asset_id: int, data: s.MaintenanceCreate, db: AsyncSession = DB,
                          user=Depends(require_permission("itlog.manage"))):
    return await svc.add_maintenance(db, asset_id, data, user.id)


@router.patch("/{asset_id}/maintenance/{log_id}", response_model=s.MaintenanceResponse)
async def update_maintenance(asset_id: int, log_id: int, data: s.MaintenanceUpdate, db: AsyncSession = DB,
                             user=Depends(require_permission("itlog.manage"))):
    return await svc.update_maintenance(db, asset_id, log_id, data, user.id)


@router.delete("/{asset_id}/maintenance/{log_id}", status_code=204)
async def delete_maintenance(asset_id: int, log_id: int, db: AsyncSession = DB, user=Depends(require_permission("itlog.manage"))):
    await svc.delete_maintenance(db, asset_id, log_id, user.id)
