from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, or_, tuple_, true
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.db.session import get_db
from app.services import access as access_service
from app.models.record_type import RecordType, RecordField
from app.models.record import Record, RecordValue

router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
async def global_search(
    q: str = Query(..., min_length=1, max_length=200),
    limit_per_type: int = Query(8, ge=1, le=25),
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(require_permission("record.view")),
):
    """Global record search across every record type the user can access.

    Uses a per-type DISTINCT record-id subquery so a record with many field
    values still appears exactly once, and up to `limit_per_type` records per
    type are returned (matching on record name + searchable field values).
    """
    q = q.strip()
    if not q:
        return {"results": []}

    allowed = await access_service.allowed_type_ids(db, user)
    types = (await db.execute(
        select(RecordType).where(RecordType.active == True)  # noqa: E712
        .options(selectinload(RecordType.fields))
    )).scalars().all()
    if allowed is not None:
        allowed_set = set(allowed)
        types = [t for t in types if t.id in allowed_set]
    types.sort(key=lambda t: t.name.lower())

    results: list[dict] = []

    # Record types whose name matches (management entries first).
    for t in types:
        if q.lower() in t.name.lower():
            results.append({
                "kind": "type",
                "record_type_id": t.id,
                "record_type_name": t.name,
                "record_type_slug": t.slug,
                "icon": t.icon,
                "url": f"/records/{t.slug}",
                "title": t.name,
                "subtitle": "Record type",
            })

    # Rank matching records once across all accessible types, with one SQL query.
    searchable = select(RecordValue.record_id, RecordField.record_type_id).join(RecordField, RecordField.id == RecordValue.field_id).where(
        RecordField.record_type_id.in_([t.id for t in types]),
        RecordField.active == True, RecordField.searchable == True,
        RecordValue.value["value"].astext.ilike(f"%{q}%"),
    )
    # A per-type lateral LIMIT stops before ranking every matching record.
    matches = select(
        Record.id, Record.name, Record.status, Record.record_type_id,
    ).where(
        Record.record_type_id == RecordType.id,
        Record.archived == False, Record.deleted_at.is_(None),
        or_(Record.name.ilike(f"%{q}%"), tuple_(Record.id, Record.record_type_id).in_(searchable)),
    ).order_by(Record.name, Record.id).limit(limit_per_type).correlate(RecordType).lateral()
    rows = (await db.execute(select(matches).select_from(RecordType).join(matches, true())
                            .where(RecordType.id.in_([t.id for t in types])))).all()
    by_id = {t.id: t for t in types}
    for rec in sorted(rows, key=lambda r: (by_id[r.record_type_id].name.lower(), r.name, r.id)):
        if len(results) >= 30:
            break
        t = by_id[rec.record_type_id]
        results.append({
            "kind": "record", "record_id": rec.id,
            "record_type_id": t.id, "record_type_name": t.name,
            "record_type_slug": t.slug, "icon": t.icon,
            "url": f"/records/{t.slug}/{rec.id}",
            "title": rec.name, "subtitle": f"{t.name} · record · {rec.status}",
        })

    return {"results": results[:30]}
