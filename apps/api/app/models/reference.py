from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.legacy import LegacyMixin, legacy_unique

REFERENCE_KINDS = ("brand", "asset_type", "location", "region", "vendor")


class ReferenceItem(Base, TimestampMixin, LegacyMixin):
    """Admin-managed lookup lists (brands, asset types, locations, regions, vendors).
    Departments are the shared `business_units` table."""
    __tablename__ = "reference_items"
    __table_args__ = (UniqueConstraint("kind", "name", name="uq_reference_kind_name"), legacy_unique("reference_items"))

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Vendor contact person / phone / email / categories live here.
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", nullable=False)
