"""Asset reports: inventory, repairs, maintenance, borrows, warranties, holders.

Each report returns {title, columns, rows, summary} so the web app can render
any of them with one component, and the same rows export to CSV.
"""
import csv
import io
from datetime import date, timedelta
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset, AssetBorrow, AssetMaintenance, AssetRepair
from app.schemas.asset import AssetFilters
from app.services.asset import asset_filter_stmt
from app.services.clock import today

MAX_ROWS = 5000
REPORTS = {
    "inventory": {"title": "Asset inventory", "permission": "asset.view"},
    "repairs": {"title": "Repairs & costs", "permission": "itlog.view"},
    "maintenance": {"title": "Maintenance checks", "permission": "itlog.view"},
    "borrows": {"title": "Borrows", "permission": "itlog.view"},
    "warranties": {"title": "Warranty expiry", "permission": "asset.view"},
    "holders": {"title": "Who holds what", "permission": "asset.view"},
}


def _money(v) -> float:
    return float(v or 0)


def _iso(v) -> str | None:
    return v.isoformat() if isinstance(v, date) else v


async def _assets(db: AsyncSession, f: AssetFilters) -> list[Asset]:
    stmt = asset_filter_stmt(f).order_by(Asset.asset_type, Asset.brand, Asset.id).limit(MAX_ROWS)
    return list((await db.execute(stmt)).unique().scalars().all())


def _asset_row(a: Asset) -> dict[str, Any]:
    return {"asset": a.display_name, "asset_id": a.id, "type": a.asset_type, "serial": a.serial_number,
            "holder": a.employee.name if a.employee else None,
            "business_unit": ", ".join(a.employee.business_units or []) if a.employee else None,
            "status": a.assignment_status, "condition": a.condition_status, "location": a.location,
            "purchased": _iso(a.purchase_date), "cost": _money(a.purchase_cost) if a.purchase_cost is not None else None,
            "currency": a.currency, "warranty_end": _iso(a.warranty_end_date)}


async def inventory(db, f, start, end):
    assets = await _assets(db, f)
    rows = [_asset_row(a) for a in assets]
    by_status: dict[str, int] = {}
    for a in assets:
        by_status[a.assignment_status] = by_status.get(a.assignment_status, 0) + 1
    total_cost = sum(_money(a.purchase_cost) for a in assets)
    return {
        "columns": [("asset", "Asset"), ("type", "Type"), ("serial", "Serial"), ("holder", "Holder"), ("business_unit", "Business unit"),
                    ("status", "Status"), ("condition", "Condition"), ("location", "Location"), ("purchased", "Purchased"),
                    ("cost", "Cost"), ("warranty_end", "Warranty ends")],
        "rows": rows,
        "summary": [("Assets", len(assets)), ("Assigned", by_status.get("Assigned", 0)), ("Free", by_status.get("Unassigned", 0)),
                    ("Purchase value", round(total_cost, 2))],
    }


def _in_range(col, start, end):
    conds = []
    if start:
        conds.append(col >= start)
    if end:
        conds.append(col <= end)
    return and_(*conds) if conds else None


async def repairs(db, f, start, end):
    ids = select(asset_filter_stmt(f).with_only_columns(Asset.id).subquery().c.id)
    stmt = select(AssetRepair, Asset).join(Asset, Asset.id == AssetRepair.asset_id).where(AssetRepair.asset_id.in_(ids))
    cond = _in_range(AssetRepair.repair_date, start, end)
    if cond is not None:
        stmt = stmt.where(cond)
    rows_db = (await db.execute(stmt.order_by(AssetRepair.repair_date.desc()).limit(MAX_ROWS))).unique().all()
    rows = [{"date": _iso(r.repair_date), "asset": a.display_name, "asset_id": a.id, "type": a.asset_type, "issue": r.issue,
             "vendor": r.vendor, "status": r.status, "cost": _money(r.cost) if r.cost is not None else None, "currency": r.currency}
            for r, a in rows_db]
    total = sum(_money(r.cost) for r, _ in rows_db)
    vendors: dict[str, float] = {}
    for r, _ in rows_db:
        if r.vendor:
            vendors[r.vendor] = vendors.get(r.vendor, 0) + _money(r.cost)
    top = max(vendors, key=vendors.get) if vendors else "-"
    return {
        "columns": [("date", "Date"), ("asset", "Asset"), ("type", "Type"), ("issue", "Issue"), ("vendor", "Vendor"),
                    ("status", "Status"), ("cost", "Cost")],
        "rows": rows,
        "summary": [("Repairs", len(rows)), ("In progress", sum(1 for r, _ in rows_db if r.status == "In Progress")),
                    ("Total cost", round(total, 2)), ("Top vendor", top)],
    }


