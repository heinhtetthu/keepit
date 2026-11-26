import pytest

from datetime import date, timedelta

pytestmark = pytest.mark.asyncio(loop_scope="session")

_BASE = date.today()
_D0 = _BASE.isoformat()                       # today (baseline anchor)
_D10 = (_BASE + timedelta(days=10)).isoformat()
_D19 = (_BASE + timedelta(days=19)).isoformat()


async def _login(client):
    from app.seed import seed
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await seed(db)
    resp = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    return resp.json()["access_token"]


async def _setup_tracked_type(client, headers):
    """Type with the applicant-named fields + one seat record. Returns (type_id, record_id)."""
    rt = await client.post("/api/v1/record-types", json={
        "name": "Seats Test",
        "fields": [
            {"name": "Product", "field_type": "select", "options": [{"value": "Plan A", "label": "Plan A"}]},
            {"name": "Assigned To", "field_type": "text", "required": True},
            {"name": "Business Unit", "field_type": "text"},
            {"name": "Cost", "field_type": "currency", "required": True},
            {"name": "Currency", "field_type": "text"},
        ],
    }, headers=headers)
    assert rt.status_code == 201, rt.text
    rt_id = rt.json()["id"]
    field_ids = {f["name"]: f["id"] for f in rt.json()["fields"]}
    rec = await client.post(f"/api/v1/records/by-type/{rt_id}", json={
        "name": "Seat #1",
        "status": "active",
        "values": [
            {"field_id": field_ids["Product"], "value": "Plan A"},
            {"field_id": field_ids["Assigned To"], "value": "Alice"},
            {"field_id": field_ids["Business Unit"], "value": "Javelin"},
            {"field_id": field_ids["Cost"], "value": 30},
            {"field_id": field_ids["Currency"], "value": "USD"},
        ],
    }, headers=headers)
    assert rec.status_code == 201, rec.text
    # opt in ownership tracking (seeds the timeline from current field values)
    enable = await client.put(f"/api/v1/record-types/{rt_id}", json={"track_ownership": True}, headers=headers)
    assert enable.status_code == 200 and enable.json()["track_ownership"] is True
    return rt_id, rec.json()["id"]


