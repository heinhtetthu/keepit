import re
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator

USERNAME_RE = re.compile(r"^[a-z0-9._-]+$")


def _check_username(v: str) -> str:
    if not USERNAME_RE.fullmatch(v):
        raise ValueError("Use lowercase letters, numbers, dots, dashes or underscores only")
    return v


class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=255)
    role_id: int | None = None
    is_active: bool = True

    @field_validator("username")
    @classmethod
    def clean_username(cls, v: str) -> str:
        return _check_username(v.strip().lower())


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    name: str | None = Field(default=None, min_length=1, max_length=255)
    username: str | None = Field(default=None, min_length=1, max_length=255)
    role_id: int | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=255)

    @field_validator("username")
    @classmethod
    def clean_username(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _check_username(v.strip().lower())


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=255)


class ProfileUpdateRequest(BaseModel):
    """Fields a user may edit for their own account from Settings."""
    username: str | None = Field(default=None, min_length=1, max_length=255)
    name: str | None = Field(default=None, min_length=1, max_length=255)

    @field_validator("username")
    @classmethod
    def clean_username(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return _check_username(v.strip().lower())


class RecordTypeAccessRequest(BaseModel):
    record_type_ids: list[int] = []


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    name: str
    username: str | None = None
    has_avatar: bool = False
    mfa_enabled: bool = False
    is_active: bool
    is_superuser: bool
    last_login: datetime | None
    roles: list["RoleResponse"]
    permissions: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RoleResponse(BaseModel):
    id: int
    name: str
    description: str | None
    is_system: bool
    scope: str | None = None
    level: int | None = None
    permissions: list["PermissionResponse"] = []

    model_config = {"from_attributes": True}


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    permission_ids: list[int] = []


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    permission_ids: list[int] | None = None


class PermissionResponse(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {"from_attributes": True}


class CurrentUser(BaseModel):
    id: int
    email: EmailStr
    name: str
    username: str | None = None
    has_avatar: bool = False
    is_superuser: bool
    permissions: list[str]
    roles: list[str]
    must_change_password: bool = False
    # {record_type_id: 'view' | 'edit'}; None = every type with edit (system administrators).
    record_type_access: dict[int, str] | None = None
