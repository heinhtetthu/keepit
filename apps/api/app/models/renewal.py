from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Index, Numeric, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class RecordRenewal(Base, TimestampMixin):
    __tablename__ = "record_renewals"
    __table_args__ = (Index("ix_renewals_record_old_date", "record_id", "old_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    record_id: Mapped[int] = mapped_column(ForeignKey("records.id", ondelete="CASCADE"), nullable=False, index=True)
    renewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_automatic: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    # The business date the renewal took effect on (defaults to the day it was
    # recorded; auto-renewals use the expiry date that triggered them).
    renewed_on: Mapped[date | None] = mapped_column(Date)
    old_date: Mapped[date | None] = mapped_column(Date)
    new_date: Mapped[date] = mapped_column(Date, nullable=False)
    cost: Mapped[float | None] = mapped_column(Numeric(12, 2))
    currency: Mapped[str | None] = mapped_column(String(10))
    payment_method: Mapped[str | None] = mapped_column(String(100))
    payment_reference: Mapped[str | None] = mapped_column(String(255), comment="Card name/last4, invoice no. or transfer ref")
    location: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)

    renewer: Mapped["User"] = relationship()
