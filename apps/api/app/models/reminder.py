from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.encrypted import EncryptedText


class ReminderRule(Base, TimestampMixin):
    __tablename__ = "reminder_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    record_type_id: Mapped[int] = mapped_column(ForeignKey("record_types.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    days_before: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    template: Mapped[str | None] = mapped_column(Text)

    record_type: Mapped["RecordType"] = relationship()
    logs: Mapped[list["ReminderLog"]] = relationship(back_populates="rule", cascade="all, delete-orphan")


class ReminderLog(Base, TimestampMixin):
    __tablename__ = "reminder_logs"
    __table_args__ = (
        UniqueConstraint("record_id", "reminder_rule_id", "recipient_id", "scheduled_date", name="uq_reminder_log"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    record_id: Mapped[int] = mapped_column(ForeignKey("records.id", ondelete="CASCADE"), nullable=False, index=True)
    reminder_rule_id: Mapped[int] = mapped_column(ForeignKey("reminder_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("notification_recipients.id", ondelete="CASCADE"), nullable=False)
    scheduled_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(50), default="pending", nullable=False, index=True)
    error_message: Mapped[str | None] = mapped_column(Text)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    rule: Mapped[ReminderRule] = relationship(back_populates="logs")
    record: Mapped["Record"] = relationship()
    recipient: Mapped["NotificationRecipient"] = relationship()


# A Telegram user (recipient) can be reachable through several bots; a
# notification is delivered through every active bot linked to the recipient.
recipient_bots = Table(
    "notification_recipient_bots",
    Base.metadata,
    Column("recipient_id", Integer, ForeignKey("notification_recipients.id", ondelete="CASCADE"), primary_key=True),
    Column("bot_id", Integer, ForeignKey("telegram_bots.id", ondelete="CASCADE"), primary_key=True),
)


class TelegramBot(Base, TimestampMixin):
    __tablename__ = "telegram_bots"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    bot_token: Mapped[str] = mapped_column(EncryptedText(), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    recipients: Mapped[list["NotificationRecipient"]] = relationship(
        secondary=recipient_bots, back_populates="bots", passive_deletes=True,
    )


class NotificationRecipient(Base, TimestampMixin):
    __tablename__ = "notification_recipients"

    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    telegram_chat_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    telegram_username: Mapped[str | None] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Which app user owns this Telegram account. A user may own several
    # Telegram accounts, but every account belongs to at most one user.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)

    bots: Mapped[list["TelegramBot"]] = relationship(
        secondary=recipient_bots, back_populates="recipients", lazy="selectin",
    )
    user: Mapped["User"] = relationship(lazy="selectin")
