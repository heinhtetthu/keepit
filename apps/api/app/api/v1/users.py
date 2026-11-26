import base64

from fastapi import APIRouter, Depends, Query, UploadFile, File, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_permission, require_superuser
from app.services.audit import log_audit
from app.core.exceptions import ForbiddenException
from app.core.exceptions import NotFoundException, ValidationException
from app.db.session import get_db
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.user import UserCreate, UserUpdate, ProfileUpdateRequest, UserResponse, CurrentUser, RoleCreate, RoleUpdate, RoleResponse, PermissionResponse, PasswordChangeRequest, RecordTypeAccessRequest
from app.services import user as user_service

router = APIRouter(prefix="/users", tags=["users"])

AVATAR_MAX_BYTES = 512 * 1024
AVATAR_ALLOWED_MIMES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}


def _me_response(user: User) -> CurrentUser:
    return CurrentUser(
        id=user.id, email=user.email, username=user.username, name=user.name,
        has_avatar=user.has_avatar, is_superuser=user.is_superuser,
        permissions=list(user.permissions), roles=[r.name for r in user.roles],
    )


@router.put("/me/profile", response_model=CurrentUser)
async def update_my_profile(
    data: ProfileUpdateRequest,
    db: AsyncSession = Depends(get_db, scope="function"),
    user: User = Depends(get_current_user),
):
    """Self-service: change your own username / display name."""
    updated = await user_service.update_profile(db, user, data)
    # commit now - get_db's post-response commit leaves a small window where a
    # fast follow-up read (e.g. the UI refetching /auth/me) could miss the write
    await db.commit()
    return _me_response(updated)


@router.put("/me/avatar", response_model=CurrentUser)
async def upload_my_avatar(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db, scope="function"),
    user: User = Depends(get_current_user),
):
    """Self-service: upload a profile photo (PNG/JPEG/WebP up to 512 KB)."""
    if (file.content_type or "") not in AVATAR_ALLOWED_MIMES:
        raise ValidationException("Avatar must be a PNG, JPEG or WebP image")
    payload = await file.read()
    if len(payload) > AVATAR_MAX_BYTES:
        raise ValidationException("Avatar must be 512 KB or smaller")
    user.avatar_base64 = base64.b64encode(payload).decode("ascii")
    user.avatar_mime = file.content_type
    await db.commit()
    return _me_response(user)


@router.delete("/me/avatar", response_model=CurrentUser)
async def remove_my_avatar(db: AsyncSession = Depends(get_db, scope="function"), user: User = Depends(get_current_user)):
    user.avatar_base64 = None
    user.avatar_mime = None
    await db.commit()
    return _me_response(user)


@router.get("/me/avatar")
async def get_my_avatar(user: User = Depends(get_current_user)):
    if not user.has_avatar:
        raise NotFoundException("No avatar uploaded")
    return Response(
        content=base64.b64decode(user.avatar_base64),
        media_type=user.avatar_mime,
        headers={"Cache-Control": "no-cache"},
    )


@router.put("/me/password")
async def change_my_password(
    data: PasswordChangeRequest,
    db: AsyncSession = Depends(get_db, scope="function"),
    user=Depends(get_current_user),
):
    await user_service.change_password(db, user.id, data.current_password, data.new_password)
    return {"message": "Password updated"}


@router.get("", response_model=PaginatedResponse[UserResponse])
async def list_users(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), search: str | None = None, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("user.view"))):
    items, total = await user_service.get_users(db, page, page_size, search)
    return PaginatedResponse(items=items, page=page, page_size=page_size, total=total, total_pages=(total + page_size - 1) // page_size)


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(data: UserCreate, db: AsyncSession = Depends(get_db, scope="function"), actor=Depends(require_permission("user.create"))):
    if data.role_id is not None and not actor.is_superuser:
        raise ForbiddenException("Only system administrators may assign roles")
    result = await user_service.create_user(db, data)
    await log_audit(db, 'user.create', 'user', result.id, user_id=actor.id, new_values={'role_id': data.role_id})
    return result


@router.get("/roles", response_model=list[RoleResponse])
async def list_roles(db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("user.view"))):
    return await user_service.get_roles(db)


