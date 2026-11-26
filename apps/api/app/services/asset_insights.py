"""Read-only asset summaries shared by the dashboard, the assistant and reports."""
from datetime import timedelta
from typing import Any

from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset, AssetBorrow, AssetRepair
from app.models.document import Document
from app.services.clock import today


async def summary(db: AsyncSession) -> dict[str, Any]:
    d0 = today()
    live = Asset.deleted_at.is_(None)
    by_status = dict((await db.execute(select(Asset.assignment_status, func.count()).where(live).group_by(Asset.assignment_status))).all())
    by_condition = dict((await db.execute(select(Asset.condition_status, func.count()).where(live).group_by(Asset.condition_status))).all())
    by_type = [{"name": t, "count": c} for t, c in (await db.execute(
        select(Asset.asset_type, func.count()).where(live).group_by(Asset.asset_type).order_by(func.count().desc()))).all()]
    by_bu = [{"name": n, "count": c} for n, c in (await db.execute(text(
        "SELECT bu.value, count(a.id) FROM assets a JOIN employees e ON e.id = a.employee_id "
        "CROSS JOIN LATERAL jsonb_array_elements_text(e.business_units) AS bu(value) "
        "WHERE a.deleted_at IS NULL GROUP BY bu.value ORDER BY count(a.id) DESC LIMIT 12"))).all()]
    age_years = func.extract("year", func.age(d0, Asset.purchase_date))
    bucket = case((Asset.purchase_date.is_(None), "Unknown"), (age_years < 1, "< 1 yr"), (age_years < 3, "1–3 yrs"),
                  (age_years < 5, "3–5 yrs"), else_="5+ yrs")
    by_age = dict((await db.execute(select(bucket, func.count()).where(live).group_by(bucket))).all())
    warranty = (await db.execute(select(func.count()).where(live, Asset.warranty_end_date.between(d0, d0 + timedelta(days=60))))).scalar_one()
    open_b = AssetBorrow.returned_date.is_(None) & AssetBorrow.deleted_at.is_(None)
    open_borrows = (await db.execute(select(func.count()).where(open_b))).scalar_one()
    overdue = (await db.execute(select(func.count()).where(open_b, AssetBorrow.expected_return_date < d0))).scalar_one()
    month = func.date_trunc("month", AssetRepair.repair_date)
    repair_costs = [{"month": m.date().isoformat()[:7], "cost": float(c or 0), "count": n} for m, c, n in (await db.execute(
        select(month, func.sum(AssetRepair.cost), func.count()).where(AssetRepair.repair_date >= d0 - timedelta(days=365))
        .group_by(month).order_by(month))).all()]
    docs_expiring = (await db.execute(select(func.count()).where(Document.deleted_at.is_(None),
                                                                  Document.expiry_date.between(d0, d0 + timedelta(days=60))))).scalar_one()
    total = sum(by_status.values())
    return {
        "total": total, "by_assignment_status": by_status, "by_condition": by_condition, "by_type": by_type,
        "by_business_unit": by_bu, "by_age": by_age, "warranty_expiring_60d": warranty,
        "open_borrows": open_borrows, "overdue_borrows": overdue, "repair_costs_12m": repair_costs,
        "documents_expiring_60d": docs_expiring,
    }


async def assistant_snapshot(db: AsyncSession) -> dict[str, Any]:
    """Bounded, name-level facts for the assistant (never raw notes/specs)."""
    d0 = today()
    s = await summary(db)
    soon = (await db.execute(select(Asset).where(Asset.deleted_at.is_(None), Asset.warranty_end_date.between(d0, d0 + timedelta(days=60)))
                             .order_by(Asset.warranty_end_date).limit(10))).unique().scalars().all()
    overdue = (await db.execute(select(AssetBorrow).where(AssetBorrow.returned_date.is_(None), AssetBorrow.deleted_at.is_(None),
                                                          AssetBorrow.expected_return_date < d0)
                                .order_by(AssetBorrow.expected_return_date).limit(10))).scalars().all()
    return {
        "counts": {k: s[k] for k in ("total", "by_assignment_status", "by_condition", "open_borrows", "overdue_borrows",
                                      "warranty_expiring_60d", "documents_expiring_60d")},
        "by_type": s["by_type"][:10],
        "warranties_ending_soon": [{"asset": a.display_name, "ends": a.warranty_end_date.isoformat(), "path": f"/assets/{a.id}"} for a in soon],
        "overdue_borrows": [{"item": b.item_name, "borrower": b.borrower_name, "due": b.expected_return_date.isoformat(),
                             "path": "/it-logs"} for b in overdue],
    }
