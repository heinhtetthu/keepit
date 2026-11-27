from datetime import timedelta

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _setup(client):
    from app.db.session import AsyncSessionLocal
    from app.services.clock import app_today
    token = (await client.post("/api/v1/auth/login", json={"identifier": "admin", "password": "admin12345"})).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.post("/api/v1/record-types", headers=headers, json={"name": "Upcoming subs", "fields": [
        {"name": "Expiry", "field_type": "date"}, {"name": "Auto Renewal", "field_type": "boolean"},
        {"name": "Cost", "field_type": "currency"},
    ]})
    assert response.status_code == 201, response.text
    rt = response.json()
    fields = {f["name"]: f["id"] for f in rt["fields"]}
    await client.put(f"/api/v1/record-types/{rt['id']}", headers=headers, json={"reminder_field_id": fields["Expiry"]})
    async with AsyncSessionLocal() as db:
        today = await app_today(db)

    async def record(name, offset, auto):
        values = [{"field_id": fields["Expiry"], "value": (today + timedelta(days=offset)).isoformat()},
                  {"field_id": fields["Auto Renewal"], "value": auto}, {"field_id": fields["Cost"], "value": 10}]
        r = await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={"name": name, "values": values})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    ids = {
        "week": await record("Due in five", 5, False),
        "month": await record("Due in twenty", 20, False),
        "auto": await record("Auto in ten", 10, True),
        "late": await record("Overdue three", -3, False),
        "far": await record("Far away", 200, False),
    }
    for days in (30, 7, 1):
        r = await client.post("/api/v1/reminders/rules", headers=headers, json={"record_type_id": rt["id"], "name": f"{days} days", "days_before": days})
        assert r.status_code == 201, r.text
    return headers, rt, ids, today


async def test_upcoming_renewals_summary_and_next_reminder(client):
    headers, rt, ids, today = await _setup(client)
    r = await client.get("/api/v1/reminders/upcoming", headers=headers, params={"days": 90})
    assert r.status_code == 200, r.text
    data = r.json()
    mine = {i["id"]: i for i in data["items"] if i["record_type_id"] == rt["id"]}
    assert set(mine) == {ids["week"], ids["month"], ids["auto"], ids["late"]}
    assert data["summary"]["overdue"] >= 1 and data["summary"]["week"] >= 1 and data["summary"]["month"] >= 3

    week = mine[ids["week"]]
    assert week["days_remaining"] == 5 and week["auto_renew"] is False and not week["will_auto_renew"]
    assert week["next_reminder"]["days_before"] == 1
    assert week["next_reminder"]["date"] == (today + timedelta(days=4)).isoformat()
    assert mine[ids["month"]]["next_reminder"]["days_before"] == 7

    auto = mine[ids["auto"]]
    assert auto["will_auto_renew"] and auto["next_reminder"] is None
    assert auto["auto_renew_date"] == (today + timedelta(days=10)).isoformat()

    late = mine[ids["late"]]
    assert late["days_remaining"] == -3 and late["next_reminder"] is None

    wide = (await client.get("/api/v1/reminders/upcoming", headers=headers, params={"days": 365})).json()
    assert any(i["id"] == ids["far"] for i in wide["items"])
    assert (await client.get("/api/v1/reminders/upcoming", headers=headers, params={"days": 0})).status_code == 422
