from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundException, ConflictException
from app.core.security import hash_password, verify_password
from app.models.user import User, Role, Permission
from app.models.user import UserRecordTypeAccess
from app.models.record_type import RecordType
from app.schemas.user import UserCreate, UserUpdate, RoleCreate, RoleUpdate
from app.services.audit import log_audit


async def get_users(db: AsyncSession, page: int = 1, page_size: int = 25, search: str | None = None):
    query = select(User).options(selectinload(User.roles).selectinload(Role.permissions))
    count_query = select(func.count(User.id))
    if search:
        query = query.where(User.name.ilike(f"%{search}%") | User.email.ilike(f"%{search}%"))
        count_query = count_query.where(User.name.ilike(f"%{search}%") | User.email.ilike(f"%{search}%"))
    total = (await db.execute(count_query)).scalar() or 0
    query = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    items = (await db.execute(query)).scalars().all()
    return items, total


async def get_user(db: AsyncSession, user_id: int) -> User:
    result = await db.execute(
        select(User).where(User.id == user_id)
        .options(selectinload(User.roles).selectinload(Role.permissions))
    )
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundException("User not found")
    return user


async def update_profile(db: AsyncSession, user: User, data) -> User:
    """Self-service profile edit (username / display name) - no special permission."""
    await db.refresh(user, with_for_update=True)
    if data.username and data.username != user.username:
        user.session_version += 1
        existing_name = await db.execute(
            select(User).where(User.username == data.username, User.id != user.id)
        )
        if existing_name.scalar_one_or_none():
            raise ConflictException(f"Username '{data.username}' is already taken")
        user.username = data.username
    if data.name:
        user.name = data.name
    await db.flush()
    await log_audit(db, "user.profile_update", "user", user.id, user.email, user_id=user.id)
    return user


async def create_user(db: AsyncSession, data: UserCreate) -> User:
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise ConflictException("Email already registered")
    existing_name = await db.execute(select(User).where(User.username == data.username))
    if existing_name.scalar_one_or_none():
        raise ConflictException(f"Username '{data.username}' is already taken")
    user = User(email=data.email, username=data.username, name=data.name, hashed_password=hash_password(data.password), is_active=data.is_active)
    if data.role_id:
        role = await db.execute(select(Role).where(Role.id == data.role_id))
        r = role.scalar_one_or_none()
        if r:
            user.roles = [r]
    db.add(user)
    await db.flush()
    return await get_user(db, user.id)


async def update_user(db: AsyncSession, user_id: int, data: UserUpdate) -> User:
    user = await get_user(db, user_id)
    await db.refresh(user, with_for_update=True)
    user.session_version += 1
    if data.email and data.email != user.email:
        existing = await db.execute(select(User).where(User.email == data.email, User.id != user_id))
        if existing.scalar_one_or_none():
            raise ConflictException("Email already registered")
        user.email = data.email
    if data.username and data.username != user.username:
        existing_name = await db.execute(select(User).where(User.username == data.username, User.id != user_id))
        if existing_name.scalar_one_or_none():
            raise ConflictException(f"Username '{data.username}' is already taken")
        user.username = data.username
    if data.name is not None:
        user.name = data.name
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.password is not None:
        user.hashed_password = hash_password(data.password)
        # An admin-set password is temporary: the user must choose their own.
        user.must_change_password = True
    if data.role_id is not None:
        role = await db.execute(select(Role).where(Role.id == data.role_id))
        r = role.scalar_one_or_none()
        if not r:
            raise NotFoundException("Role not found")
        user.roles = [r]
    await db.flush()
    return await get_user(db, user_id)


async def change_password(db: AsyncSession, user_id: int, current_password: str, new_password: str) -> None:
    result = await db.execute(
        select(User).where(User.id == user_id).options(selectinload(User.roles)).with_for_update()
        .execution_options(populate_existing=True)
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(current_password, user.hashed_password):
        raise ConflictException("Current password is incorrect")
    user.hashed_password = hash_password(new_password)
    user.must_change_password = False
    user.session_version += 1
    await db.flush()


async def delete_user(db: AsyncSession, user_id: int) -> None:
    user = await get_user(db, user_id)
    await db.delete(user)


async def get_roles(db: AsyncSession):
    result = await db.execute(select(Role).options(selectinload(Role.permissions)).order_by(Role.name))
    return result.scalars().all()


async def create_role(db: AsyncSession, data: RoleCreate) -> Role:
    role = Role(name=data.name, description=data.description)
    if data.permission_ids:
        perms = await db.execute(select(Permission).where(Permission.id.in_(data.permission_ids)))
        role.permissions = list(perms.scalars().all())
    db.add(role)
    await db.flush()
    await db.refresh(role, ["permissions", "updated_at", "created_at"])
    return role


async def update_role(db: AsyncSession, role_id: int, data: RoleUpdate) -> Role:
    result = await db.execute(select(Role).where(Role.id == role_id).options(selectinload(Role.permissions)))
    role = result.scalar_one_or_none()
    if not role:
        raise NotFoundException("Role not found")
    if data.name is not None:
        role.name = data.name
    if data.description is not None:
        role.description = data.description
    if data.permission_ids is not None:
        perms = await db.execute(select(Permission).where(Permission.id.in_(data.permission_ids)))
        role.permissions = list(perms.scalars().all())
    await db.flush()
    await db.refresh(role, ["permissions", "updated_at", "created_at"])
    return role


async def delete_role(db: AsyncSession, role_id: int) -> None:
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if not role:
        raise NotFoundException("Role not found")
    if role.is_system:
        raise ConflictException("System roles cannot be deleted")
    await db.delete(role)


async def get_permissions(db: AsyncSession):
    result = await db.execute(select(Permission).order_by(Permission.name))
    return result.scalars().all()


async def get_record_type_access(db: AsyncSession, user_id: int) -> list[int]:
    user = await get_user(db, user_id)
    result = await db.execute(
        select(UserRecordTypeAccess.record_type_id)
        .where(UserRecordTypeAccess.user_id == user.id)
        .order_by(UserRecordTypeAccess.record_type_id)
    )
    return list(result.scalars().all())


async def set_record_type_access(db: AsyncSession, user_id: int, record_type_ids: list[int]) -> list[int]:
    user = await get_user(db, user_id)
    wanted = sorted({int(tid) for tid in record_type_ids})
    if wanted:
        found = (await db.execute(select(RecordType.id).where(RecordType.id.in_(wanted)))).scalars().all()
        missing = [tid for tid in wanted if tid not in set(found)]
        if missing:
            raise NotFoundException(f"Record type(s) not found: {', '.join(str(m) for m in missing)}")
    current = set((await db.execute(
        select(UserRecordTypeAccess.record_type_id).where(UserRecordTypeAccess.user_id == user.id)
    )).scalars().all())
    to_remove = current - set(wanted)
    to_add = set(wanted) - current
    if to_remove:
        # diff only - deleting and re-inserting the same row in one flush runs
        # the INSERT before the DELETE and trips uq_user_record_type
        await db.execute(delete(UserRecordTypeAccess).where(
            UserRecordTypeAccess.user_id == user.id,
            UserRecordTypeAccess.record_type_id.in_(to_remove),
        ))
    for tid in to_add:
        db.add(UserRecordTypeAccess(user_id=user.id, record_type_id=tid))
    await db.flush()
    return wanted
