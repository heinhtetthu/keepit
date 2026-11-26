from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class SavedView(Base, TimestampMixin):
    __tablename__ = "saved_views"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    record_type_id: Mapped[int | None] = mapped_column(ForeignKey("record_types.id", ondelete="CASCADE"), index=True)
    # Which list the view belongs to: "records" (with record_type_id) or "assets".
    scope: Mapped[str] = mapped_column(String(20), nullable=False, server_default="records", index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    filters: Mapped[dict | None] = mapped_column(JSONB)
    sort: Mapped[dict | None] = mapped_column(JSONB)
    visible_columns: Mapped[list | None] = mapped_column(JSONB)

    user: Mapped["User"] = relationship()


class SystemSetting(Base, TimestampMixin):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    value: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
