from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.encrypted import EncryptedText


class ReminderDelivery(Base, TimestampMixin):
    __tablename__ = "reminder_deliveries"
    __table_args__ = (UniqueConstraint("log_id", "bot_id", name="uq_delivery_log_bot"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    log_id: Mapped[int] = mapped_column(ForeignKey("reminder_logs.id", ondelete="CASCADE"), index=True)
    bot_id: Mapped[int | None] = mapped_column(ForeignKey("telegram_bots.id", ondelete="SET NULL"))
    message: Mapped[str] = mapped_column(EncryptedText(), nullable=False)
    claim_token: Mapped[str | None] = mapped_column(String(64), index=True)
    leased_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    error: Mapped[str | None] = mapped_column(Text)
