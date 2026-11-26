from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, has_permission
from app.core.exceptions import ForbiddenException, NotFoundException
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
                     db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    meta = svc.REPORTS.get(kind)
    if meta is None:
        raise NotFoundException("Unknown report")
    if not has_permission(user, meta["permission"]):
        raise ForbiddenException(f"Missing permission: {meta['permission']}")
    report = await svc.build(db, kind, filters, start, end)
    if format == "csv":
        await log_audit(db, "report.export", "report", None, meta["title"], user_id=user.id, details=f"{len(report['rows'])} rows (CSV)")
        return Response(content=svc.to_csv(report), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{kind}-{date.today().isoformat()}.csv"'})
    return report
