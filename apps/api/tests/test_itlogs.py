"""IT Logs: editing borrows, repairs and maintenance, returning with a date, list filters."""
import pytest
from datetime import timedelta

from app.services.clock import today

pytestmark = pytest.mark.asyncio(loop_scope="session")
TODAY = today()
D = lambda n: (TODAY - timedelta(days=n)).isoformat()  # noqa: E731


async def _login(client, identifier="admin@example.com", password="admin12345"):
    r = await client.post("/api/v1/auth/login", json={"identifier": identifier, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _asset(client, h, serial, **kw):
    r = await client.post("/api/v1/assets", json={"asset_type": "Laptop", "brand": "Dell", "model": "X", "serial_number": serial, **kw}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def _emp(client, h, name):
    r = await client.post("/api/v1/employees", json={"name": name, "email": f"{name.lower()}@corp.local"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def _status(client, h, asset_id):
    return (await client.get(f"/api/v1/assets/{asset_id}", headers=h)).json()["assignment_status"]


async def test_borrow_edit_and_return(client):
    h = await _login(client)
    a1, a2 = await _asset(client, h, "IT-1"), await _asset(client, h, "IT-2")
    emp = await _emp(client, h, "Hla")
    b = (await client.post("/api/v1/borrows", json={"asset_id": a1["id"], "borrower_name": "Guest", "borrowed_date": D(10),
                                                    "expected_return_date": D(2)}, headers=h)).json()
    assert await _status(client, h, a1["id"]) == "Borrowed"

    # move the entry to another asset and fix the borrower and dates
    r = await client.patch(f"/api/v1/borrows/{b['id']}", json={"asset_id": a2["id"], "employee_id": emp["id"], "borrowed_date": D(8),
                                                              "expected_return_date": D(1), "notes": "fixed"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["borrower_name"] == "Hla" and r.json()["asset_id"] == a2["id"] and r.json()["item_name"] == a2["display_name"]
    assert await _status(client, h, a1["id"]) == "Unassigned" and await _status(client, h, a2["id"]) == "Borrowed"
    assert (await client.patch(f"/api/v1/borrows/{b['id']}", json={"expected_return_date": D(9)}, headers=h)).status_code == 400

    # return with a chosen date: not before the borrow date, not in the future
    url = f"/api/v1/borrows/{b['id']}/return"
    assert (await client.post(url, json={"returned_date": D(9)}, headers=h)).status_code == 400
    assert (await client.post(url, json={"returned_date": (TODAY + timedelta(days=1)).isoformat()}, headers=h)).status_code == 400
    r = await client.post(url, json={"returned_date": D(3), "condition": "Good", "notes": "charger missing"}, headers=h)
    assert r.status_code == 200 and r.json()["returned_date"] == D(3)
    assert "charger missing" in r.json()["notes"] and "Good" in r.json()["notes"]
    assert await _status(client, h, a2["id"]) == "Unassigned"

    # correct the returned date, then reopen the entry
    assert (await client.patch(f"/api/v1/borrows/{b['id']}", json={"returned_date": D(4)}, headers=h)).json()["returned_date"] == D(4)
    r = await client.patch(f"/api/v1/borrows/{b['id']}", json={"returned_date": None}, headers=h)
    assert r.status_code == 200 and r.json()["returned_date"] is None
    assert await _status(client, h, a2["id"]) == "Borrowed"

    # audit has old and new values
    logs = (await client.get("/api/v1/audit-logs", params={"action": "borrow.update"}, headers=h)).json()["items"]
    assert any((i.get("old_values") or {}).get("asset_id") == a1["id"] for i in logs)

    # list filters
    other = (await client.post("/api/v1/borrows", json={"item_name": "HDMI cable", "borrower_name": "Guest",
                                                        "borrowed_date": D(1)}, headers=h)).json()
    lst = lambda **p: client.get("/api/v1/borrows", params=p, headers=h)  # noqa: E731
    assert [x["id"] for x in (await lst(asset_type="__none__")).json()["items"]] == [other["id"]]
    assert [x["id"] for x in (await lst(asset_type="Laptop")).json()["items"]] == [b["id"]]
    assert [x["id"] for x in (await lst(employee_ids=str(emp["id"]))).json()["items"]] == [b["id"]]
    assert [x["id"] for x in (await lst(status="overdue")).json()["items"]] == [b["id"]]
    assert [x["id"] for x in (await lst(borrowed_from=D(2))).json()["items"]] == [other["id"]]
    assert [x["id"] for x in (await lst(sort="borrowed_date", order="asc")).json()["items"]] == [b["id"], other["id"]]
    assert (await lst(status="open,returned")).json()["total"] == 2


async def test_repair_and_maintenance_edit_and_filters(client):
    h = await _login(client)
    a = await _asset(client, h, "IT-3")
    p = await _asset(client, h, "IT-4", asset_type="Printer")
    rep = (await client.post(f"/api/v1/assets/{a['id']}/repairs", json={"repair_date": D(5), "issue": "Screen", "cost": "50",
                                                                       "vendor": "Shop A"}, headers=h)).json()
    await client.post(f"/api/v1/assets/{p['id']}/repairs", json={"repair_date": D(1), "issue": "Jam", "cost": "300",
                                                                "vendor": "Shop B", "status": "Complete"}, headers=h)
    r = await client.patch(f"/api/v1/assets/{a['id']}/repairs/{rep['id']}", json={"repair_date": D(6), "vendor": "Shop C", "cost": "75",
                                                                                 "status": "Complete", "notes": "done"}, headers=h)
    assert r.status_code == 200 and r.json()["vendor"] == "Shop C" and r.json()["repair_date"] == D(6)
    assert (await client.patch(f"/api/v1/assets/{a['id']}/repairs/{rep['id']}", json={"repair_date": None}, headers=h)).status_code == 400

    log = lambda **q: client.get("/api/v1/assets/repairs", params=q, headers=h)  # noqa: E731
    assert [x["vendor"] for x in (await log(vendor="Shop C")).json()["items"]] == ["Shop C"]
    assert (await log(asset_type="Printer")).json()["items"][0]["asset_type"] == "Printer"
    assert (await log(cost_min=100)).json()["total"] == 1 and (await log(cost_max=100)).json()["total"] == 1
    assert (await log(date_to=D(3))).json()["total"] == 1
    assert [x["cost"] for x in (await log(sort="cost", order="asc")).json()["items"]] == [75.0, 300.0]
    assert (await log(status="Complete")).json()["total"] == 2

    ok = (await client.post(f"/api/v1/assets/{a['id']}/maintenance", json={"maintenance_date": D(4), "components": [
        {"component": "Battery", "status": "Good"}]}, headers=h)).json()
    await client.post(f"/api/v1/assets/{p['id']}/maintenance", json={"maintenance_date": D(2), "components": [
        {"component": "Roller", "status": "Needs Repair"}]}, headers=h)
    r = await client.patch(f"/api/v1/assets/{a['id']}/maintenance/{ok['id']}", json={"maintenance_date": D(3), "body_condition": "Fair",
                                                                                    "operating_system": "Windows 11"}, headers=h)
    assert r.status_code == 200 and r.json()["maintenance_date"] == D(3)
    m = lambda **q: client.get("/api/v1/assets/maintenance", params=q, headers=h)  # noqa: E731
    assert (await m(issues="true")).json()["total"] == 2  # Fair body counts as an issue
    await client.patch(f"/api/v1/assets/{a['id']}/maintenance/{ok['id']}", json={"body_condition": "Good"}, headers=h)
    assert [x["asset_type"] for x in (await m(issues="true")).json()["items"]] == ["Printer"]
    assert [x["asset_type"] for x in (await m(issues="false")).json()["items"]] == ["Laptop"]
    assert (await m(asset_type="Laptop", date_from=D(3))).json()["total"] == 1
