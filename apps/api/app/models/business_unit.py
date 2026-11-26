from sqlalchemy import Boolean, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class BusinessUnit(Base, TimestampMixin):
    """Master list of business units, maintained in Settings and used by
    'business_unit' fields on record types and ownership tracking."""
    __tablename__ = "business_units"
    __table_args__ = (UniqueConstraint("name", name="uq_business_unit_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
