import pytest
from datetime import date, timedelta

pytestmark = pytest.mark.asyncio(loop_scope="session")
TODAY = date.today()


async def _h(client):
    r = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _upload(client, h, name, data, mime, category="Invoice"):
    r = await client.post("/api/v1/documents", headers=h, files={"file": (name, data, mime)}, data={"category": category})
    assert r.status_code == 201, r.text
    return r.json()


async def test_dashboard_search_settings_and_digest(client, monkeypatch):
    h = await _h(client)
    emp = (await client.post("/api/v1/employees", json={"name": "Hla Hla", "business_units": ["Finance"]}, headers=h)).json()
    await client.post("/api/v1/assets", json={"asset_type": "Monitor", "brand": "LG", "serial_number": "MON-9",
                                              "purchase_date": (TODAY - timedelta(days=800)).isoformat(),
                                              "warranty_end_date": (TODAY + timedelta(days=10)).isoformat(),
                                              "employee_id": emp["id"]}, headers=h)
    dash = (await client.get("/api/v1/dashboard/assets", headers=h)).json()
    assert dash["total"] == 1 and dash["by_business_unit"] == [{"name": "Finance", "count": 1}]
    assert dash["by_age"] == {"1–3 yrs": 1} and dash["warranty_expiring_60d"] == 1
    found = (await client.get("/api/v1/search/all", params={"q": "mon-9"}, headers=h)).json()["results"]
    assert any(r["kind"] == "asset" for r in found)
    found = (await client.get("/api/v1/search/all", params={"q": "hla"}, headers=h)).json()["results"]
    assert any(r["kind"] == "employee" for r in found)
    cur = await client.put("/api/v1/settings/currency", json={"default_currency": "mmk", "rates": {"usd": 2100}}, headers=h)
    assert cur.json() == {"default_currency": "MMK", "rates": {"USD": 2100.0}}
    ai = await client.put("/api/v1/settings/ai", json={"base_url": "https://llm.example/v1", "model": "m", "api_key": "secret"}, headers=h)
    assert ai.status_code == 200 and ai.json()["has_key"] and "secret" not in ai.text
    preview = (await client.post("/api/v1/settings/asset-alerts/preview", headers=h)).json()["message"]
    assert "LG" in preview and "Warranties ending" in preview
    answer = (await client.post("/api/v1/help/chat", json={"messages": [{"role": "user", "content": "Which warranties expire soon?"}]}, headers=h)).json()
    assert "MON-9" in answer["answer"]


async def test_branding(client):
    h = await _h(client)
    pub = (await client.get("/api/v1/branding")).json()  # public, used by the sign-in page
    assert pub["primary_color"] == "#3287f0" and pub["logo_url"] is None and pub["app_name"]
    assert (await client.put("/api/v1/settings/branding", json={"primary_color": "blue"}, headers=h)).status_code == 422
    assert (await client.put("/api/v1/settings/branding", json={"primary_color": "#7C3AED"}, headers=h)).json()["primary_color"] == "#7c3aed"
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    up = await client.put("/api/v1/settings/branding/logo", headers=h, files={"file": ("logo.png", png, "image/png")})
    assert up.status_code == 200 and up.json()["logo_url"].startswith("/api/v1/branding/logo?v=")
    img = await client.get("/api/v1/branding/logo")
    assert img.content == png and "sandbox" in img.headers["content-security-policy"]
    bad = await client.put("/api/v1/settings/branding/favicon", headers=h, files={"file": ("x.svg", b"<svg onload=alert(1)>", "image/svg+xml")})
    assert bad.status_code == 400
    assert (await client.put("/api/v1/settings/branding/logo", files={"file": ("l.png", png, "image/png")})).status_code == 401
    assert (await client.delete("/api/v1/settings/branding/logo", headers=h)).json()["logo_url"] is None