@router.post("/roles", response_model=RoleResponse, status_code=201)
async def create_role(data: RoleCreate, db: AsyncSession = Depends(get_db, scope="function"), actor=Depends(require_superuser)):
    result = await user_service.create_role(db, data)
    await log_audit(db, 'role.create', 'role', result.id, user_id=actor.id, new_values=data.model_dump())
    return result


@router.put("/roles/{role_id}", response_model=RoleResponse)
async def update_role(role_id: int, data: RoleUpdate, db: AsyncSession = Depends(get_db, scope="function"), actor=Depends(require_superuser)):
    roles = await user_service.get_roles(db)
    before = next((r for r in roles if r.id == role_id), None)
    old = {'name': before.name, 'permissions': [p.name for p in before.permissions]} if before else None
    result = await user_service.update_role(db, role_id, data)
    await log_audit(db, 'role.update', 'role', role_id, user_id=actor.id, old_values=old, new_values=data.model_dump(exclude_unset=True))
    return result


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(role_id: int, db: AsyncSession = Depends(get_db, scope="function"), actor=Depends(require_superuser)):
    await user_service.delete_role(db, role_id)
    await log_audit(db, 'role.delete', 'role', role_id, user_id=actor.id)


@router.get("/permissions", response_model=list[PermissionResponse])
async def list_permissions(db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("user.view"))):
    return await user_service.get_permissions(db)


@router.get("/{user_id}/record-type-access", response_model=list[int])
async def get_user_record_type_access(user_id: int, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("user.edit"))):
    """Record type IDs this user is allowed to access (empty = none unless they bypass access control)."""
    return await user_service.get_record_type_access(db, user_id)


@router.put("/{user_id}/record-type-access", response_model=list[int])
async def set_user_record_type_access(user_id: int, data: RecordTypeAccessRequest, db: AsyncSession = Depends(get_db, scope="function"), actor=Depends(require_superuser)):
    """Replace the user's allowed record types. Empty list = no access."""
    before = await user_service.get_record_type_access(db, user_id)
    result = await user_service.set_record_type_access(db, user_id, data.record_type_ids)
    await log_audit(db, 'user.access_update', 'user', user_id, user_id=actor.id,
                    old_values={'type_ids': before}, new_values={'type_ids': result})
    return result


@router.get("/{user_id}", response_model=UserResponse)
async def get_user_route(user_id: int, db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("user.view"))):
    return await user_service.get_user(db, user_id)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(user_id: int, data: UserUpdate, db: AsyncSession = Depends(get_db, scope="function"), actor=Depends(require_permission("user.edit"))):
    target = await user_service.get_user(db, user_id)
    if not actor.is_superuser and (target.is_superuser or data.role_id is not None or data.password is not None
                                  or not target.permissions.issubset(actor.permissions)):
        raise ForbiddenException("Only system administrators may reset passwords, assign roles, or manage more privileged accounts")
    old = {'name': target.name, 'is_active': target.is_active, 'roles': [r.name for r in target.roles]}
    result = await user_service.update_user(db, user_id, data)
    await log_audit(db, 'user.update', 'user', user_id, user_id=actor.id, old_values=old,
                    new_values=data.model_dump(exclude_unset=True))
    return result


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission("user.delete"))):
    target = await user_service.get_user(db, user_id)
    if not user.is_superuser and (target.is_superuser or not target.permissions.issubset(user.permissions)):
        raise ForbiddenException("Only system administrators may manage more privileged accounts")
    if user_id == user.id:
        from app.core.exceptions import ConflictException
        raise ConflictException("You cannot delete your own account")
    await user_service.delete_user(db, user_id)
    await log_audit(db, 'user.delete', 'user', user_id, user_id=user.id)
