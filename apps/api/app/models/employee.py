from datetime import date

from sqlalchemy import Boolean, Date, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.legacy import LegacyMixin, legacy_unique


class Employee(Base, TimestampMixin, LegacyMixin):
    """Shared employee master list: license-seat owners (Renewly) and asset
    holders/borrowers (AssetWise). One employee may belong to several business
    units (AssetWise's "department" maps to a business unit)."""
    __tablename__ = "employees"
    __table_args__ = (legacy_unique("employees"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(50))
    username: Mapped[str | None] = mapped_column(String(100))
    business_units: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False, server_default="[]")
    regions: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False, server_default="[]")
    title: Mapped[str | None] = mapped_column(String(100))
    gender: Mapped[str | None] = mapped_column(String(20))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    join_date: Mapped[date | None] = mapped_column(Date)
    resignation_date: Mapped[date | None] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
