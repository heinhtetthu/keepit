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
    assert dash["by_age"] == {"1-3 yrs": 1} and dash["warranty_expiring_60d"] == 1
    found = (await client.get("/api/v1/search/all", params={"q": "mon-9"}, headers=h)).json()["results"]
    assert any(r["kind"] == "asset" for r in found)
    found = (await client.get("/api/v1/search/all", params={"q": "hla"}, headers=h)).json()["results"]
    assert any(r["kind"] == "employee" for r in found)
    cur = await client.put("/api/v1/settings/currency", json={"default_currency": "mmk", "rates": {"usd": 2100}}, headers=h)
    assert cur.json()["default_currency"] == "MMK" and cur.json()["rates"] == {"USD": 2100.0}
    stamp = cur.json()["rates_updated_at"]["USD"]
    cur = await client.put("/api/v1/settings/currency", json={"default_currency": "MMK", "rates": {"USD": 2100, "THB": 60, "MMK": 1}}, headers=h)
    assert cur.json()["rates"] == {"USD": 2100.0, "THB": 60.0}  # a rate for the base itself is dropped
    assert cur.json()["rates_updated_at"]["USD"] == stamp and "THB" in cur.json()["rates_updated_at"]
    assert (await client.get("/api/v1/settings/currency", headers=h)).json()["rates_updated_at"]["THB"]
    assert (await client.put("/api/v1/settings/currency", json={"default_currency": "MMK", "rates": {"USD": 0}}, headers=h)).status_code in (400, 422)
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


async def test_ai_provider_settings_models_and_test(client, monkeypatch):
    from app.services import ai
    h = await _h(client)
    providers = (await client.get("/api/v1/settings/ai/providers", headers=h)).json()
    ids = [p["id"] for p in providers]
    assert ids[-1] == "custom" and {"openai", "gemini", "anthropic", "xai", "mistral", "deepseek", "groq", "openrouter"} <= set(ids)
    anthropic = next(p for p in providers if p["id"] == "anthropic")
    assert anthropic["base_url"] == "https://api.anthropic.com/v1" and "claude-opus-5-5" in anthropic["models"]

    # A named provider always uses its fixed URL, whatever base_url says.
    saved = (await client.put("/api/v1/settings/ai", json={"provider": "groq", "base_url": "https://evil.example", "model": "llama-3.3-70b-versatile",
                                                            "api_key": "gsk-secret"}, headers=h))
    assert saved.status_code == 200 and "gsk-secret" not in saved.text
    assert saved.json()["provider"] == "groq" and saved.json()["base_url"] == "https://api.groq.com/openai/v1" and saved.json()["has_key"]
    assert (await client.put("/api/v1/settings/ai", json={"provider": "nope", "model": "m"}, headers=h)).status_code in (400, 422)
    bad = await client.put("/api/v1/settings/ai", json={"provider": "custom", "base_url": "http://10.0.0.5/v1", "model": "m"}, headers=h)
    assert bad.status_code in (400, 422)

    calls = []

    class FakeResponse:
        def __init__(self, status, payload):
            self.status_code, self._payload, self.text = status, payload, ""
            self.request = None

        def json(self):
            return self._payload

        def raise_for_status(self):
            if self.status_code >= 400:
                import httpx
                raise httpx.HTTPStatusError("x", request=httpx.Request("GET", "https://x"), response=httpx.Response(self.status_code, json={}))

    class FakeClient:
        def __init__(self, *a, **kw):
            assert kw.get("follow_redirects") is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers):
            calls.append((url, headers["Authorization"]))
            if headers["Authorization"] == "Bearer bad":
                return FakeResponse(401, {})
            return FakeResponse(200, {"data": [{"id": "models/llama-b"}, {"id": "llama-a"}]})

        async def post(self, url, json, headers):
            calls.append((url, headers["Authorization"]))
            return FakeResponse(200, {"choices": [{"message": {"content": "OK"}}]})

    monkeypatch.setattr(ai.httpx, "AsyncClient", FakeClient)
    live = (await client.post("/api/v1/settings/ai/models", json={}, headers=h)).json()
    assert live == {"models": ["llama-a", "llama-b"], "source": "live", "message": None}
    assert calls[-1] == ("https://api.groq.com/openai/v1/models", "Bearer gsk-secret")
    # A just-pasted key for another provider is used without saving it.
    pasted = (await client.post("/api/v1/settings/ai/models", json={"provider": "mistral", "api_key": "bad"}, headers=h)).json()
    assert pasted["source"] == "static" and "mistral-large-latest" in pasted["models"] and "rejected" in pasted["message"]
    assert calls[-1][0] == "https://api.mistral.ai/v1/models"
    ok = (await client.post("/api/v1/settings/ai/test", json={"model": "llama-a"}, headers=h)).json()
    assert ok["ok"] and "llama-a" in ok["message"] and calls[-1][0] == "https://api.groq.com/openai/v1/chat/completions"

    # Custom keeps its own base URL; the old shape without provider still works.
    custom = (await client.put("/api/v1/settings/ai", json={"base_url": "https://llm.example/v1/", "model": "m"}, headers=h)).json()
    assert custom["provider"] == "custom" and custom["base_url"] == "https://llm.example/v1" and custom["has_key"]
    await client.post("/api/v1/settings/ai/models", json={}, headers=h)
    assert calls[-1][0] == "https://llm.example/v1/models"
    cleared = (await client.put("/api/v1/settings/ai", json={"provider": "openai", "model": "gpt-5-mini", "api_key": ""}, headers=h)).json()
    assert cleared["provider"] == "openai" and cleared["base_url"] == "https://api.openai.com/v1"
    assert (await client.post("/api/v1/settings/ai/models", json={}, headers=h)).json()["source"] in ("static", "live")
