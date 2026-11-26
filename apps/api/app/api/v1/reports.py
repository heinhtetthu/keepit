from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.db.session import get_db
from app.services import record as record_service
from app.services import export as export_service
from app.services import access as access_service
from app.services import assignment as assignment_service
from datetime import date
import csv
from io import StringIO
from app.core.exceptions import ValidationException
from app.services.forecast import renewal_forecast

router = APIRouter(prefix="/reports", tags=["reports"])


def _forecast_params(
    months: int = Query(12, ge=1, le=24), start: date | None = None,
    repeat_cycles: bool = True, record_type_id: int | None = Query(None, gt=0),
    business_unit: str | None = Query(None, max_length=500),
    currency: str | None = Query(None, max_length=10),
    vendor: str | None = Query(None, max_length=500),
):
    return dict(months=months, start=start, repeat_cycles=repeat_cycles,
                record_type_id=record_type_id, business_unit=business_unit, currency=currency, vendor=vendor)


@router.get("/forecast")
async def forecast(params=Depends(_forecast_params), page: int = Query(1, ge=1, le=1000000),
                   page_size: int = Query(25, ge=1, le=100),
                   db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("report.view"))):
    return await renewal_forecast(db, user, **params, page=page, page_size=page_size)


@router.get("/forecast.csv")
async def forecast_csv(params=Depends(_forecast_params), db: AsyncSession = Depends(get_db, scope="function"),
                       user=Depends(require_permission("report.export"))):
    data = await renewal_forecast(db, user, **params, page_size=1)
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Section", "Month", "Business Unit", "Currency", "Estimated amount", "Renewals", "Unpriced renewals"])
    for section, rows in (("Monthly", data["monthly"]), ("Business unit", data["business_units"])):
        for row in rows:
            values = [section, row.get("month", ""), row.get("business_unit") or ("All units" if section == "Monthly" else "Unassigned"),
                      row.get("currency") or "Unspecified", row["amount"] or "", row["renewals"], row["unpriced_renewals"]]
            writer.writerow(["'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")) else value for value in values])
    return Response("\ufeff" + output.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="renewal_forecast_{data["start"]}_{data["end"]}.csv"'})


async def _export_records(db, record_type_id, search, status):
    # Fetch the entire allowed export or reject explicitly; never truncate it.
    items, total, record_type = await record_service.get_records(db, record_type_id, 1, 10001, search, status)
    if total > 10000:
        raise ValidationException("Export exceeds 10,000 records. Narrow the search or status filter.")
    return items, total, record_type


async def legacy_guard(db, user, type_id):
    from sqlalchemy import select, func
    from app.models.record import Record
    from app.services.throttle import limit
    await limit(db, f'legacy-report:{user.id}', maximum=10)
    count = (await db.execute(select(func.count()).select_from(Record).where(Record.record_type_id == type_id, Record.deleted_at.is_(None)))).scalar()
    if count > 1000:
        raise ValidationException('Use Reports to generate a background report for types over 1,000 records')


@router.get("/allocation")
async def allocation_report(
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
    record_type_id: int = Query(...),
    product: str | None = Query(None, description="Filter by Product Name option"),
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(require_permission("report.view")),
):
    """Exact-day license/ownership cost allocation across business units."""
    await access_service.ensure_type_access(db, user, record_type_id)
    await legacy_guard(db, user, record_type_id)
    try:
        s = date.fromisoformat(start)
        e = date.fromisoformat(end)
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="start/end must be YYYY-MM-DD")
    if e < s or (e - s).days > 3660:
        raise ValidationException('Choose a valid report window of at most ten years')
    return await assignment_service.allocation_report(db, record_type_id, s, e, product)


@router.get("/{record_type_id}/excel")
async def export_excel(
    record_type_id: int,
    search: str | None = None, status: str | None = None,
    db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("report.export")),
):
    await access_service.ensure_type_access(db, user, record_type_id)
    await legacy_guard(db, user, record_type_id)
    items, total, record_type = await _export_records(db, record_type_id, search, status)
    data = await run_in_threadpool(export_service.export_to_excel, record_type.fields, items, record_type.name)
    filename = f"{record_type.slug}_export.xlsx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/{record_type_id}/pdf")
async def export_pdf(
    record_type_id: int,
    search: str | None = None, status: str | None = None,
    db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("report.export")),
):
    await access_service.ensure_type_access(db, user, record_type_id)
    await legacy_guard(db, user, record_type_id)
    items, total, record_type = await _export_records(db, record_type_id, search, status)
    summary = {"Total Records": str(total), "Record Type": record_type.name}
    data = await run_in_threadpool(export_service.export_to_pdf, record_type.fields, items, record_type.name, summary)
    filename = f"{record_type.slug}_report.pdf"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
