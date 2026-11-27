"""Daily asset digest over the existing Telegram bots: warranties and
documents expiring soon plus overdue borrows. Settings (system_settings):
asset_alert_bot_id (empty = off), asset_alert_days (default 30)."""
import logging
from datetime import timedelta
from html import escape

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.asset import Asset, AssetBorrow
from app.models.document import Document
from app.models.reminder import TelegramBot
from app.models.settings import SystemSetting
from app.services.clock import app_today

logger = logging.getLogger("asset_alerts")
LAST_KEY = "asset_alert_last_date"


async def _setting(db: AsyncSession, key: str) -> str | None:
    return (await db.execute(select(SystemSetting.value).where(SystemSetting.key == key))).scalar_one_or_none()


async def build_digest(db: AsyncSession, days: int) -> str | None:
    d0 = await app_today(db)
    end = d0 + timedelta(days=days)
    warranties = (await db.execute(select(Asset).where(Asset.deleted_at.is_(None), Asset.warranty_end_date.between(d0, end))
                                   .order_by(Asset.warranty_end_date).limit(25))).unique().scalars().all()
    docs = (await db.execute(select(Document).where(Document.deleted_at.is_(None), Document.expiry_date.between(d0, end))
                             .order_by(Document.expiry_date).limit(25))).scalars().all()
    overdue = (await db.execute(select(AssetBorrow).where(AssetBorrow.deleted_at.is_(None), AssetBorrow.returned_date.is_(None),
                                                          AssetBorrow.expected_return_date < d0)
                                .order_by(AssetBorrow.expected_return_date).limit(25))).scalars().all()
    if not (warranties or docs or overdue):
        return None
    parts = [f"<b>Asset digest · {d0.isoformat()}</b>"]
    if warranties:
        parts.append(f"\n<b>Warranties ending within {days} days</b>")
        parts += [f"• {escape(a.display_name)} - {a.warranty_end_date.isoformat()}" for a in warranties]
    if docs:
        parts.append(f"\n<b>Documents expiring within {days} days</b>")
        parts += [f"• {escape(d.title)} ({escape(d.category)}) - {d.expiry_date.isoformat()}" for d in docs]
    if overdue:
        parts.append("\n<b>Overdue borrows</b>")
        parts += [f"• {escape(b.item_name)} → {escape(b.borrower_name)} (due {b.expected_return_date.isoformat()})" for b in overdue]
    return "\n".join(parts)


async def run_asset_digest(db: AsyncSession) -> dict:
    bot_id = await _setting(db, "asset_alert_bot_id")
    if not bot_id:
        return {"sent": 0, "skipped": "disabled"}
    d0 = (await app_today(db)).isoformat()
    last = (await db.execute(select(SystemSetting).where(SystemSetting.key == LAST_KEY).with_for_update())).scalar_one_or_none()
    if last and last.value == d0:
        return {"sent": 0, "skipped": "already sent today"}
    from sqlalchemy.orm import selectinload
    bot = (await db.execute(select(TelegramBot).where(TelegramBot.id == int(bot_id))
                            .options(selectinload(TelegramBot.recipients)))).scalar_one_or_none()
    if bot is None or not bot.active:
        return {"sent": 0, "skipped": "bot unavailable"}
    message = await build_digest(db, int(await _setting(db, "asset_alert_days") or 30))
    sent = 0
    if message:
        from app.services.notification import TelegramNotificationProvider
        provider = TelegramNotificationProvider(bot.bot_token)
        for r in bot.recipients:
            if r.active:
                ok, err = await provider.send(r.telegram_chat_id, message)
                sent += int(ok)
                if not ok:
                    logger.warning("Asset digest to recipient %s failed: %s", r.id, err)
    if last:
        last.value = d0
    else:
        db.add(SystemSetting(key=LAST_KEY, value=d0, description="Last asset digest date"))
    return {"sent": sent}
