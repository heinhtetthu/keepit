"""Read-only renewal estimates, grouped in PostgreSQL without loading records."""
from datetime import date, timedelta
import asyncio
import json

from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import DBAPIError

from app.models.record_type import RecordType
from app.core.exceptions import ValidationException, AppException
from app.core.config import get_settings
from app.services.access import allowed_type_ids, ensure_type_access
from app.services.assignment import _bu_field
from app.services.clock import app_today
from app.services.record import _add_months, _find_field
from app.services import query_cache


FORECAST_SQL = text("""
WITH fields AS (
    SELECT * FROM jsonb_to_recordset(CAST(:fields AS jsonb)) AS f(
        type_id int, expiry_id int, cost_id int, currency_id int, bu_id int, cycle_id int, vendor_id int)
    LIMIT :type_count
), raw AS MATERIALIZED (
    SELECT r.id AS record_id, r.name, t.name AS type_name, t.slug AS type_slug,
        CASE WHEN pg_input_is_valid(left(expiry.value->>'value', 10), 'date')
            THEN left(expiry.value->>'value', 10)::date END AS expiry,
        CASE WHEN pg_input_is_valid(cost.value->>'value', 'numeric')
                  AND lower(trim(cost.value->>'value')) NOT IN ('nan','infinity','-infinity','+infinity')
            THEN CASE WHEN (cost.value->>'value')::numeric >= 0
                THEN round((cost.value->>'value')::numeric, 2) END END AS cost,
        upper(nullif(trim(currency.value->>'value'), '')) AS currency,
        nullif(trim(bu.value->>'value'), '') AS business_unit,
        nullif(trim(vendor.value->>'value'), '') AS vendor,
        lower(trim(cycle.value->>'value')) AS cycle
    FROM records r JOIN fields f ON f.type_id=r.record_type_id
    JOIN record_types t ON t.id=r.record_type_id
    LEFT JOIN record_values expiry ON expiry.record_id=r.id AND expiry.field_id=f.expiry_id
        AND expiry.field_id=ANY(CAST(:expiry_ids AS int[]))
    LEFT JOIN record_values cost ON cost.record_id=r.id AND cost.field_id=f.cost_id
        AND cost.field_id=ANY(CAST(:cost_ids AS int[]))
    LEFT JOIN record_values currency ON currency.record_id=r.id AND currency.field_id=f.currency_id
        AND currency.field_id=ANY(CAST(:currency_ids AS int[]))
    LEFT JOIN record_values bu ON bu.record_id=r.id AND bu.field_id=f.bu_id
        AND bu.field_id=ANY(CAST(:bu_ids AS int[]))
    LEFT JOIN record_values cycle ON cycle.record_id=r.id AND cycle.field_id=f.cycle_id
        AND cycle.field_id=ANY(CAST(:cycle_ids AS int[]))
    LEFT JOIN record_values vendor ON vendor.record_id=r.id AND vendor.field_id=f.vendor_id
        AND vendor.field_id=ANY(CAST(:vendor_ids AS int[]))
    WHERE NOT r.archived AND r.deleted_at IS NULL AND r.status='active'
), paid AS (
    SELECT h.record_id, max(h.new_date) AS paid_through
    FROM record_renewals h JOIN raw r ON r.record_id=h.record_id AND h.old_date=r.expiry
    WHERE h.renewed_on <= CAST(:today AS date) AND h.new_date > r.expiry
    GROUP BY h.record_id
), base AS MATERIALIZED (
    SELECT raw.*, greatest(raw.expiry, paid.paid_through) AS due,
        CASE cycle WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3
            WHEN 'semi-annual' THEN 6 WHEN 'semiannual' THEN 6 WHEN 'semi annual' THEN 6
            WHEN 'yearly' THEN 12 WHEN 'annual' THEN 12 WHEN 'biennial' THEN 24
            WHEN 'one-time' THEN -1 WHEN 'one time' THEN -1 WHEN 'perpetual' THEN -1
            WHEN 'lifetime' THEN -1 ELSE 0 END AS cycle_months
    FROM raw LEFT JOIN paid ON paid.record_id=raw.record_id
), scoped AS MATERIALIZED (
    SELECT * FROM base WHERE
        (CAST(:bu AS text) IS NULL OR coalesce(business_unit,'')=:bu) AND
        (CAST(:currency AS text) IS NULL OR coalesce(currency,'')=:currency) AND
        (CAST(:vendor AS text) IS NULL OR coalesce(vendor,'')=:vendor)
), projected AS (
    SELECT s.*, n AS occurrence,
        (due + make_interval(months => n * greatest(cycle_months,0)))::date AS renewal_date
    FROM scoped s CROSS JOIN LATERAL generate_series(0,
        CASE WHEN :repeat AND cycle_months>0 THEN (CAST(:projection_months AS integer)/cycle_months)+1 ELSE 0 END) n
    WHERE due >= CAST(:today AS date) AND due < CAST(:end AS date) AND cycle_months<>-1
), events AS MATERIALIZED (
    SELECT *, to_char(renewal_date,'YYYY-MM') AS month FROM projected
    WHERE renewal_date >= CAST(:start AS date) AND renewal_date < CAST(:end AS date)
), totals AS (
    SELECT currency, count(*) AS renewals,
        count(*) FILTER (WHERE cost IS NULL OR currency IS NULL) AS unpriced_renewals,
        (sum(cost) FILTER (WHERE currency IS NOT NULL))::text AS amount
    FROM events GROUP BY currency
), monthly AS (
    SELECT month, currency, count(*) AS renewals,
        count(*) FILTER (WHERE cost IS NULL OR currency IS NULL) AS unpriced_renewals,
        (sum(cost) FILTER (WHERE currency IS NOT NULL))::text AS amount
    FROM events GROUP BY month,currency
), units AS (
    SELECT business_unit, currency, count(*) AS renewals,
        count(*) FILTER (WHERE cost IS NULL OR currency IS NULL) AS unpriced_renewals,
        (sum(cost) FILTER (WHERE currency IS NOT NULL))::text AS amount
    FROM events GROUP BY business_unit,currency
), page AS (
    SELECT record_id,name,type_name,type_slug,renewal_date,cost::text AS amount,currency,
        business_unit,vendor,cycle,occurrence>0 AS projected
    FROM events ORDER BY renewal_date,record_id,occurrence LIMIT :limit OFFSET :offset
)
SELECT jsonb_build_object(
    'summary', (SELECT jsonb_build_object(
        'records',count(DISTINCT record_id),'renewals',count(*),
        'unpriced_renewals',count(*) FILTER (WHERE cost IS NULL OR currency IS NULL),
        'projected_renewals',count(*) FILTER (WHERE occurrence>0)) FROM events),
    'coverage', (SELECT jsonb_build_object(
        'overdue_records',count(*) FILTER (WHERE due < CAST(:today AS date)),
        'missing_date_records',count(*) FILTER (WHERE due IS NULL),
        'one_time_records',count(*) FILTER (WHERE cycle_months=-1),
        'single_date_records',count(*) FILTER (WHERE cycle_months=0 AND due >= CAST(:start AS date) AND due < CAST(:end AS date))) FROM scoped),
    'currencies',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY currency NULLS LAST) FROM totals t),'[]'::jsonb),
    'monthly',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY month,currency NULLS LAST) FROM monthly m),'[]'::jsonb),
    'business_units',coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY business_unit NULLS LAST,currency NULLS LAST) FROM units u),'[]'::jsonb),
    'items',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY renewal_date,record_id) FROM page p),'[]'::jsonb),
    'options',(SELECT jsonb_build_object(
        'business_units',coalesce(jsonb_agg(DISTINCT business_unit ORDER BY business_unit) FILTER (WHERE business_unit IS NOT NULL),'[]'::jsonb),
        'currencies',coalesce(jsonb_agg(DISTINCT currency ORDER BY currency) FILTER (WHERE currency IS NOT NULL),'[]'::jsonb),
        'vendors',coalesce(jsonb_agg(DISTINCT vendor ORDER BY vendor) FILTER (WHERE vendor IS NOT NULL),'[]'::jsonb)) FROM base)
) AS forecast
""")

