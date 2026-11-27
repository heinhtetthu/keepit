"""Asset report endpoint: column types and filtered CSV export (needs the test database)."""
import json

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _login(client):
    r = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _asset(client, h, **kw):
    body = {"asset_type": "Laptop", "brand": "Dell", "model": "Latitude", "serial_number": "SN-1", "purchase_date": "2025-01-10", **kw}
    r = await client.post("/api/v1/assets", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def test_report_column_types_and_filtered_csv(client):
    h = await _login(client)
    await _asset(client, h, purchase_cost="900", location="Yangon")
    await _asset(client, h, serial_number="SN-2", asset_type="Monitor", brand="LG", model="27UL", purchase_cost="200", location="Mandalay")
    inv = (await client.get("/api/v1/reports/assets/inventory", headers=h)).json()
    types = {c["key"]: c["type"] for c in inv["columns"]}
    assert types["type"] == "choice" and types["purchased"] == "date" and types["cost"] == "money" and types["asset"] == "text"
    assert len(inv["rows"]) == 2

    params = {"format": "csv", "filters": json.dumps({"type": {"in": ["Monitor"]}}), "columns": "asset,location,cost"}
    r = await client.get("/api/v1/reports/assets/inventory", params=params, headers=h)
    lines = r.text.splitlines()
    assert r.status_code == 200 and lines[0] == "Asset,Location,Cost" and len(lines) == 2 and "Mandalay" in lines[1]

    r = await client.get("/api/v1/reports/assets/inventory", params={"search": "yangon", "sort": "cost", "order": "desc"}, headers=h)
    assert [x["location"] for x in r.json()["rows"]] == ["Yangon"]
    r = await client.get("/api/v1/reports/assets/inventory", params={"filters": json.dumps({"cost": {"gte": "100"}}), "sort": "cost", "order": "desc"}, headers=h)
    assert [x["cost"] for x in r.json()["rows"]] == [900.0, 200.0]

    assert (await client.get("/api/v1/reports/assets/inventory", params={"filters": "not json"}, headers=h)).status_code in (400, 422)
    assert (await client.get("/api/v1/reports/assets/inventory", params={"filters": "[1]"}, headers=h)).status_code in (400, 422)
