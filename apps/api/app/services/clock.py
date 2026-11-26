from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.settings import SystemSetting


async def app_today(db: AsyncSession, now: datetime | None = None):
    name = (await db.execute(select(SystemSetting.value).where(
        SystemSetting.key == "timezone",
    ))).scalar_one_or_none() or get_settings().TIMEZONE
    try:
        zone = ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo(get_settings().TIMEZONE)
    return (now or datetime.now(timezone.utc)).astimezone(zone).date()


def today():
    """Synchronous 'today' in the configured default timezone (no DB lookup)."""
    try:
        zone = ZoneInfo(get_settings().TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        zone = timezone.utc
    return datetime.now(timezone.utc).astimezone(zone).date()
