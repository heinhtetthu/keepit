"""Workspace branding: name, primary colour, logo and favicon.

Read endpoints are public so the sign-in page can show the brand before login.
Images are stored in system_settings (small, validated) and served with a
locked-down CSP so an uploaded SVG cannot run script.
"""
import base64
import hashlib
import json
import re

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.config import get_settings
from app.core.exceptions import NotFoundException, ValidationException
from app.db.session import get_db
from app.models.settings import SystemSetting
from app.services.audit import log_audit

router = APIRouter(tags=["branding"])
DB = Depends(get_db, scope="function")
DEFAULT_PRIMARY = "#3287f0"
MAX_BYTES = 512 * 1024
MIMES = {"image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"}
KINDS = {"logo", "favicon"}


async def _get(db: AsyncSession, key: str) -> SystemSetting | None:
    return (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()


async def _set(db: AsyncSession, key: str, value: str | None, description: str) -> None:
    row = await _get(db, key)
    if value is None:
        if row:
            await db.delete(row)
    elif row:
        row.value = value
    else:
        db.add(SystemSetting(key=key, value=value, description=description))


def _version(raw: str | None) -> str | None:
    return hashlib.sha256(raw.encode()).hexdigest()[:12] if raw else None


@router.get("/branding")
async def get_branding(db: AsyncSession = DB):
    name = await _get(db, "app_name")
    color = await _get(db, "brand_primary")
    logo, fav = await _get(db, "brand_logo"), await _get(db, "brand_favicon")
    lv, fv = _version(logo.value if logo else None), _version(fav.value if fav else None)
    return {
        "app_name": (name.value if name and name.value and name.value != "Renewly" else None) or get_settings().APP_NAME,
        "primary_color": (color.value if color else None) or DEFAULT_PRIMARY,
        "logo_url": f"/api/v1/branding/logo?v={lv}" if lv else None,
        "favicon_url": f"/api/v1/branding/favicon?v={fv}" if fv else None,
    }


@router.get("/branding/{kind}")
async def get_image(kind: str, db: AsyncSession = DB):
    if kind not in KINDS:
        raise NotFoundException("Not found")
    row = await _get(db, f"brand_{kind}")
    if not row or not row.value:
        raise NotFoundException("Not set")
    data = json.loads(row.value)
    return Response(content=base64.b64decode(data["b64"]), media_type=data["mime"], headers={
        "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox"})


class BrandingUpdate(BaseModel):
    primary_color: str | None = Field(default=None, description="Hex colour like #3287f0; null resets")

    @field_validator("primary_color")
    @classmethod
    def hex_color(cls, v):
        if v is None:
            return v
        v = v.strip().lower()
        if not re.fullmatch(r"#[0-9a-f]{6}", v):
            raise ValueError("Use a hex colour like #3287f0")
        return v


@router.put("/settings/branding")
async def update_branding(data: BrandingUpdate, db: AsyncSession = DB, user=Depends(require_permission("settings.edit"))):
    await _set(db, "brand_primary", data.primary_color if data.primary_color != DEFAULT_PRIMARY else None, "Primary brand colour")
    await log_audit(db, "settings.branding", "settings", None, "Branding", new_values=data.model_dump(), user_id=user.id)
    await db.flush()
    return await get_branding(db)


@router.put("/settings/branding/{kind}")
async def upload_image(kind: str, file: UploadFile = File(...), db: AsyncSession = DB, user=Depends(require_permission("settings.edit"))):
    if kind not in KINDS:
        raise NotFoundException("Not found")
    mime = (file.content_type or "").lower()
    if mime not in MIMES:
        raise ValidationException("Use a PNG, JPEG, WebP, SVG or ICO image")
    payload = await file.read(MAX_BYTES + 1)
    if not payload or len(payload) > MAX_BYTES:
        raise ValidationException("Images must be 512 KB or smaller")
    if mime == "image/svg+xml" and re.search(rb"<script|on\w+\s*=|javascript:", payload, re.I):
        raise ValidationException("SVG images may not contain scripts")
    await _set(db, f"brand_{kind}", json.dumps({"mime": mime, "b64": base64.b64encode(payload).decode()}), f"Brand {kind}")
    await log_audit(db, f"settings.branding_{kind}", "settings", None, f"Brand {kind}", user_id=user.id)
    await db.flush()
    return await get_branding(db)


@router.delete("/settings/branding/{kind}")
async def remove_image(kind: str, db: AsyncSession = DB, user=Depends(require_permission("settings.edit"))):
    if kind not in KINDS:
        raise NotFoundException("Not found")
    await _set(db, f"brand_{kind}", None, "")
    await log_audit(db, f"settings.branding_{kind}_removed", "settings", None, f"Brand {kind}", user_id=user.id)
    await db.flush()
    return await get_branding(db)
