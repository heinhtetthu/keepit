from datetime import date
import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_forecast_limits_parallel_queries_and_releases_slots(monkeypatch):
    from app.services import forecast
    monkeypatch.setattr(forecast, "_forecast_slots", asyncio.Semaphore(2))
    active = peak = 0
    async def work(db, user, fail=False):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(.02)
            if fail:
                raise RuntimeError("interrupted query")
            return {"ok": True}
        finally:
            active -= 1
    monkeypatch.setattr(forecast, "_renewal_forecast", work)
    results = await asyncio.gather(*[forecast.renewal_forecast(None, None, fail=i == 0) for i in range(5)], return_exceptions=True)
    assert peak <= 2
    assert sum(isinstance(r, RuntimeError) for r in results) == 1
    assert await forecast.renewal_forecast(None, None) == {"ok": True}


async def _login(client, identifier="admin", password="admin12345"):
    response = await client.post("/api/v1/auth/login", json={"identifier": identifier, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _data(monkeypatch):
    from app.services import forecast
    from app.db.session import AsyncSessionLocal
    from app.models import RecordType, RecordField, Record, RecordValue, RecordRenewal
    monkeypatch.setattr(forecast, "app_today", AsyncMock(return_value=date(2028, 1, 31)))
    async with AsyncSessionLocal() as db:
        types = []
        for label in ("Forecast subscriptions", "Private subscriptions"):
            rt = RecordType(name=label, slug=label.replace(" ", "-"))
            db.add(rt)
            await db.flush()
            fields = {}
            for name, kind in (("Expiry", "date"), ("Cost", "currency"), ("Currency", "text"),
                               ("Business Unit", "business_unit"), ("Billing Cycle", "text"), ("Vendor", "text")):
                field = RecordField(record_type_id=rt.id, name=name, slug=name.lower().replace(" ", "_"), field_type=kind)
                db.add(field)
                await db.flush()
                fields[name] = field.id
            rt.reminder_field_id = fields["Expiry"]
            types.append((rt.id, fields))

        async def record(name, expiry, cost, currency, cycle, bu="Alpha", type_index=0, **extra):
            tid, fields = types[type_index]
            r = Record(name=name, record_type_id=tid, **extra)
            db.add(r)
            await db.flush()
            for key, value in {"Expiry": expiry, "Cost": cost, "Currency": currency,
                               "Billing Cycle": cycle, "Business Unit": bu, "Vendor": "Example vendor"}.items():
                if value is not None:
                    db.add(RecordValue(record_id=r.id, field_id=fields[key], value={"value": value}))
            return r

        await record("Monthly", "2028-01-31", "0.10", "usd", "Monthly", bu="=Finance")
        await record("Quarterly", "2028-02-29", "100", "SGD", "Quarterly", bu="Beta")
        await record("Unknown cost", "2028-03-01", None, "USD", "Unspecified")
        await record("Unknown currency", "2028-02-01", "5", None, None)
        await record("Overdue", "2028-01-30", "999", "USD", "Monthly")
        await record("Malformed legacy", "not-a-date", "not-a-number", "USD", None)
        await record("One time", "2028-02-10", "999", "USD", "One-time")
        await record("Inactive", "2028-02-01", "999", "USD", "Monthly", status="inactive")
        await record("Archived", "2028-02-01", "999", "USD", "Monthly", archived=True)
        paid = await record("Already renewed early", "2028-02-15", "20", "USD", "Yearly")
        db.add(RecordRenewal(record_id=paid.id, old_date=date(2028, 2, 15), new_date=date(2029, 2, 15),
                            renewed_on=date(2028, 1, 31), cost=20, currency="USD"))
        await record("Private record", "2028-02-01", "5000", "USD", "Yearly", bu="Private unit", type_index=1)
        await db.commit()
        return types[0][0], types[1][0]


async def test_forecast_money_recurrence_coverage_and_pagination(client, monkeypatch):
    tid, _ = await _data(monkeypatch)
    admin = await _login(client)
    response = await client.get("/api/v1/reports/forecast", headers=admin,
                                params={"record_type_id": tid, "months": 3, "page_size": 100})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["start"] == "2028-01-31" and data["end"] == "2028-03-31"
    assert data["summary"] == {"records": 4, "renewals": 6, "projected_renewals": 2, "unpriced_renewals": 2}
    amounts = {r["currency"]: r["amount"] for r in data["currencies"]}
    assert Decimal(amounts["USD"]) == Decimal("0.30")
    assert Decimal(amounts["SGD"]) == Decimal("100.00")
    assert amounts[None] is None
    assert data["coverage"]["overdue_records"] == 1
    assert data["coverage"]["missing_date_records"] == 1
    assert data["coverage"]["one_time_records"] == 1
    assert [r["renewal_date"] for r in data["items"] if r["name"] == "Monthly"] == ["2028-01-31", "2028-02-29", "2028-03-31"]
    assert not any(r["name"] == "Already renewed early" for r in data["items"])
    first = (await client.get("/api/v1/reports/forecast", headers=admin, params={
        "record_type_id": tid, "months": 3, "page_size": 2, "page": 1,
    })).json()
    second = (await client.get("/api/v1/reports/forecast", headers=admin, params={
        "record_type_id": tid, "months": 3, "page_size": 2, "page": 2,
    })).json()
    assert first["total_pages"] == 3
    assert {(r["record_id"], r["renewal_date"]) for r in first["items"]}.isdisjoint(
        {(r["record_id"], r["renewal_date"]) for r in second["items"]})
    once = (await client.get("/api/v1/reports/forecast", headers=admin, params={
        "record_type_id": tid, "months": 3, "repeat_cycles": False,
    })).json()
    assert once["total"] == 4
    future = (await client.get("/api/v1/reports/forecast", headers=admin, params={
        "record_type_id": tid, "months": 1, "start": "2028-03-01", "business_unit": "=Finance",
    })).json()
    assert future["total"] == 1 and future["items"][0]["renewal_date"] == "2028-03-31"
    # Malformed legacy prices remain unknown; an explicit zero is priced/free.
    from app.db.session import AsyncSessionLocal
    from app.models import Record, RecordField, RecordValue
    async with AsyncSessionLocal() as db:
        record_id = (await db.execute(select(Record.id).where(Record.name == "Unknown cost"))).scalar_one()
        field_id = (await db.execute(select(RecordField.id).where(RecordField.record_type_id == tid, RecordField.name == "Cost"))).scalar_one()
        value = RecordValue(record_id=record_id, field_id=field_id, value={"value": "not-a-number"})
        db.add(value)
        await db.commit()
        value_id = value.id
    malformed = await client.get("/api/v1/reports/forecast", headers=admin, params={"record_type_id": tid, "months": 3})
    assert malformed.status_code == 200, malformed.text
    assert malformed.json()["summary"]["unpriced_renewals"] == 2
    async with AsyncSessionLocal() as db:
        value = await db.get(RecordValue, value_id)
        value.value = {"value": 0}
        from app.services.query_cache import invalidate
        await invalidate(db)
        await db.commit()
    free = (await client.get("/api/v1/reports/forecast", headers=admin, params={"record_type_id": tid, "months": 3})).json()
    assert free["summary"]["unpriced_renewals"] == 1
    assert Decimal(next(r["amount"] for r in free["currencies"] if r["currency"] == "USD")) == Decimal("0.30")


async def test_forecast_filters_and_csv(client, monkeypatch):
    tid, _ = await _data(monkeypatch)
    admin = await _login(client)
    params = {"record_type_id": tid, "months": 3, "business_unit": "=Finance", "currency": "usd", "vendor": "Example vendor"}
    response = await client.get("/api/v1/reports/forecast", headers=admin, params=params)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 3
    csv = await client.get("/api/v1/reports/forecast.csv", headers=admin, params=params)
    assert csv.status_code == 200, csv.text
    assert "'=Finance" in csv.text
    assert "SGD" not in csv.text
    assert (await client.get("/api/v1/reports/forecast", headers=admin, params={"months": 25})).status_code == 422
    assert (await client.get("/api/v1/reports/forecast", headers=admin, params={"start": "2028-01-30"})).status_code == 400


async def test_forecast_access_and_export_permission(client, monkeypatch):
    tid, private_tid = await _data(monkeypatch)
    from app.db.session import AsyncSessionLocal
    from app.models import User, Role, Permission, UserRecordTypeAccess
    from app.core.security import hash_password
    async with AsyncSessionLocal() as db:
        permission = (await db.execute(select(Permission).where(Permission.name == "report.view"))).scalar_one()
        user = User(email="forecast@example.test", username="forecast", name="Forecast viewer",
                    hashed_password=hash_password("forecast-test-only"), roles=[Role(name="Forecast only", permissions=[permission])])
        db.add(user)
        await db.flush()
        uid = user.id
        await db.commit()
    limited = await _login(client, "forecast", "forecast-test-only")
    empty = await client.get("/api/v1/reports/forecast", headers=limited)
    assert empty.status_code == 200, empty.text
    assert empty.json()["total"] == 0 and empty.json()["options"]["business_units"] == []
    async with AsyncSessionLocal() as db:
        db.add(UserRecordTypeAccess(user_id=uid, record_type_id=tid))
        await db.commit()
    visible = await client.get("/api/v1/reports/forecast", headers=limited)
    assert visible.status_code == 200, visible.text
    assert "Private unit" not in visible.text and "Private record" not in visible.text
    assert (await client.get("/api/v1/reports/forecast", headers=limited, params={"record_type_id": private_tid})).status_code == 403
    assert (await client.get("/api/v1/reports/forecast.csv", headers=limited)).status_code == 403