async def maintenance(db, f, start, end):
    ids = select(asset_filter_stmt(f).with_only_columns(Asset.id).subquery().c.id)
    stmt = select(AssetMaintenance, Asset).join(Asset, Asset.id == AssetMaintenance.asset_id).where(AssetMaintenance.asset_id.in_(ids))
    cond = _in_range(AssetMaintenance.maintenance_date, start, end)
    if cond is not None:
        stmt = stmt.where(cond)
    rows_db = (await db.execute(stmt.order_by(AssetMaintenance.maintenance_date.desc()).limit(MAX_ROWS))).unique().all()
    ok = {"Good", "Done", "Not Applicable"}
    rows = []
    flagged = 0
    for m, a in rows_db:
        issues = [f"{c.get('component')}: {c.get('status')}" for c in (m.components or []) if c.get("status") not in ok]
        flagged += bool(issues) or m.body_condition not in ("Good", "Not Applicable")
        rows.append({"date": _iso(m.maintenance_date), "asset": a.display_name, "asset_id": a.id, "type": a.asset_type,
                     "body": m.body_condition, "os": m.operating_system, "issues": "; ".join(issues) or "None", "notes": m.notes})
    assets_checked = len({a.id for _, a in rows_db})
    return {
        "columns": [("date", "Date"), ("asset", "Asset"), ("type", "Type"), ("body", "Body"), ("os", "OS"), ("issues", "Issues found"), ("notes", "Notes")],
        "rows": rows,
        "summary": [("Checks", len(rows)), ("Assets checked", assets_checked), ("Needing attention", flagged)],
    }


async def borrows(db, f, start, end):
    d0 = today()
    stmt = select(AssetBorrow, Asset).outerjoin(Asset, Asset.id == AssetBorrow.asset_id).where(AssetBorrow.deleted_at.is_(None))
    cond = _in_range(AssetBorrow.borrowed_date, start, end)
    if cond is not None:
        stmt = stmt.where(cond)
    if f.q:
        like = f"%{f.q.strip()}%"
        stmt = stmt.where(or_(AssetBorrow.item_name.ilike(like), AssetBorrow.borrower_name.ilike(like)))
    rows_db = (await db.execute(stmt.order_by(AssetBorrow.borrowed_date.desc()).limit(MAX_ROWS))).unique().all()
    rows = []
    for b, a in rows_db:
        overdue = b.returned_date is None and b.expected_return_date is not None and b.expected_return_date < d0
        rows.append({"item": b.item_name, "asset_id": a.id if a else None, "serial": a.serial_number if a else None, "borrower": b.borrower_name,
                     "borrowed": _iso(b.borrowed_date), "due": _iso(b.expected_return_date), "returned": _iso(b.returned_date),
                     "state": "Overdue" if overdue else "Out" if b.returned_date is None else "Returned"})
    return {
        "columns": [("item", "Item"), ("serial", "Serial"), ("borrower", "Borrower"), ("borrowed", "Borrowed"), ("due", "Due"),
                    ("returned", "Returned"), ("state", "State")],
        "rows": rows,
        "summary": [("Borrows", len(rows)), ("Out now", sum(r["state"] != "Returned" for r in rows)),
                    ("Overdue", sum(r["state"] == "Overdue" for r in rows))],
    }


async def warranties(db, f, start, end):
    d0 = today()
    start = start or d0 - timedelta(days=30)
    end = end or d0 + timedelta(days=90)
    stmt = asset_filter_stmt(f).where(Asset.warranty_end_date.between(start, end)).order_by(Asset.warranty_end_date).limit(MAX_ROWS)
    assets = list((await db.execute(stmt)).unique().scalars().all())
    rows = []
    for a in assets:
        days = (a.warranty_end_date - d0).days
        rows.append({**_asset_row(a), "days_left": days, "state": "Expired" if days < 0 else "Within 30 days" if days <= 30 else "Later"})
    return {
        "columns": [("warranty_end", "Warranty ends"), ("days_left", "Days left"), ("state", "State"), ("asset", "Asset"),
                    ("type", "Type"), ("holder", "Holder"), ("location", "Location")],
        "rows": rows,
        "summary": [("In window", len(rows)), ("Already expired", sum(r["days_left"] < 0 for r in rows)),
                    ("Next 30 days", sum(0 <= r["days_left"] <= 30 for r in rows))],
        "window": {"from": start.isoformat(), "to": end.isoformat()},
    }


async def holders(db, f, start, end):
    assets = [a for a in await _assets(db, f) if a.employee_id]
    by_emp: dict[int, dict[str, Any]] = {}
    for a in assets:
        e = a.employee
        row = by_emp.setdefault(e.id, {"employee": e.name, "employee_id": e.id, "title": e.title,
                                       "business_unit": ", ".join(e.business_units or []), "count": 0, "items": [], "value": 0.0})
        row["count"] += 1
        row["items"].append(a.display_name)
        row["value"] += _money(a.purchase_cost)
    rows = sorted(({**r, "items": ", ".join(r["items"]), "value": round(r["value"], 2)} for r in by_emp.values()),
                  key=lambda r: (-r["count"], r["employee"]))
    return {
        "columns": [("employee", "Employee"), ("title", "Title"), ("business_unit", "Business unit"), ("count", "Assets"),
                    ("value", "Value"), ("items", "Items")],
        "rows": rows,
        "summary": [("People holding assets", len(rows)), ("Assets held", len(assets)),
                    ("Avg per person", round(len(assets) / len(rows), 1) if rows else 0)],
    }


