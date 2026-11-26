from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Table, Column, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.legacy import LegacyMixin, legacy_unique

user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)

role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_id", ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
)


class Permission(Base, TimestampMixin):
    __tablename__ = "permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)

    roles: Mapped[list["Role"]] = relationship(secondary=role_permissions, back_populates="permissions")


class Role(Base, TimestampMixin):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Structured access: scope = assets | records | workspace | assistant; NULL = custom role.
    scope: Mapped[str | None] = mapped_column(String(20))
    level: Mapped[int | None] = mapped_column(Integer)

    permissions: Mapped[list[Permission]] = relationship(secondary=role_permissions, back_populates="roles")
    users: Mapped[list["User"]] = relationship(secondary=user_roles, back_populates="roles")


class User(Base, TimestampMixin, LegacyMixin):
    __tablename__ = "users"
    __table_args__ = (legacy_unique("users"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    mfa_secret: Mapped[str | None] = mapped_column(Text)
    mfa_pending_secret: Mapped[str | None] = mapped_column(Text)
    mfa_pending_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mfa_last_step: Mapped[int | None] = mapped_column(Integer)
    mfa_recovery_hashes: Mapped[str | None] = mapped_column(Text)
    # Profile photo, stored inline as base64 for simplicity (small images only).
    avatar_base64: Mapped[str | None] = mapped_column(Text)
    avatar_mime: Mapped[str | None] = mapped_column(String(100))
    # Forces a password change on next login (seeded admin, admin resets).
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    @property
    def has_avatar(self) -> bool:
        return bool(self.avatar_base64 and self.avatar_mime)

    roles: Mapped[list[Role]] = relationship(secondary=user_roles, back_populates="users")

    @property
    def permissions(self) -> set[str]:
        perms: set[str] = set()
        for role in self.roles:
            for perm in role.permissions:
                perms.add(perm.name)
        return perms


class UserRecordTypeAccess(Base, TimestampMixin):
    """Explicit per-user grant: user may access listed record types.

    A user with no rows sees no record types unless they are a superuser.
    """
    __tablename__ = "user_record_type_access"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    record_type_id: Mapped[int] = mapped_column(ForeignKey("record_types.id", ondelete="CASCADE"), nullable=False, index=True)
    # View-only grants still show the type; writes need can_edit (and the role's record.* permission).
    can_edit: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
