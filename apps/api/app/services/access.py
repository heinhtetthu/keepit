from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenException
from app.models.user import User, UserRecordTypeAccess


def has_type_bypass(user: User) -> bool:
    """Only system administrators bypass explicit record-type grants."""
    return bool(user and user.is_superuser)


async def allowed_type_ids(db: AsyncSession, user: User) -> list[int] | None:
    """Types the user may see (View or Edit). None = every type."""
    if has_type_bypass(user):
        return None
    result = await db.execute(select(UserRecordTypeAccess.record_type_id).where(UserRecordTypeAccess.user_id == user.id))
    return list(result.scalars().all())


async def editable_type_ids(db: AsyncSession, user: User) -> list[int] | None:
    """Types granted with Edit. None = every type."""
    if has_type_bypass(user):
        return None
    result = await db.execute(select(UserRecordTypeAccess.record_type_id).where(
        UserRecordTypeAccess.user_id == user.id, UserRecordTypeAccess.can_edit.is_(True)))
    return list(result.scalars().all())


async def type_access_map(db: AsyncSession, user: User) -> dict[int, str] | None:
    """{record_type_id: 'view' | 'edit'} for the UI. None = edit everywhere."""
    if has_type_bypass(user):
        return None
    rows = (await db.execute(select(UserRecordTypeAccess.record_type_id, UserRecordTypeAccess.can_edit)
                             .where(UserRecordTypeAccess.user_id == user.id))).all()
    return {tid: ("edit" if can_edit else "view") for tid, can_edit in rows}


def type_is_allowed(allowed: list[int] | None, record_type_id: int) -> bool:
    return allowed is None or record_type_id in allowed


async def ensure_type_access(db: AsyncSession, user: User, record_type_id: int, write: bool = False) -> None:
    """Visibility check; with write=True the type must be granted with Edit."""
    allowed = await (editable_type_ids(db, user) if write else allowed_type_ids(db, user))
    if not type_is_allowed(allowed, record_type_id):
        if write and type_is_allowed(await allowed_type_ids(db, user), record_type_id):
            raise ForbiddenException("You have view-only access to this record type")
        raise ForbiddenException("You do not have access to this record type")
