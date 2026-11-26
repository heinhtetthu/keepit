from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission, get_current_user
from app.services.clock import app_today
from datetime import timedelta
from app.core.config import get_settings
from app.db.session import get_db
from app.models.settings import SystemSetting
from app.services.audit import log_audit

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/calendar")
async def calendar(db: AsyncSession = Depends(get_db, scope="function"), _=Depends(get_current_user)):
    today = await app_today(db)
    return {"today": today.isoformat(), "in_30_days": (today + timedelta(days=30)).isoformat()}


@router.get("/timezones", response_model=list[str])
async def timezones(_=Depends(require_permission("settings.view"))):
    return sorted(available_timezones() | {"UTC"})

DEFAULT_TIMEZONES = [
    "Asia/Yangon", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "Asia/Dubai",
    "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles",
    "Australia/Sydney", "UTC",
]


class AppSettings(BaseModel):
    app_name: str
    timezone: str
    telegram_configured: bool
    frontend_url: str | None = None


class SettingsUpdate(BaseModel):
    app_name: str | None = Field(default=None, min_length=1, max_length=100)
    timezone: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValueError("Unknown timezone")
        return value


async def _read_setting(db: AsyncSession, key: str, default: str) -> str:
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()
    return row.value if row and row.value else default


async def _read_settings(db: AsyncSession) -> AppSettings:
    s = get_settings()
    from app.models.reminder import TelegramBot
    configured_bots = (await db.execute(
        select(TelegramBot.id).where(TelegramBot.active == True, TelegramBot.bot_token != "")
    )).first()
    return AppSettings(
        app_name=await _read_setting(db, "app_name", s.APP_NAME),
        timezone=await _read_setting(db, "timezone", s.TIMEZONE),
        telegram_configured=configured_bots is not None,
        frontend_url=s.FRONTEND_URL,
    )


@router.get("", response_model=AppSettings)
async def get_app_settings(db: AsyncSession = Depends(get_db, scope="function"), _=Depends(require_permission("settings.view"))):
    return await _read_settings(db)


@router.put("", response_model=AppSettings)
async def update_app_settings(
    data: SettingsUpdate,
    db: AsyncSession = Depends(get_db, scope="function"),
    actor=Depends(require_permission("settings.edit")),
):
    for key, value in (("app_name", data.app_name), ("timezone", data.timezone)):
        if value:
            row = (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()
            if row:
                row.value = value
            else:
                db.add(SystemSetting(key=key, value=value, description=f"{key} setting"))
    await db.flush()
    await log_audit(db, 'settings.update', 'settings', user_id=actor.id,
                    new_values=data.model_dump(exclude_none=True))
    return await _read_settings(db)
