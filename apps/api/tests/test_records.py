import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _login(client):
    from app.seed import seed
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await seed(db)
    resp = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    return resp.json()["access_token"]


async def test_create_record_type(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.post("/api/v1/record-types", json={
        "name": "Insurance",
        "description": "Insurance policies",
        "fields": [
            {"name": "Policy Number", "field_type": "text", "required": True},
            {"name": "Expiry Date", "field_type": "date", "required": True},
        ],
    }, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Insurance"
    fields = {field["name"]: field for field in data["fields"]}
    assert data["reminder_field_id"] == fields["Expiry Date"]["id"]
    assert fields["Auto Renewal"]["field_type"] == "boolean"
    assert len(fields) == 3


async def test_create_record(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    rt_resp = await client.post("/api/v1/record-types", json={
        "name": "Test Type",
        "fields": [{"name": "Field1", "field_type": "text", "required": True}],
    }, headers=headers)
    rt_id = rt_resp.json()["id"]
    field_id = rt_resp.json()["fields"][0]["id"]
    resp = await client.post(f"/api/v1/records/by-type/{rt_id}", json={
        "name": "Test Record",
        "status": "active",
        "values": [{"field_id": field_id, "value": "test value"}],
    }, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Record"


async def test_list_records(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    rt_resp = await client.post("/api/v1/record-types", json={
        "name": "Test Type",
        "fields": [{"name": "Field1", "field_type": "text"}],
    }, headers=headers)
    rt_id = rt_resp.json()["id"]
    resp = await client.get(f"/api/v1/records/by-type/{rt_id}", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "total" in data


async def test_archive_record(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    rt_resp = await client.post("/api/v1/record-types", json={
        "name": "Test Type",
        "fields": [{"name": "Field1", "field_type": "text"}],
    }, headers=headers)
    rt_id = rt_resp.json()["id"]
    field_id = rt_resp.json()["fields"][0]["id"]
    rec_resp = await client.post(f"/api/v1/records/by-type/{rt_id}", json={
        "name": "Test Record",
        "values": [{"field_id": field_id, "value": "test"}],
    }, headers=headers)
    rec_id = rec_resp.json()["id"]
    resp = await client.post(f"/api/v1/records/{rec_id}/archive", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["archived"] is True
