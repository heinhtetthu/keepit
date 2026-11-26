from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.legacy import LegacyMixin, legacy_unique
from app.models.renewal import RecordRenewal


class Record(Base, TimestampMixin, LegacyMixin):
    __tablename__ = "records"
    __table_args__ = (UniqueConstraint("record_type_id", "name", name="uq_record_type_name"), legacy_unique("records"),
        Index("ix_records_live_type_name", "record_type_id", "name", "id", postgresql_where=text("deleted_at IS NULL AND archived = false")),
        Index("ix_records_live_name_trgm", "name", postgresql_using="gin", postgresql_ops={"name": "gin_trgm_ops"},
              postgresql_where=text("deleted_at IS NULL AND archived = false")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    record_type_id: Mapped[int] = mapped_column(ForeignKey("record_types.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False, index=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Auto-renewal lead: renew this many days BEFORE the expiry date instead of
    # on/after it. None = renew at expiry (default). Critical for domains:
    # renewing early protects ownership across expiry grace windows.
    renew_before_days: Mapped[int | None] = mapped_column(Integer)

    record_type: Mapped["RecordType"] = relationship(back_populates="records")
    values: Mapped[list["RecordValue"]] = relationship(
        back_populates="record", cascade="all, delete-orphan", order_by="RecordValue.field_id"
    )
    renewals: Mapped[list["RecordRenewal"]] = relationship(
        cascade="all, delete-orphan", order_by="RecordRenewal.created_at.desc()"
    )


class RecordValue(Base, TimestampMixin):
    __tablename__ = "record_values"
    __table_args__ = (
        UniqueConstraint("record_id", "field_id", name="uq_record_field"),
        Index("ix_values_field_text", "field_id", text("(value ->> 'value')")),
        Index("ix_record_values_text_trgm", text("(value ->> 'value') gin_trgm_ops"), postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    record_id: Mapped[int] = mapped_column(ForeignKey("records.id", ondelete="CASCADE"), nullable=False, index=True)
    field_id: Mapped[int] = mapped_column(ForeignKey("record_fields.id", ondelete="CASCADE"), nullable=False, index=True)
    value: Mapped[dict | None] = mapped_column(JSONB)

    record: Mapped[Record] = relationship(back_populates="values")
    field: Mapped["RecordField"] = relationship()
