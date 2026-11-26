"""Structured access: Assets level, Records level, per-record-type View/Edit,
Workspace admin, AI assistant and System administrator, with plain-language
explanations from services/access_levels.py."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_permission, require_superuser
from app.core.exceptions import NotFoundException, ValidationException
from app.db.session import get_db
from app.models.record_type import RecordType
from app.models.user import Role, User, UserRecordTypeAccess
from app.services.access_levels import CATALOG, LEVEL_IDS, LEVEL_NAMES
from app.services.audit import log_audit

router = APIRouter(prefix="/users", tags=["users"])
Level = Literal["none", "viewer", "editor", "manager"]


class Grant(BaseModel):
    record_type_id: int
    access: Literal["view", "edit"]


class AccessProfile(BaseModel):
    assets: Level = "none"
    records: Level = "none"
    workspace_admin: bool = False
    assistant: bool = False
    superuser: bool = False
    grants: list[Grant] = Field(default_factory=list)
    custom_role_ids: list[int] = Field(default_factory=list)


async def _user(db: AsyncSession, user_id: int) -> User:
    user = (await db.execute(select(User).where(User.id == user_id)
                             .options(selectinload(User.roles).selectinload(Role.permissions)))).scalar_one_or_none()
    if user is None:
        raise NotFoundException("User not found")
    return user


async def profile_for(db: AsyncSession, user: User) -> AccessProfile:
    level = {"assets": 0, "records": 0}
    flags = {"workspace": False, "assistant": False}
    custom: list[int] = []
    for r in user.roles:
        if r.scope in level:
            level[r.scope] = max(level[r.scope], r.level or 0)
        elif r.scope in flags:
            flags[r.scope] = True
        else:
            custom.append(r.id)
    grants = (await db.execute(select(UserRecordTypeAccess.record_type_id, UserRecordTypeAccess.can_edit)
                               .where(UserRecordTypeAccess.user_id == user.id))).all()
    return AccessProfile(assets=LEVEL_NAMES[level["assets"]], records=LEVEL_NAMES[level["records"]],
                         workspace_admin=flags["workspace"], assistant=flags["assistant"], superuser=user.is_superuser,
                         grants=[Grant(record_type_id=t, access="edit" if e else "view") for t, e in grants], custom_role_ids=custom)


@router.get("/access-catalog")
async def access_catalog(db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("user.view"))):
    """What every level means, for the Users screen and documentation."""
    types = (await db.execute(select(RecordType.id, RecordType.name, RecordType.icon).where(RecordType.active.is_(True))
                              .order_by(RecordType.name))).all()
    return {**CATALOG, "record_types": [{"id": i, "name": n, "icon": ic} for i, n, ic in types]}


@router.get("/{user_id}/access", response_model=AccessProfile)
async def get_access(user_id: int, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("user.view"))):
    return await profile_for(db, await _user(db, user_id))


@router.put("/{user_id}/access", response_model=AccessProfile)
async def set_access(user_id: int, data: AccessProfile, db: AsyncSession = Depends(get_db, scope="function"), actor=Depends(require_superuser)):
    """Replace a user's access. Only system administrators may change access."""
    user = await _user(db, user_id)
    before = (await profile_for(db, user)).model_dump()
    if user.id == actor.id and not data.superuser:
        raise ValidationException("You cannot remove your own system administrator access")
    system = {(r.scope, r.level): r for r in (await db.execute(select(Role).where(Role.scope.isnot(None)))).scalars().all()}
    roles: list[Role] = []
    for scope in ("assets", "records"):
        lvl = LEVEL_IDS[getattr(data, scope)]
        if lvl:
            roles.append(system[(scope, lvl)])
    if data.workspace_admin:
        roles.append(system[("workspace", 1)])
    if data.assistant:
        roles.append(system[("assistant", 1)])
    if data.custom_role_ids:
        roles += list((await db.execute(select(Role).where(Role.id.in_(data.custom_role_ids), Role.scope.is_(None)))).scalars().all())
    user.roles = roles
    user.is_superuser = data.superuser
    valid_types = set((await db.execute(select(RecordType.id))).scalars().all())
    await db.execute(delete(UserRecordTypeAccess).where(UserRecordTypeAccess.user_id == user.id))
    for g in {g.record_type_id: g for g in data.grants}.values():
        if g.record_type_id not in valid_types:
            raise ValidationException(f"Unknown record type {g.record_type_id}")
        db.add(UserRecordTypeAccess(user_id=user.id, record_type_id=g.record_type_id, can_edit=g.access == "edit"))
    user.session_version += 1  # new access takes effect on next sign-in/refresh
    await db.flush()
    after = (await profile_for(db, await _user(db, user_id))).model_dump()
    await log_audit(db, "user.access_update", "user", user.id, user.email, old_values=before, new_values=after, user_id=actor.id)
    return after
