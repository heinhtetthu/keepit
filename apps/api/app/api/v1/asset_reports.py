import json
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, has_permission
from app.core.exceptions import ForbiddenException, NotFoundException, ValidationException
from app.db.session import get_db
from app.schemas.asset import AssetFilters
from app.services import asset_reports as svc
from app.services.audit import log_audit

router = APIRouter(prefix="/reports/assets", tags=["reports"])


@router.get("")
async def catalog(user=Depends(get_current_user)):
    """Asset reports this user can open."""
    return [{"kind": k, "title": v["title"]} for k, v in svc.REPORTS.items() if has_permission(user, v["permission"])]


@router.get("/{kind}")
async def run_report(kind: str, filters: AssetFilters = Depends(), start: date | None = Query(None, alias="from"),
                     end: date | None = Query(None, alias="to"), format: str = Query("json", pattern="^(json|csv)$"),
                     view_filters: str | None = Query(None, alias="filters", max_length=20000,
                                                      description="JSON of the table's panel filters, keyed by column"),
                     search: str | None = Query(None, max_length=200, description="Text matched against every column"),
                     sort: str | None = Query(None, max_length=50), order: str = Query("asc", pattern="^(asc|desc)$"),
                     columns: str | None = Query(None, max_length=2000, description="Comma-separated column keys to include"),
                     db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    meta = svc.REPORTS.get(kind)
    if meta is None:
        raise NotFoundException("Unknown report")
    if not has_permission(user, meta["permission"]):
        raise ForbiddenException(f"Missing permission: {meta['permission']}")
    try:
        panel = json.loads(view_filters) if view_filters else None
    except ValueError:
        raise ValidationException("filters must be JSON")
    if panel is not None and not isinstance(panel, dict):
        raise ValidationException("filters must be a JSON object")
    report = await svc.build(db, kind, filters, start, end)
    if panel or search or sort or columns:
        report = svc.apply_view(report, panel, search, sort, order, [c for c in (columns or "").split(",") if c])
    if format == "csv":
        await log_audit(db, "report.export", "report", None, meta["title"], user_id=user.id, details=f"{len(report['rows'])} rows (CSV)")
        return Response(content=svc.to_csv(report), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{kind}-{date.today().isoformat()}.csv"'})
    return report
