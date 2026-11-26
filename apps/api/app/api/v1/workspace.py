"""Settings and summaries added by the merge: AI provider, currency and
exchange rates, asset alert digest, asset dashboard, unified search."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, has_permission, require_permission, require_superuser
from app.core.exceptions import ValidationException
from app.db.session import get_db
from app.models.asset import Asset
from app.models.document import Document
from app.models.employee import Employee
from app.models.settings import SystemSetting
from app.core.config import get_settings
from app.services.audit import log_audit

router = APIRouter(tags=["workspace"])
DB = Depends(get_db, scope="function")


async def _get(db, key, default=None):
    return (await db.execute(select(SystemSetting.value).where(SystemSetting.key == key))).scalar_one_or_none() or default


async def _put(db, key, value, description):
    row = (await db.execute(select(SystemSetting).where(SystemSetting.key == key))).scalar_one_or_none()
    if value in (None, ""):
        if row:
            await db.delete(row)
        return
    if row:
        row.value = value
    else:
        db.add(SystemSetting(key=key, value=value, description=description))


# ---------------------------------------------------------------- AI provider
class AISettings(BaseModel):
    base_url: str = Field(default="", max_length=300)
    model: str = Field(default="", max_length=200)
    api_key: str | None = Field(default=None, max_length=500, description="Omit to keep; empty string clears")


@router.get("/settings/ai")
async def get_ai(db: AsyncSession = DB, user=Depends(require_superuser)):
    from app.services.ai import get_ai_config
    cfg = await get_ai_config(db)
    return {"base_url": cfg.base_url, "model": cfg.model, "has_key": bool(cfg.api_key), "ready": cfg.ready}


@router.put("/settings/ai")
async def put_ai(data: AISettings, db: AsyncSession = DB, user=Depends(require_superuser)):
    if data.base_url:
        from urllib.parse import urlparse
        u = urlparse(data.base_url.strip())
        local = (u.hostname or "") in {"localhost", "127.0.0.1", "::1", "host.docker.internal", "ollama"}
        if u.scheme != "https" and not (u.scheme == "http" and local and get_settings().AI_ALLOW_LOCAL_PROVIDER):
            raise ValidationException("Use an https:// URL (set AI_ALLOW_LOCAL_PROVIDER=true to allow a local http model server)")
        if not u.hostname:
            raise ValidationException("Base URL needs a host name")
    await _put(db, "ai_base_url", data.base_url.strip().rstrip("/"), "AI provider base URL")
    await _put(db, "ai_model", data.model.strip(), "AI model")
    if data.api_key is not None:
        from app.services.encryption import encrypt
        await _put(db, "ai_api_key", encrypt(data.api_key.strip()) if data.api_key.strip() else "", "AI API key (encrypted)")
    await log_audit(db, "settings.ai", "settings", None, "AI provider", new_values={"base_url": data.base_url, "model": data.model,
                    "key_changed": data.api_key is not None}, user_id=user.id)
    return await get_ai(db, user)


# ---------------------------------------------------------------- currency
class CurrencySettings(BaseModel):
    default_currency: str = Field(min_length=3, max_length=10)
    rates: dict[str, float] = Field(default_factory=dict, description="Units of default currency per 1 unit of code")


@router.get("/settings/currency")
async def get_currency(db: AsyncSession = DB, user=Depends(get_current_user)):
    import json
    return {"default_currency": await _get(db, "default_currency", "USD"),
            "rates": json.loads(await _get(db, "exchange_rates", "{}"))}


@router.put("/settings/currency")
async def put_currency(data: CurrencySettings, db: AsyncSession = DB, user=Depends(require_permission("settings.edit"))):
    import json
    rates = {k.strip().upper()[:10]: float(v) for k, v in data.rates.items() if k.strip()}
    if any(v <= 0 for v in rates.values()):
        raise ValidationException("Exchange rates must be positive")
    await _put(db, "default_currency", data.default_currency.strip().upper(), "Default currency")
    await _put(db, "exchange_rates", json.dumps(rates), "Exchange rates to default currency")
    await log_audit(db, "settings.currency", "settings", None, "Currency", new_values={"default": data.default_currency, "rates": rates}, user_id=user.id)
    return {"default_currency": data.default_currency.strip().upper(), "rates": rates}


# ---------------------------------------------------------------- asset alerts
class AlertSettings(BaseModel):
    bot_id: int | None = None
    days: int = Field(default=30, ge=1, le=365)


@router.get("/settings/asset-alerts")
async def get_alerts(db: AsyncSession = DB, user=Depends(require_permission("settings.view"))):
    bot = await _get(db, "asset_alert_bot_id")
    return {"bot_id": int(bot) if bot else None, "days": int(await _get(db, "asset_alert_days", "30"))}


@router.put("/settings/asset-alerts")
async def put_alerts(data: AlertSettings, db: AsyncSession = DB, user=Depends(require_permission("settings.edit"))):
    await _put(db, "asset_alert_bot_id", str(data.bot_id) if data.bot_id else "", "Telegram bot for the daily asset digest")
    await _put(db, "asset_alert_days", str(data.days), "Asset digest look-ahead (days)")
    await log_audit(db, "settings.asset_alerts", "settings", None, "Asset alerts", new_values=data.model_dump(), user_id=user.id)
    return data


@router.post("/settings/asset-alerts/preview")
async def preview_alerts(db: AsyncSession = DB, user=Depends(require_permission("settings.view"))):
    from app.services.asset_alerts import build_digest
    return {"message": await build_digest(db, int(await _get(db, "asset_alert_days", "30")))}


# ---------------------------------------------------------------- dashboard
@router.get("/dashboard/assets")
async def asset_dashboard(db: AsyncSession = DB, user=Depends(require_permission("asset.view"))):
    from app.services.asset_insights import summary
    return await summary(db)


# ---------------------------------------------------------------- unified search
@router.get("/search/all")
async def search_all(q: str = Query(..., min_length=1, max_length=200), limit: int = Query(6, ge=1, le=20),
                     db: AsyncSession = DB, user=Depends(get_current_user)):
    """⌘K across records (by type access), assets, employees and documents.
    Each section appears only for users with the matching view permission."""
    q = q.strip()
    like = f"%{q}%"
    results: list[dict] = []
    if has_permission(user, "record.view"):
        from app.api.v1.search import global_search
        results += (await global_search(q=q, limit_per_type=limit, db=db, user=user))["results"]
    if has_permission(user, "asset.view"):
        rows = (await db.execute(select(Asset).outerjoin(Employee, Employee.id == Asset.employee_id).where(
            Asset.deleted_at.is_(None), or_(
                (func.coalesce(Asset.brand, "") + " " + func.coalesce(Asset.model, "") + " " + func.coalesce(Asset.serial_number, "")).ilike(like),
                Asset.asset_type.ilike(like))).order_by(Asset.updated_at.desc()).limit(limit))).unique().scalars().all()
        results += [{"kind": "asset", "id": a.id, "title": a.display_name, "url": f"/assets/{a.id}",
                     "subtitle": f"{a.asset_type} · {a.assignment_status}" + (f" · {a.employee.name}" if a.employee else "")} for a in rows]
    if has_permission(user, "employee.view") or has_permission(user, "record.view"):
        rows = (await db.execute(select(Employee).where(or_(Employee.name.ilike(like), Employee.email.ilike(like)))
                                 .order_by(Employee.active.desc(), Employee.name).limit(limit))).scalars().all()
        results += [{"kind": "employee", "id": e.id, "title": e.name, "url": f"/employees/{e.id}",
                     "subtitle": " · ".join(filter(None, [e.title, ", ".join(e.business_units or []), None if e.active else "Inactive"]))}
                    for e in rows]
    if has_permission(user, "document.view"):
        rows = (await db.execute(select(Document).where(Document.deleted_at.is_(None), or_(
            Document.title.ilike(like), Document.reference_number.ilike(like), Document.file_name.ilike(like)))
            .order_by(Document.created_at.desc()).limit(limit))).scalars().all()
        results += [{"kind": "document", "id": d.id, "title": d.title, "url": f"/documents?open={d.id}",
                     "subtitle": f"{d.category} · {d.file_name}"} for d in rows]
    return {"results": results}
