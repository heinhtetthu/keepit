
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_superuser
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.audit import AuditLogResponse

router = APIRouter(prefix="/audit-logs", tags=["audit"], dependencies=[Depends(require_superuser)])


@router.get("", response_model=PaginatedResponse[AuditLogResponse])
async def list_audit_logs(
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    entity_type: str | None = None, user_id: int | None = None,
    db: AsyncSession = Depends(get_db, scope="function"),
):
    conditions = []
    if entity_type:
        conditions.append(AuditLog.entity_type == entity_type)
    if user_id:
        conditions.append(AuditLog.user_id == user_id)

    total = (await db.execute(select(func.count(AuditLog.id)).where(*conditions))).scalar() or 0
    query = (
        select(AuditLog, User.name.label("user_name"))
        .outerjoin(User, AuditLog.user_id == User.id)
        .where(*conditions)
        .order_by(AuditLog.timestamp.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )
    rows = (await db.execute(query)).all()
    items = [
        {
            "id": log.id,
            "user_id": log.user_id,
            "user_name": user_name,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "entity_name": log.entity_name,
            "old_values": log.old_values,
            "new_values": log.new_values,
            "details": log.details,
            "ip_address": log.ip_address,
            "timestamp": log.timestamp,
        }
        for log, user_name in rows
    ]
    return PaginatedResponse(items=items, page=page, page_size=page_size, total=total, total_pages=(total + page_size - 1) // page_size)
