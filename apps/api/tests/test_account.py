import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _login(client, password="admin12345"):
    r = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": password})
    return r


async def test_password_reset_flow(client, monkeypatch):
    sent = {}

    async def fake_send(to, subject, html, text):
        sent["to"], sent["text"] = to, text
        return True
    monkeypatch.setattr("app.api.v1.account.send_email", fake_send)
    r = await client.post("/api/v1/auth/password-reset/request", json={"email": "nobody@example.com"})
    assert r.status_code == 200 and not sent
    r = await client.post("/api/v1/auth/password-reset/request", json={"email": "ADMIN@example.com"})
    assert r.status_code == 200 and sent["to"] == "admin@example.com"
    token = sent["text"].split("token=")[1].split()[0]
    old = (await _login(client)).json()["access_token"]
    bad = await client.post("/api/v1/auth/password-reset/confirm", json={"token": "x" * 30, "password": "new-password-123"})
    assert bad.status_code == 400
    ok = await client.post("/api/v1/auth/password-reset/confirm", json={"token": token, "password": "new-password-123"})
    assert ok.status_code == 200
    # token is single use, old sessions are revoked, new password works
    again = await client.post("/api/v1/auth/password-reset/confirm", json={"token": token, "password": "other-password-123"})
    assert again.status_code == 400
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {old}"})).status_code == 401
    assert (await _login(client, "new-password-123")).status_code == 200


async def test_api_tokens(client):
    h = {"Authorization": f"Bearer {(await _login(client)).json()['access_token']}"}
    created = await client.post("/api/v1/api-tokens", json={"name": "MCP"}, headers=h)
    assert created.status_code == 201
    token = created.json()["token"]
    assert token.startswith("rnw_")
    th = {"Authorization": f"Bearer {token}"}
    me = await client.get("/api/v1/auth/me", headers=th)
    assert me.status_code == 200 and me.json()["email"] == "admin@example.com"
    assert (await client.get("/api/v1/assets", headers=th)).status_code == 200
    listed = (await client.get("/api/v1/api-tokens", headers=h)).json()
    assert listed[0]["name"] == "MCP" and "token" not in listed[0]
    assert (await client.delete(f"/api/v1/api-tokens/{created.json()['id']}", headers=h)).status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=th)).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer rnw_bogus"})).status_code == 401


async def test_passkey_options(client):
    h = {"Authorization": f"Bearer {(await _login(client)).json()['access_token']}"}
    reg = await client.post("/api/v1/passkeys/register/options", headers=h)
    assert reg.status_code == 200 and reg.json()["options"]["rp"]["id"] == "localhost"
    login = await client.post("/api/v1/auth/passkey/options")
    assert login.status_code == 200 and login.json()["options"]["challenge"]
    bad = await client.post("/api/v1/auth/passkey/verify", json={"challenge_id": login.json()["challenge_id"],
                                                                 "credential": {"id": "nope"}})
    assert bad.status_code == 401
    assert (await client.get("/api/v1/passkeys", headers=h)).json() == []
    me = (await client.get("/api/v1/auth/me", headers=h)).json()
    assert me["must_change_password"] is False