_forecast_slots = asyncio.Semaphore(max(1, get_settings().FORECAST_MAX_CONCURRENT))


async def renewal_forecast(db, user, **kwargs):
    cache_key = None
    if db is not None and user is not None:
        allowed = await allowed_type_ids(db, user)
        if kwargs.get('record_type_id') is not None:
            await ensure_type_access(db, user, kwargs['record_type_id'])
        cache_key = json.dumps([user.id, sorted(user.permissions), allowed, await query_cache.revision(db),
                                (await app_today(db)).isoformat(), kwargs], sort_keys=True, default=str)
        cached = query_cache.get(cache_key)
        if cached is not None: return cached
    try:
        await asyncio.wait_for(_forecast_slots.acquire(), timeout=10)
    except TimeoutError:
        raise AppException("FORECAST_BUSY", "Forecast is busy. Please try again or narrow the filters.", 503)
    try:
        if cache_key:
            cached = query_cache.get(cache_key)
            if cached is not None: return cached
        result = await _renewal_forecast(db, user, **kwargs)
        if cache_key: query_cache.put(cache_key, result)
        return result
    finally:
        _forecast_slots.release()


async def _renewal_forecast(db, user, months=12, start: date | None = None,
                          repeat_cycles=True, record_type_id=None, business_unit=None,
                          currency=None, vendor=None, page=1, page_size=25):
    today = await app_today(db)
    start = start or today
    if start < today or start > _add_months(today, 24):
        raise ValidationException("Forecast start must be today or within the next 24 months")
    end = _add_months(start.replace(day=1), months)
    if record_type_id is not None:
        await ensure_type_access(db, user, record_type_id)
    allowed = await allowed_type_ids(db, user)
    query = select(RecordType).where(RecordType.active == True).options(selectinload(RecordType.fields))
    if allowed is not None:
        query = query.where(RecordType.id.in_(allowed))
    if record_type_id is not None:
        query = query.where(RecordType.id == record_type_id)
    types = (await db.execute(query)).scalars().all()
    mapping = []
    for rt in types:
        def field_id(names):
            field = _find_field(names, rt)
            return field.id if field else None
        bu = _bu_field(rt)
        expiry_id = next((f.id for f in rt.fields if f.active and f.id == rt.reminder_field_id), None)
        mapping.append({"type_id": rt.id, "expiry_id": expiry_id,
                        "cost_id": field_id({"Cost", "Renewal Cost", "Seat Cost", "Seat Cost (Monthly)"}),
                        "currency_id": field_id({"Currency"}), "bu_id": bu.id if bu else None,
                        "cycle_id": field_id({"Billing Cycle", "Renewal Cycle"}),
                        "vendor_id": field_id({"Vendor", "Provider", "Registrar"})})
    await db.execute(text("SELECT set_config('statement_timeout', :timeout, true)"), {
        "timeout": str(max(1, min(60, get_settings().FORECAST_QUERY_TIMEOUT_SECONDS)) * 1000),
    })
    parameters = {
        "fields": json.dumps(mapping), "today": today, "start": start, "end": end,
        "type_count": len(mapping),
        **{key + "s": sorted({row[key] for row in mapping if row[key] is not None})
           for key in ("expiry_id", "cost_id", "currency_id", "bu_id", "cycle_id", "vendor_id")},
        "projection_months": (end.year-today.year)*12 + end.month-today.month,
        "repeat": repeat_cycles, "bu": business_unit,
        "currency": currency.strip().upper() if currency is not None else None,
        "vendor": vendor, "limit": page_size, "offset": (page - 1) * page_size,
    }
    try:
        data = (await db.execute(FORECAST_SQL, parameters)).scalar_one()
    except DBAPIError as exc:
        if getattr(exc.orig, "sqlstate", None) == "57014":
            raise AppException("FORECAST_BUSY", "Forecast exceeded its time limit. Narrow the dates or filters and try again.", 503)
        raise
    return {**data, "as_of": today.isoformat(), "start": start.isoformat(),
            "end": (end-timedelta(days=1)).isoformat(), "months": months,
            "repeat_cycles": repeat_cycles, "page": page, "page_size": page_size,
            "total": data["summary"]["renewals"],
            "total_pages": (data["summary"]["renewals"] + page_size - 1) // page_size}
