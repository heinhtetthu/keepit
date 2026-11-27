from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_superuser
from app.core.config import get_settings
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.user import User
from app.schemas.audit import AuditFilterOptions, AuditLogResponse
from app.schemas.common import PaginatedResponse
from app.services.audit_labels import CATEGORIES, changes_for, entity_label, label_for, summary_for

router = APIRouter(prefix="/audit-logs", tags=["audit"], dependencies=[Depends(require_superuser)])

SORTS = {
    "timestamp": AuditLog.timestamp,
    "user": User.name,
    "action": AuditLog.action,
    "entity_type": AuditLog.entity_type,
    "entity_name": AuditLog.entity_name,
}


def _csv(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _day_start(d: date) -> datetime:
    """Midnight of a calendar day in the app's TIMEZONE."""
    try:
        tz = ZoneInfo(get_settings().TIMEZONE)
    except Exception:  # unknown zone name: fall back to UTC
        tz = ZoneInfo("UTC")
    return datetime.combine(d, time.min, tzinfo=tz)


async def _actions_by_category(db: AsyncSession) -> dict[str, set[tuple[str, str]]]:
    rows = (await db.execute(select(AuditLog.action, AuditLog.entity_type).distinct())).all()
    out: dict[str, set[tuple[str, str]]] = {}
    for action, entity_type in rows:
        out.setdefault(label_for(action, entity_type)[1], set()).add((action, entity_type))
    return out


def serialize(log: AuditLog, user_name: str | None) -> dict:
    label, category = label_for(log.action, log.entity_type)
    return {
        "id": log.id,
        "user_id": log.user_id,
        "user_name": user_name,
        "action": log.action,
        "action_label": label,
        "category": category,
        "summary": summary_for(log.action, log.entity_type, log.entity_name, log.details),
        "entity_type": log.entity_type,
        "entity_label": entity_label(log.entity_type),
        "entity_id": log.entity_id,
        "entity_name": log.entity_name,
        "old_values": log.old_values,
        "new_values": log.new_values,
        "changes": changes_for(log.old_values, log.new_values),
        "details": log.details,
        "ip_address": log.ip_address,
        "timestamp": log.timestamp,
    }


@router.get("", response_model=PaginatedResponse[AuditLogResponse])
async def list_audit_logs(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    entity_type: str | None = Query(None, description="Comma list of entity types"),
    user_id: str | None = Query(None, description="Comma list of user ids; 0 means system jobs"),
    action: str | None = Query(None, description="Comma list of raw action strings"),
    category: str | None = Query(None, description="change, signin, deletion or other"),
    date_from: date | None = None, date_to: date | None = None,
    q: str | None = Query(None, max_length=200),
    sort: str = Query("timestamp"), order: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db, scope="function"),
):
    conditions = []
    if types := _csv(entity_type):
        conditions.append(AuditLog.entity_type.in_(types))
    if ids := _csv(user_id):
        nums = [int(v) for v in ids if v.isdigit()]
        people = [n for n in nums if n != 0]
        parts = []
        if people:
            parts.append(AuditLog.user_id.in_(people))
        if 0 in nums:
            parts.append(AuditLog.user_id.is_(None))
        conditions.append(or_(*parts) if parts else AuditLog.id.is_(None))
    if actions := _csv(action):
        conditions.append(AuditLog.action.in_(actions))
    if cats := _csv(category):
        by_cat = await _actions_by_category(db)
        pairs = set().union(*(by_cat.get(c, set()) for c in cats))
        conditions.append(or_(*[(AuditLog.action == a) & (AuditLog.entity_type == e) for a, e in pairs]) if pairs else AuditLog.id.is_(None))
    if date_from:
        conditions.append(AuditLog.timestamp >= _day_start(date_from))
    if date_to:
        conditions.append(AuditLog.timestamp < _day_start(date_to + timedelta(days=1)))
    if q and q.strip():
        like = f"%{q.strip()}%"
        conditions.append(or_(AuditLog.entity_name.ilike(like), AuditLog.details.ilike(like),
                              AuditLog.action.ilike(like), User.name.ilike(like)))

    base = select(AuditLog, User.name.label("user_name")).outerjoin(User, AuditLog.user_id == User.id).where(*conditions)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    col = SORTS.get(sort, AuditLog.timestamp)
    direction = col.asc().nulls_last() if order == "asc" else col.desc().nulls_last()
    tie = AuditLog.id.asc() if order == "asc" else AuditLog.id.desc()
    rows = (await db.execute(base.order_by(direction, tie).offset((page - 1) * page_size).limit(page_size))).all()
    items = [serialize(log, user_name) for log, user_name in rows]
    return PaginatedResponse(items=items, page=page, page_size=page_size, total=total, total_pages=max(1, (total + page_size - 1) // page_size))


@router.get("/filters", response_model=AuditFilterOptions)
async def audit_filter_options(db: AsyncSession = Depends(get_db, scope="function")):
    """Choices for the audit list filter panel: actions, areas and people that appear in the log."""
    pairs = (await db.execute(select(AuditLog.action, AuditLog.entity_type).distinct())).all()
    actions: dict[str, dict] = {}
    for action, etype in pairs:
        label, cat = label_for(action, etype)
        # The same raw action can mean different things per area ("create" record vs record type).
        if action in actions and actions[action]["label"] != label:
            actions[action]["label"] = label_for(action)[0]
        else:
            actions.setdefault(action, {"value": action, "label": label, "category": cat})
    types = (await db.execute(select(AuditLog.entity_type).distinct())).scalars().all()
    users = (await db.execute(
        select(User.id, User.name).where(User.id.in_(select(AuditLog.user_id).where(AuditLog.user_id.is_not(None)).distinct()))
    )).all()
    has_system = (await db.execute(select(AuditLog.id).where(AuditLog.user_id.is_(None)).limit(1))).first() is not None
    return {
        "actions": sorted(actions.values(), key=lambda a: a["label"].lower()),
        "entity_types": sorted(({"value": t, "label": entity_label(t)} for t in types), key=lambda t: t["label"].lower()),
        "users": sorted(({"value": str(i), "label": n or f"User {i}"} for i, n in users), key=lambda u: u["label"].lower())
        + ([{"value": "0", "label": "System"}] if has_system else []),
        "categories": [{"value": k, "label": v} for k, v in CATEGORIES.items()],
    }