async def test_employee_crud_and_import(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.post("/api/v1/employees", json={"name": "Alice", "business_units": ["Javelin"], "email": None}, headers=headers)
    assert resp.status_code == 201
    emp_id = resp.json()["id"]
    assert resp.json()["business_units"] == ["Javelin"]
    dup = await client.post("/api/v1/employees", json={"name": "alice"}, headers=headers)
    assert dup.status_code == 409
    # an employee may belong to several business units
    resp = await client.put(f"/api/v1/employees/{emp_id}", json={
        "business_units": ["Javelin", "Sampan"], "title": "Designer"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["business_units"] == ["Javelin", "Sampan"]
    assert resp.json()["title"] == "Designer"
    imp = await client.post("/api/v1/employees/import", json={"items": [
        {"name": "Alice", "business_units": ["Javelin"]},
        {"name": "Bertie", "business_units": ["Sampan"]},
    ]}, headers=headers)
    assert imp.status_code == 200 and imp.json() == {"created": 1, "updated": 1}
    listing = await client.get("/api/v1/employees", headers=headers)
    names = [e["name"] for e in listing.json()]
    assert names == ["Alice", "Bertie"] or set(names) == {"Alice", "Bertie"}


async def test_assignment_flow_and_record_sync(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    emp = await client.post("/api/v1/employees", json={"name": "Bob", "business_units": ["Sampan"]}, headers=headers)
    emp_id = emp.json()["id"]
    rt_id, rec_id = await _setup_tracked_type(client, headers)

    hist = await client.get(f"/api/v1/records/{rec_id}/assignments", headers=headers)
    assert hist.status_code == 200
    entries = hist.json()
    assert len(entries) == 1
    baseline = entries[0]
    assert baseline["employee_name"] == "Alice"
    assert baseline["business_unit"] == "Javelin"
    assert baseline["cost"] == 30

    reassign = await client.post(f"/api/v1/records/{rec_id}/assignments", json={
        "employee_id": emp_id, "effective_date": _D0, "cost": 42, "reason": "Resignation",
    }, headers=headers)
    assert reassign.status_code == 201, reassign.text
    entry = reassign.json()
    assert entry["employee_name"] == "Bob" and entry["business_unit"] == "Sampan" and entry["cost"] == 42

    rec = await client.get(f"/api/v1/records/{rec_id}", headers=headers)
    vals = {v["field_slug"]: v["display_value"] for v in rec.json()["values"]}
    assert vals.get("assigned_to") == "Bob"
    assert vals.get("business_unit") == "Sampan"
    try:
        assert abs(float(vals.get("cost")) - 42.0) < 0.001
    except (TypeError, ValueError):
        assert vals.get("cost") == "42"

    back = await client.post(f"/api/v1/records/{rec_id}/assignments", json={
        "employee_name": "Early", "effective_date": "2020-01-01",
    }, headers=headers)
    assert back.status_code == 400


async def test_untracked_type_rejects_assignments(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    rt = await client.post("/api/v1/record-types", json={
        "name": "Plain Type",
        "fields": [{"name": "Assigned To", "field_type": "text", "required": True}],
    }, headers=headers)
    rt_id = rt.json()["id"]
    field_id = rt.json()["fields"][0]["id"]
    rec = await client.post(f"/api/v1/records/by-type/{rt_id}", json={
        "name": "Plain Record", "status": "active",
        "values": [{"field_id": field_id, "value": "Alice"}],
    }, headers=headers)
    rec_id = rec.json()["id"]
    resp = await client.get(f"/api/v1/records/{rec_id}/assignments", headers=headers)
    assert resp.status_code == 400


async def test_allocation_exact_days(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    emp = await client.post("/api/v1/employees", json={"name": "Carol", "business_units": ["Aequitas"]}, headers=headers)
    emp_id = emp.json()["id"]
    rt_id, rec_id = await _setup_tracked_type(client, headers)

    reassign = await client.post(f"/api/v1/records/{rec_id}/assignments", json={
        "employee_id": emp_id, "effective_date": _D10, "cost": 30,
    }, headers=headers)
    assert reassign.status_code == 201

    # Window: 20 days from today. Alice holds days 1-10, Carol days 11-20.
    rep = await client.get(
        f"/api/v1/reports/allocation?record_type_id={rt_id}&start={_D0}&end={_D19}", headers=headers)
    assert rep.status_code == 200
    data = rep.json()
    assert data["window_days"] == 20
    bu = {b["business_unit"]: b["allocated"] for b in data["business_units"]}
    # Alice 10/20 of 30 USD = 15.0, Carol 10/20 of 30 = 15.0 (transfer day belongs to Carol)
    assert abs(bu.get("Javelin", 0) - 15.0) < 0.01
    assert abs(bu.get("Aequitas", 0) - 15.0) < 0.01

    # Window of just the last 9 days: only Carol/Aequitas.
    rep2 = await client.get(
        f"/api/v1/reports/allocation?record_type_id={rt_id}&start={_D10}&end={_D19}", headers=headers)
    data2 = rep2.json()
    bu2 = {b["business_unit"]: b["allocated"] for b in data2["business_units"]}
    assert abs(bu2.get("Aequitas", 0) - 30.0) < 0.01
    assert "Javelin" not in bu2

    # Product filter mismatch → nothing
    rep3 = await client.get(
        f"/api/v1/reports/allocation?record_type_id={rt_id}&start={_D0}&end={_D19}&product=Plan Z",
        headers=headers)
    assert rep3.json()["records"] == []


async def test_admin_edit_delete_assignment(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    rt_id, rec_id = await _setup_tracked_type(client, headers)
    reassign = await client.post(f"/api/v1/records/{rec_id}/assignments", json={
        "employee_name": "Dave", "effective_date": _D0, "business_unit": "Javelin", "cost": 30,
    }, headers=headers)
    aid = reassign.json()["id"]
    upd = await client.put(f"/api/v1/records/{rec_id}/assignments/{aid}", json={"cost": 99}, headers=headers)
    assert upd.status_code == 200 and upd.json()["cost"] == 99
    rec = await client.get(f"/api/v1/records/{rec_id}", headers=headers)
    vals = {v["field_slug"]: v["display_value"] for v in rec.json()["values"]}
    try:
        assert abs(float(vals.get("cost")) - 99.0) < 0.001
    except (TypeError, ValueError):
        assert vals.get("cost") == "99"
    dele = await client.delete(f"/api/v1/records/{rec_id}/assignments/{aid}", headers=headers)
    assert dele.status_code == 204
    rec2 = await client.get(f"/api/v1/records/{rec_id}", headers=headers)
    vals2 = {v["field_slug"]: v["display_value"] for v in rec2.json()["values"]}
    assert vals2.get("assigned_to") == "Alice"  # restored from baseline
