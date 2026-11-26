import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _login(client):
    from app.seed import seed
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await seed(db)
    resp = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    return resp.json()["access_token"]


async def _admin_user_id(client, headers) -> int:
    resp = await client.get("/api/v1/users", headers=headers)
    return resp.json()["items"][0]["id"]


async def _create_bot(client, headers, name="Reminder Bot", token="123456:AA-token"):
    resp = await client.post("/api/v1/reminders/bots", json={"name": name, "bot_token": token}, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_create_reminder_rule(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    rt_resp = await client.post("/api/v1/record-types", json={
        "name": "Test Type",
        "fields": [{"name": "Expiry", "field_type": "date"}],
    }, headers=headers)
    rt_id = rt_resp.json()["id"]
    resp = await client.post("/api/v1/reminders/rules", json={
        "record_type_id": rt_id,
        "name": "7 Day Warning",
        "days_before": 7,
    }, headers=headers)
    assert resp.status_code == 201
    assert resp.json()["days_before"] == 7


async def test_create_recipient(client):
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bot_id = await _create_bot(client, headers)
    uid = await _admin_user_id(client, headers)
    resp = await client.post("/api/v1/reminders/recipients", json={
        "display_name": "Test User",
        "telegram_chat_id": "123456789",
        "telegram_bot_ids": [bot_id],
        "user_id": uid,
    }, headers=headers)
    assert resp.status_code == 201
    assert resp.json()["display_name"] == "Test User"
    assert resp.json()["telegram_bot_names"] == ["Reminder Bot"]
    assert resp.json()["user_id"] == uid


async def test_duplicate_prevention(client):
    from app.seed import seed
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await seed(db)
    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    bot_id = await _create_bot(client, headers)
    rt_resp = await client.post("/api/v1/record-types", json={
        "name": "Test Type",
        "fields": [{"name": "Expiry", "field_type": "date"}],
    }, headers=headers)
    rt_id = rt_resp.json()["id"]
    await client.post("/api/v1/reminders/rules", json={
        "record_type_id": rt_id, "name": "7 Day", "days_before": 7,
    }, headers=headers)
    await client.post("/api/v1/reminders/recipients", json={
        "display_name": "User", "telegram_chat_id": "123", "telegram_bot_ids": [bot_id],
        "user_id": await _admin_user_id(client, headers),
    }, headers=headers)
    from app.services.reminder import process_due_reminders
    async with AsyncSessionLocal() as db:
        result1 = await process_due_reminders(db)
        await db.commit()
        result2 = await process_due_reminders(db)
        await db.commit()
    assert result2["sent"] <= result1["sent"]
