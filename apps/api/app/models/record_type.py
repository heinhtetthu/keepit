from sqlalchemy import Boolean, ForeignKey, String, Text, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class RecordType(Base, TimestampMixin):
    __tablename__ = "record_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reminder_field_id: Mapped[int | None] = mapped_column(ForeignKey("record_fields.id", ondelete="SET NULL", use_alter=True, name="fk_record_types_reminder_field"))
    reminder_config: Mapped[dict | None] = mapped_column(JSONB)
    telegram_bot_id: Mapped[int | None] = mapped_column(ForeignKey("telegram_bots.id", ondelete="SET NULL"))
    # Default "renew N days before expiry" for every record of this type
    # (domains are often renewed 14-30 days early); a record can override it.
    renew_before_days: Mapped[int | None] = mapped_column(Integer)
    # Opt-in ownership/assignment tracking (license seats etc.). When enabled the
    # record detail page gains a Reassign action + ownership history and the
    # allocation report covers this type.
    track_ownership: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")

    fields: Mapped[list["RecordField"]] = relationship(
        back_populates="record_type", cascade="all, delete-orphan", order_by="RecordField.display_order",
        foreign_keys="[RecordField.record_type_id]",
        passive_deletes=True,
    )
    records: Mapped[list["Record"]] = relationship(
        back_populates="record_type", passive_deletes=True,
    )

    reminder_field: Mapped["RecordField"] = relationship(
        foreign_keys="[RecordType.reminder_field_id]",
        viewonly=True,
    )


class RecordField(Base, TimestampMixin):
    __tablename__ = "record_fields"

    FIELD_TYPES = [
        "text", "long_text", "integer", "decimal", "currency", "percentage",
        "date", "datetime", "boolean", "email", "phone", "url", "select", "multi_select",
        "employee", "business_unit", "secret",
    ]

    id: Mapped[int] = mapped_column(primary_key=True)
    record_type_id: Mapped[int] = mapped_column(ForeignKey("record_types.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False)
    field_type: Mapped[str] = mapped_column(String(50), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    unique: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    searchable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sortable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    filterable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    show_in_list: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    show_in_details: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    show_in_reports: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    default_value: Mapped[str | None] = mapped_column(Text)
    help_text: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    record_type: Mapped[RecordType] = relationship(
        back_populates="fields", foreign_keys=[record_type_id]
    )
    options: Mapped[list["RecordFieldOption"]] = relationship(
        back_populates="field", cascade="all, delete-orphan", order_by="RecordFieldOption.display_order"
    )


class RecordFieldOption(Base, TimestampMixin):
    __tablename__ = "record_field_options"

    id: Mapped[int] = mapped_column(primary_key=True)
    field_id: Mapped[int] = mapped_column(ForeignKey("record_fields.id", ondelete="CASCADE"), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    field: Mapped[RecordField] = relationship(back_populates="options")
