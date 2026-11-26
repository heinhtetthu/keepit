import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _login(client):
    from app.seed import seed
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await seed(db)
    resp = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    return resp.json()["access_token"]


async def test_excel_export(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    rt_resp = await client.post("/api/v1/record-types", json={
        "name": "Test Type",
        "fields": [{"name": "Field1", "field_type": "text", "show_in_reports": True}],
    }, headers=headers)
    rt_id = rt_resp.json()["id"]
    resp = await client.get(f"/api/v1/reports/{rt_id}/excel", headers=headers)
    assert resp.status_code == 200
    assert "spreadsheet" in resp.headers.get("content-type", "")


async def test_pdf_export(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    rt_resp = await client.post("/api/v1/record-types", json={
        "name": "Test Type",
        "fields": [{"name": "Field1", "field_type": "text", "show_in_reports": True}],
    }, headers=headers)
    rt_id = rt_resp.json()["id"]
    resp = await client.get(f"/api/v1/reports/{rt_id}/pdf", headers=headers)
    assert resp.status_code == 200
    assert "pdf" in resp.headers.get("content-type", "")
