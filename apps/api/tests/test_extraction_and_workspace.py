import json
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


@pytest.fixture
def storage(tmp_path):
    from app.services.documents.storage import LocalStorage, set_storage
    set_storage(LocalStorage(str(tmp_path)))
    yield
    set_storage(None)


@pytest.fixture
def fake_ai(monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "AI_API_KEY", "test-key")
    monkeypatch.setattr(get_settings(), "AI_MODEL", "test-model")
    calls = []

    def install(reply: dict):
        async def fake(cfg, messages, **kw):
            calls.append(messages)
            return json.dumps(reply)
        monkeypatch.setattr("app.services.extraction.service.chat_completion", fake)
    install.calls = calls
    return install


async def test_invoice_extraction_creates_asset(client, storage, fake_ai):
    h = await _h(client)
    doc = await _upload(client, h, "inv.txt", b"Invoice 42 from Shop. Dell XPS 13 serial ABC123, 1,250.00 USD, 2026-01-05", "text/plain")
    fake_ai({"fields": {"vendor": "Shop", "brand": "Dell", "model": "XPS 13", "serialNumber": "ABC123",
                        "purchaseDate": "2026-01-05", "purchasePrice": "1,250.00", "currency": "USD", "warrantyEndDate": "Jan 2027"},
             "confidence": {"brand": 0.98}, "notes": "ok"})
    run = await client.post("/api/v1/extraction/runs", json={"document_id": doc["id"], "doc_type": "invoice"}, headers=h)
    assert run.status_code == 200, run.text
    body = run.json()
    assert body["status"] == "success"
    assert body["result"]["fields"]["purchasePrice"] == "1250.00"
    assert body["result"]["fields"]["warrantyEndDate"] is None  # not ISO -> dropped
    assert "Dell XPS 13" in json.dumps(fake_ai.calls[0])  # document text sent
    # nothing written before confirmation
    assert (await client.get("/api/v1/assets", headers=h)).json()["total"] == 0
    missing = await client.post(f"/api/v1/extraction/runs/{body['id']}/confirm", json={"values": body["result"]["fields"], "target": {}}, headers=h)
    assert missing.status_code == 400
    ok = await client.post(f"/api/v1/extraction/runs/{body['id']}/confirm",
                           json={"values": body["result"]["fields"], "target": {"create_asset": {"asset_type": "Laptop"}}}, headers=h)
    assert ok.status_code == 200, ok.text
    asset = (await client.get(f"/api/v1/assets/{ok.json()['asset_id']}", headers=h)).json()
    assert asset["serial_number"] == "ABC123" and asset["purchase_cost"] == "1250.00" and asset["supplier"] == "Shop"
    linked = (await client.get("/api/v1/documents", params={"entity_type": "asset", "entity_id": asset["id"]}, headers=h)).json()
    assert linked["total"] == 1
    again = await client.post(f"/api/v1/extraction/runs/{body['id']}/confirm", json={"values": {}, "target": {"asset_id": asset["id"]}}, headers=h)
    assert again.status_code == 400


async def test_log_sheet_rows(client, storage, fake_ai):
    h = await _h(client)
    a = (await client.post("/api/v1/assets", json={"asset_type": "Laptop", "serial_number": "LS-1"}, headers=h)).json()
    doc = await _upload(client, h, "log.csv", b"type,serial,date\nrepair,LS-1,2026-02-01", "text/csv", "Report")
    fake_ai({"rows": [
        {"logType": "repair", "serialNumber": "ls-1", "date": "2026-02-01", "issue": "Fan noise", "cost": "30"},
        {"logType": "borrow", "itemName": "Projector", "borrowerName": "Guest", "date": "2026-02-02", "returnedDate": "2026-02-03"},
        {"logType": "repair", "serialNumber": "UNKNOWN", "date": "2026-02-01", "issue": "x"},
    ]})
    run = (await client.post("/api/v1/extraction/runs", json={"document_id": doc["id"], "doc_type": "log-sheet"}, headers=h)).json()
    assert len(run["result"]["rows"]) == 3
    ok = (await client.post(f"/api/v1/extraction/runs/{run['id']}/confirm", json={"values": {"rows": run["result"]["rows"]}}, headers=h)).json()
    assert ok["created"] == {"repair": 1, "maintenance": 0, "borrow": 1} and ok["skipped_rows"] == [3]
    detail = (await client.get(f"/api/v1/assets/{a['id']}", headers=h)).json()
    assert detail["repairs"][0]["issue"] == "Fan noise"
    returned = (await client.get("/api/v1/borrows", params={"status": "returned"}, headers=h)).json()
    assert returned["total"] == 1


async def test_extraction_failure_and_reject(client, storage, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "AI_API_KEY", "")
    monkeypatch.setattr(get_settings(), "OPENAI_API_KEY", "")
    h = await _h(client)
    doc = await _upload(client, h, "w.txt", b"warranty", "text/plain", "Warranty")
    run = (await client.post("/api/v1/extraction/runs", json={"document_id": doc["id"], "doc_type": "warranty"}, headers=h)).json()
    assert run["status"] == "failed" and "not configured" in run["error"]
    types = (await client.get("/api/v1/extraction/doc-types", headers=h)).json()
    assert {t["key"] for t in types} >= {"invoice", "repair", "log-sheet"}


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
