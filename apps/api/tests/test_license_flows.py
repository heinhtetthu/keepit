"""Seat flows on tracked types: unassign, swap, offboard, summary counts."""
from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")

TODAY = date.today().isoformat()


async def _headers(client):
    resp = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _setup(client, h):
    rt = await client.post("/api/v1/record-types", json={
        "name": "Licenses Test",
        "fields": [
            {"name": "Product Name", "field_type": "select", "options": [
                {"value": "Std", "label": "Std"}, {"value": "Basic", "label": "Basic"}]},
            {"name": "Assigned To", "field_type": "employee"},
            {"name": "Email Address", "field_type": "email"},
            {"name": "Business Unit", "field_type": "text"},
            {"name": "Expiry Date", "field_type": "date"},
            {"name": "Auto Renewal", "field_type": "boolean"},
            {"name": "Cost", "field_type": "currency"},
        ],
    }, headers=h)
    assert rt.status_code == 201, rt.text
    rt_id = rt.json()["id"]
    f = {x["name"]: x["id"] for x in rt.json()["fields"]}
    await client.put(f"/api/v1/record-types/{rt_id}", json={"reminder_field_id": f["Expiry Date"]}, headers=h)
    emps = {}
    for name, email, bu in (("Alice", "alice@example.com", "Javelin"), ("Bob", "bob@example.com", "Sampan")):
        r = await client.post("/api/v1/employees", json={"name": name, "email": email, "business_units": [bu]}, headers=h)
        assert r.status_code == 201, r.text
        emps[name] = r.json()["id"]
    ids = {}
    for product, holder, cost, auto in (("Std", "Alice", 120, True), ("Basic", "Bob", 36, False)):
        rec = await client.post(f"/api/v1/records/by-type/{rt_id}", json={
            "name": f"{product} - {holder}", "status": "active", "values": [
                {"field_id": f["Product Name"], "value": product},
                {"field_id": f["Assigned To"], "value": holder},
                {"field_id": f["Email Address"], "value": f"{holder.lower()}@example.com"},
                {"field_id": f["Business Unit"], "value": "Javelin" if holder == "Alice" else "Sampan"},
                {"field_id": f["Expiry Date"], "value": (date.today() + timedelta(days=10)).isoformat()},
                {"field_id": f["Auto Renewal"], "value": auto},
                {"field_id": f["Cost"], "value": cost},
            ]}, headers=h)
        assert rec.status_code == 201, rec.text
        ids[holder] = rec.json()["id"]
    enable = await client.put(f"/api/v1/record-types/{rt_id}", json={"track_ownership": True}, headers=h)
    assert enable.status_code == 200
    return rt_id, f, emps, ids


def _vals(detail):
    return {v["field_name"]: v["value"] for v in detail["values"]}


async def test_swap_exchanges_holders_and_names(client):
    h = await _headers(client)
    _, _, _, ids = await _setup(client, h)
    resp = await client.post(f"/api/v1/records/{ids['Alice']}/swap",
                             json={"other_record_id": ids["Bob"], "effective_date": TODAY}, headers=h)
    assert resp.status_code == 201, resp.text
    a = (await client.get(f"/api/v1/records/{ids['Alice']}", headers=h)).json()
    b = (await client.get(f"/api/v1/records/{ids['Bob']}", headers=h)).json()
    assert a["name"] == "Std - Bob" and b["name"] == "Basic - Alice"
    assert _vals(a)["Assigned To"] == "Bob" and _vals(a)["Email Address"] == "bob@example.com"
    assert _vals(a)["Business Unit"] == "Sampan"
    assert _vals(a)["Cost"] == 120  # cost stays with the seat
    history = (await client.get(f"/api/v1/records/{ids['Alice']}/assignments", headers=h)).json()
    assert history[0]["employee_name"] == "Bob" and history[0]["reason"] == "Swap"