# Column kinds, so the web app can build filters (choice pills, date and number
# ranges) and the CSV export can apply the same filters on the server.
COLUMN_TYPES = {
    "date": "date", "purchased": "date", "warranty_end": "date", "borrowed": "date", "due": "date", "returned": "date",
    "cost": "money", "value": "money", "count": "number", "days_left": "number",
    "type": "choice", "holder": "choice", "business_unit": "choice", "status": "choice", "condition": "choice",
    "location": "choice", "vendor": "choice", "body": "choice", "os": "choice", "state": "choice", "borrower": "choice",
    "title": "choice",
}


def column_type(key: str) -> str:
    return COLUMN_TYPES.get(key, "text")


BUILDERS = {"inventory": inventory, "repairs": repairs, "maintenance": maintenance, "borrows": borrows,
            "warranties": warranties, "holders": holders}


async def build(db: AsyncSession, kind: str, f: AssetFilters, start: date | None, end: date | None) -> dict[str, Any]:
    data = await BUILDERS[kind](db, f, start, end)
    return {"kind": kind, "title": REPORTS[kind]["title"],
            "columns": [{"key": k, "label": label, "type": column_type(k)} for k, label in data["columns"]],
            "rows": data["rows"], "summary": [{"label": label, "value": v} for label, v in data["summary"]],
            "truncated": len(data["rows"]) >= MAX_ROWS, **({"window": data["window"]} if "window" in data else {})}


def _day_before(iso: str) -> str:
    return (date.fromisoformat(iso[:10]) - timedelta(days=1)).isoformat()


def _range(want: Any) -> tuple[Any, Any]:
    """Filter-panel range {gte, lte} | {lt} -> inclusive (from, to)."""
    if not isinstance(want, dict):
        return None, None
    to = want.get("lte") or None
    if to is None and want.get("lt"):
        to = _day_before(str(want["lt"]))
    return want.get("gte") or None, to


def _choices(want: Any) -> list[str]:
    if isinstance(want, dict):
        want = want.get("in") or []
    if isinstance(want, str):
        want = [want] if want else []
    return [str(x) for x in want] if isinstance(want, list) else []


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _matches(kind: str, raw: Any, want: Any) -> bool:
    empty = raw is None or raw == ""
    if kind == "text":
        return not empty and str(want).lower() in str(raw).lower()
    if kind in ("date", "number", "money"):
        lo, hi = _range(want)
        if empty:
            return False
        if kind == "date":
            x = str(raw)[:10]
            return (not lo or x >= str(lo)[:10]) and (not hi or x <= str(hi)[:10])
        x, lo_n, hi_n = _num(raw), _num(lo), _num(hi)
        if x is None:
            return False
        return (lo_n is None or x >= lo_n) and (hi_n is None or x <= hi_n)
    wanted = _choices(want)
    return not wanted or (not empty and str(raw) in wanted)


def _sort_key(v: Any):
    if isinstance(v, (int, float)):
        return (0, float(v), "")
    return (1, 0.0, str(v).casefold())


def apply_view(report: dict[str, Any], filters: dict[str, Any] | None = None, search: str | None = None,
               sort: str | None = None, order: str = "asc", columns: list[str] | None = None) -> dict[str, Any]:
    """Apply the web table's search, panel filters, sort and column choice to a report.

    Mirrors the browser's clientRows so a CSV export holds exactly the rows on screen.
    """
    cols = report["columns"]
    by_key = {c["key"]: c for c in cols}
    rows = report["rows"]
    needle = (search or "").strip().lower()
    if needle:
        rows = [r for r in rows if needle in " ".join("" if r.get(c["key"]) is None else str(r.get(c["key"])) for c in cols).lower()]
    active = {k: v for k, v in (filters or {}).items() if k in by_key and v not in (None, "", [], {})}
    if active:
        rows = [r for r in rows if all(_matches(by_key[k].get("type") or column_type(k), r.get(k), v) for k, v in active.items())]
    if sort in by_key:
        present = [r for r in rows if r.get(sort) not in (None, "")]
        missing = [r for r in rows if r.get(sort) in (None, "")]
        rows = sorted(present, key=lambda r: _sort_key(r.get(sort)), reverse=order == "desc") + missing
    if columns:
        picked = [by_key[k] for k in columns if k in by_key]
        cols = picked or cols
    return {**report, "columns": cols, "rows": rows}


def to_csv(report: dict[str, Any]) -> str:
    buf = io.StringIO()
    cols = report["columns"]
    w = csv.writer(buf)
    w.writerow([c["label"] for c in cols])
    for r in report["rows"]:
        out = []
        for c in cols:
            v = r.get(c["key"])
            v = "" if v is None else str(v)
            # Neutralise spreadsheet formula injection.
            if v[:1] in ("=", "+", "-", "@", "\t", "\r") and not v.lstrip("-").replace(".", "", 1).isdigit():
                v = "'" + v
            out.append(v)
        w.writerow(out)
    return buf.getvalue()


