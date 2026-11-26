from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.legacy import LegacyMixin, legacy_unique

ASSIGNMENT_STATUSES = ("Assigned", "Unassigned", "Borrowed")
CONDITION_STATUSES = ("Operational", "In Repair", "Written-Off")


class Asset(Base, TimestampMixin, LegacyMixin):
    __tablename__ = "assets"
    __table_args__ = (
        legacy_unique("assets"),
        Index("ix_assets_live_type", "asset_type", "id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_assets_search_trgm", text("(coalesce(brand,'') || ' ' || coalesce(model,'') || ' ' || coalesce(serial_number,''))"
                                            " gin_trgm_ops"), postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_type: Mapped[str] = mapped_column(String(100), nullable=False)
    other_type_name: Mapped[str | None] = mapped_column(String(200))
    brand: Mapped[str | None] = mapped_column(String(200))
    model: Mapped[str | None] = mapped_column(String(200))
    serial_number: Mapped[str | None] = mapped_column(String(200), index=True)
    location: Mapped[str | None] = mapped_column(String(200))
    specs: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}", nullable=False)
    purchase_date: Mapped[date | None] = mapped_column(Date)
    purchase_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str | None] = mapped_column(String(10))
    supplier: Mapped[str | None] = mapped_column(String(200))
    warranty_end_date: Mapped[date | None] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    assignment_status: Mapped[str] = mapped_column(String(20), default="Unassigned", server_default="Unassigned", nullable=False, index=True)
    condition_status: Mapped[str] = mapped_column(String(20), default="Operational", server_default="Operational", nullable=False, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    employee: Mapped["Employee | None"] = relationship(lazy="joined")  # noqa: F821

    @property
    def display_name(self) -> str:
        parts = [p for p in (self.brand, self.model) if p]
        name = " ".join(parts) or (self.other_type_name or self.asset_type)
        return f"{name} ({self.serial_number})" if self.serial_number else name


class _AssetChild(TimestampMixin, LegacyMixin):
    id: Mapped[int] = mapped_column(primary_key=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class AssetAssignment(Base, _AssetChild):
    """One row per period an asset was held by an employee (assigned_to NULL = current)."""
    __tablename__ = "asset_assignments"
    __table_args__ = (legacy_unique("asset_assignments"),)

    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    employee_name: Mapped[str] = mapped_column(String(200), nullable=False)  # snapshot
    assigned_from: Mapped[date] = mapped_column(Date, nullable=False)
    assigned_to: Mapped[date | None] = mapped_column(Date)
    remark: Mapped[str | None] = mapped_column(Text)


class AssetRepair(Base, _AssetChild):
    __tablename__ = "asset_repairs"
    __table_args__ = (legacy_unique("asset_repairs"),)

    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    repair_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    issue: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="In Progress", nullable=False)  # In Progress | Complete
    cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str | None] = mapped_column(String(10))
    vendor: Mapped[str | None] = mapped_column(String(200))
    warranty: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)


class AssetMaintenance(Base, _AssetChild):
    __tablename__ = "asset_maintenance"
    __table_args__ = (legacy_unique("asset_maintenance"),)

    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True)
    maintenance_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    asset_status: Mapped[str | None] = mapped_column(String(50))
    operating_system: Mapped[str | None] = mapped_column(String(100))
    body_condition: Mapped[str] = mapped_column(String(30), default="Good", nullable=False)
    # [{"component": "Battery", "status": "Good", "notes": "..."}]
    components: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)


class AssetBorrow(Base, _AssetChild):
    """Borrow log. asset_id is optional: IT can lend untracked items (cables, adapters)."""
    __tablename__ = "asset_borrows"
    __table_args__ = (
        legacy_unique("asset_borrows"),
        Index("ix_asset_borrows_open", "expected_return_date", postgresql_where=text("returned_date IS NULL AND deleted_at IS NULL")),
    )

    asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id", ondelete="SET NULL"), index=True)
    item_name: Mapped[str] = mapped_column(String(300), nullable=False)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    borrower_name: Mapped[str] = mapped_column(String(200), nullable=False)
    borrower_email: Mapped[str | None] = mapped_column(String(255))
    borrowed_date: Mapped[date] = mapped_column(Date, nullable=False)
    expected_return_date: Mapped[date | None] = mapped_column(Date)
    returned_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AssetTypeTemplate(Base, TimestampMixin):
    """Which spec attributes apply to an asset type (cpu, ram, custom names...)."""
    __tablename__ = "asset_type_templates"

    asset_type: Mapped[str] = mapped_column(String(100), primary_key=True)
    attributes: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]", nullable=False)


class AssetSerialSetting(Base, TimestampMixin):
    """Auto product-number generation per asset type. No row = off."""
    __tablename__ = "asset_serial_settings"

    asset_type: Mapped[str] = mapped_column(String(100), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    format: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    next_number: Mapped[int] = mapped_column(BigInteger, default=1, nullable=False)
    # Pending number handed out by Generate, consumed when an asset is saved with it.
    reserved_number: Mapped[int | None] = mapped_column(BigInteger)