async def test_unassign_twice_and_name_collision(client):
    h = await _headers(client)
    rt_id, f, _, ids = await _setup(client, h)
    # second Std seat so two unassigned Std seats would share a name
    other = await client.post(f"/api/v1/records/by-type/{rt_id}", json={
        "name": "Std - Carol", "status": "active", "values": [
            {"field_id": f["Product Name"], "value": "Std"}, {"field_id": f["Assigned To"], "value": "Carol"}]}, headers=h)
    for rid in (ids["Alice"], other.json()["id"]):
        resp = await client.post(f"/api/v1/records/{rid}/assignments", json={"unassign": True, "effective_date": TODAY}, headers=h)
        assert resp.status_code == 201, resp.text
    a = (await client.get(f"/api/v1/records/{ids['Alice']}", headers=h)).json()
    c = (await client.get(f"/api/v1/records/{other.json()['id']}", headers=h)).json()
    assert a["name"] == "Std - Unassigned"
    assert c["name"] == f"Std - Unassigned #{c['id']}"
    assert "Assigned To" not in _vals(a) and "Email Address" not in _vals(a)
    again = await client.post(f"/api/v1/records/{ids['Alice']}/assignments", json={"unassign": True, "effective_date": TODAY}, headers=h)
    assert again.status_code == 400

    summary = (await client.get(f"/api/v1/records/by-type/{rt_id}/summary", headers=h)).json()
    assert summary["total"] == 3 and summary["unassigned"] == 2
    assert summary["expiring"] == 2 and summary["auto_renew_off"] == 2  # Bob's seat (false) + Carol's (unset)

    # reassign an unassigned seat to a linked employee
    emp = await client.post("/api/v1/employees", json={"name": "Dana", "email": "dana@example.com", "business_units": ["Javelin"]}, headers=h)
    resp = await client.post(f"/api/v1/records/{ids['Alice']}/assignments",
                             json={"employee_id": emp.json()["id"], "effective_date": TODAY}, headers=h)
    assert resp.status_code == 201
    a = (await client.get(f"/api/v1/records/{ids['Alice']}", headers=h)).json()
    assert a["name"] == "Std - Dana" and _vals(a)["Email Address"] == "dana@example.com"


async def test_release_employee_unassigns_all_their_seats(client):
    h = await _headers(client)
    _, _, emps, ids = await _setup(client, h)
    holdings = (await client.get(f"/api/v1/employees/{emps['Bob']}/holdings", headers=h)).json()
    assert [x["record_id"] for x in holdings] == [ids["Bob"]]
    resp = await client.post(f"/api/v1/employees/{emps['Bob']}/release",
                             json={"effective_date": TODAY, "deactivate": True}, headers=h)
    assert resp.status_code == 200 and resp.json()["released"] == 1, resp.text
    b = (await client.get(f"/api/v1/records/{ids['Bob']}", headers=h)).json()
    assert b["name"] == "Basic - Unassigned"
    assert (await client.get(f"/api/v1/employees/{emps['Bob']}/holdings", headers=h)).json() == []
    active = (await client.get("/api/v1/employees", headers=h)).json()
    assert all(e["id"] != emps["Bob"] for e in active)


async def test_swap_rejects_other_type_and_self(client):
    h = await _headers(client)
    _, _, _, ids = await _setup(client, h)
    same = await client.post(f"/api/v1/records/{ids['Alice']}/swap",
                             json={"other_record_id": ids["Alice"], "effective_date": TODAY}, headers=h)
    assert same.status_code == 400


async def test_bulk_assign_rotates_and_unassigns(client):
    h = await _headers(client)
    rt_id, f, emps, ids = await _setup(client, h)
    # Alice <-> Bob in one request, then unassign both
    resp = await client.post("/api/v1/records/bulk/assignments", json={"effective_date": TODAY, "items": [
        {"record_id": ids["Alice"], "employee_id": emps["Bob"]},
        {"record_id": ids["Bob"], "employee_id": emps["Alice"]},
    ]}, headers=h)
    assert resp.status_code == 200 and resp.json()["changed"] == 2, resp.text
    a = (await client.get(f"/api/v1/records/{ids['Alice']}", headers=h)).json()
    assert a["name"] == "Std - Bob"
    resp = await client.post("/api/v1/records/bulk/assignments", json={"effective_date": TODAY, "items": [
        {"record_id": ids["Alice"], "unassign": True}, {"record_id": ids["Bob"], "unassign": True},
    ]}, headers=h)
    assert resp.json()["changed"] == 2
    names = {(await client.get(f"/api/v1/records/{i}", headers=h)).json()["name"] for i in ids.values()}
    assert names == {"Std - Unassigned", "Basic - Unassigned"}


async def test_filters_recently_renewed_and_case_insensitive_bu(client):
    h = await _headers(client)
    rt_id, f, _, ids = await _setup(client, h)
    renew = await client.post(f"/api/v1/records/{ids['Bob']}/renew", json={"new_date": "2030-01-01", "renewed_on": TODAY}, headers=h)
    assert renew.status_code == 200, renew.text
    import json as _json
    r = await client.get(f"/api/v1/records/by-type/{rt_id}", params={"filters": _json.dumps({"__renewed_days": 7})}, headers=h)
    assert [x["id"] for x in r.json()["items"]] == [ids["Bob"]]
    r = await client.get(f"/api/v1/records/by-type/{rt_id}", params={"filters": _json.dumps({"business_unit": {"in": ["sampan"]}})}, headers=h)
    assert r.json()["total"] == 1
