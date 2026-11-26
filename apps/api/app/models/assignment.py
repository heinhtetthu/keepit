from datetime import date

from sqlalchemy import Date, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.employee import Employee


class RecordAssignment(Base, TimestampMixin):
    """One entry of the ownership timeline of a record (license seat).

    The span of each entry runs from its effective_date until the next entry's
    effective_date (or forever for the newest entry). Cost is snapshotted per
    entry so historical cost allocations survive later changes.
    """
    __tablename__ = "record_assignments"
    __table_args__ = (Index("ix_assignments_record_date", "record_id", "effective_date", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    record_id: Mapped[int] = mapped_column(ForeignKey("records.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    # Snapshot so history stays intact even if the employee is later renamed/deleted.
    employee_name: Mapped[str] = mapped_column(String(200), nullable=False)
    business_unit: Mapped[str | None] = mapped_column(String(100))
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str | None] = mapped_column(String(10))
    reason: Mapped[str | None] = mapped_column(String(100), comment="Resignation / Transfer / Reallocation / Initial assignment")
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    employee: Mapped[Employee | None] = relationship()
