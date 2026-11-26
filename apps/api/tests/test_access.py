import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _login(client, email="admin@example.com", password="admin12345"):
    resp = await client.post("/api/v1/auth/login", json={"identifier": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _owner_user_id(client, headers) -> int:
    resp = await client.get("/api/v1/users", headers=headers)
    return resp.json()["items"][0]["id"]


async def _create_type(client, headers, name):
    resp = await client.post("/api/v1/record-types", json={
        "name": name,
        "fields": [{"name": "Renewal Date", "field_type": "date"}],
    }, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_limited_user(client, admin_headers, email, extra_permissions=()):
    perms = (await client.get("/api/v1/users/permissions", headers=admin_headers)).json()
    wanted = {"record.view", "record_type.view", "report.export", "reminder.view", "notification.view"}
    wanted.update(extra_permissions)
    permission_ids = [p["id"] for p in perms if p["name"] in wanted]
    role = await client.post("/api/v1/users/roles", json={
        "name": f"Role for {email}", "permission_ids": permission_ids,
    }, headers=admin_headers)
    assert role.status_code == 201, role.text
    user = await client.post("/api/v1/users", json={
        "email": email, "username": email.split("@")[0], "name": "Limited User", "password": "password123",
        "role_id": role.json()["id"],
    }, headers=admin_headers)
    assert user.status_code == 201, user.text
    return user.json()["id"]


async def test_record_type_access_is_enforced(client):
    admin = await _login(client)
    alpha = await _create_type(client, admin, "Alpha Type")
    beta = await _create_type(client, admin, "Beta Type")

    user_id = await _create_limited_user(client, admin, "limited@example.com")

    # No grants yet -> the user sees nothing.
    limited = await _login(client, "limited@example.com", "password123")
    assert (await client.get("/api/v1/record-types", headers=limited)).json() == []

    # Grant access to Alpha only.
    resp = await client.put(f"/api/v1/users/{user_id}/record-type-access", json={
        "record_type_ids": [alpha["id"]],
    }, headers=admin)
    assert resp.status_code == 200
    assert resp.json() == [alpha["id"]]

    visible = await client.get("/api/v1/record-types", headers=limited)
    assert [t["id"] for t in visible.json()] == [alpha["id"]]

    # Granted type works end to end.
    assert (await client.get(f"/api/v1/record-types/{alpha['id']}", headers=limited)).status_code == 200
    assert (await client.get(f"/api/v1/records/by-type/{alpha['id']}", headers=limited)).status_code == 200

    # Ungranted type is blocked everywhere it is exposed.
    assert (await client.get(f"/api/v1/record-types/{beta['id']}", headers=limited)).status_code == 403
    assert (await client.get(f"/api/v1/records/by-type/{beta['id']}", headers=limited)).status_code == 403
    assert (await client.post(f"/api/v1/records/by-type/{beta['id']}", json={
        "name": "Nope", "status": "active", "values": [],
    }, headers=limited)).status_code == 403
    assert (await client.get(f"/api/v1/reports/{beta['id']}/excel", headers=limited)).status_code == 403
    assert (await client.get(f"/api/v1/reports/{beta['id']}/pdf", headers=limited)).status_code == 403

    # Reading access grants back requires user.edit (admin only).
    assert (await client.get(f"/api/v1/users/{user_id}/record-type-access", headers=limited)).status_code == 403
    assert (await client.get(f"/api/v1/users/{user_id}/record-type-access", headers=admin)).json() == [alpha["id"]]

    # Granting an unknown record type is rejected.
    resp = await client.put(f"/api/v1/users/{user_id}/record-type-access", json={
        "record_type_ids": [99999],
    }, headers=admin)
    assert resp.status_code == 404


async def test_superuser_still_sees_everything(client):
    admin = await _login(client)
    await _create_type(client, admin, "Gamma Type")
    types = (await client.get("/api/v1/record-types", headers=admin)).json()
    assert len(types) >= 4  # 3 seeded types + Gamma


async def test_auto_renewal_log_is_scoped_and_excludes_manual_history(client):
    from datetime import date
    from app.db.session import AsyncSessionLocal
    from app.models.record import Record
    from app.models.renewal import RecordRenewal

    admin = await _login(client)
    alpha = await _create_type(client, admin, "Visible Type")
    beta = await _create_type(client, admin, "Hidden Type")
    user_id = await _create_limited_user(client, admin, "renewal-reviewer@example.com", ("audit.view",))
    grant = await client.put(f"/api/v1/users/{user_id}/record-type-access", headers=admin,
                             json={"record_type_ids": [alpha["id"]]})
    assert grant.status_code == 200
    limited = await _login(client, "renewal-reviewer@example.com", "password123")
    profile = (await client.get("/api/v1/auth/me", headers=limited)).json()
    assert "audit.view" in profile["permissions"] and not profile["is_superuser"]
    assert (await client.get("/api/v1/audit-logs", headers=limited)).status_code == 403
    assert (await client.get("/api/v1/audit-logs", headers=admin)).status_code == 200
    assert (await client.get("/api/v1/records/trash", headers=limited)).status_code == 200
    guide = (await client.get("/api/v1/help/guide", headers=limited)).json()
    assert all(section["id"] != "audit" for section in guide)

    async with AsyncSessionLocal() as db, db.begin():
        visible = Record(record_type_id=alpha["id"], name="Visible record")
        hidden = Record(record_type_id=beta["id"], name="Hidden record")
        db.add_all([visible, hidden])
        await db.flush()
        db.add_all([
            RecordRenewal(record_id=visible.id, new_date=date(2027, 1, 1), is_automatic=True),
            RecordRenewal(record_id=hidden.id, new_date=date(2027, 1, 1), is_automatic=True),
            RecordRenewal(record_id=visible.id, new_date=date(2028, 1, 1), notes="Auto-renewed (manual note)"),
        ])

    url = "/api/v1/records/auto-renewals"
    response = await client.get(url, headers=limited)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["record_name"] == "Visible record"
    assert (await client.get(url, headers=limited, params={"search": "Hidden"})).json()["total"] == 0
    admin_page = (await client.get(url, headers=admin, params={"page_size": 1})).json()
    assert admin_page["total"] == 2
    assert admin_page["total_pages"] == 2
    assert len(admin_page["items"]) == 1


async def test_telegram_bot_crud_and_recipient_link(client):
    admin = await _login(client)
    raw_token = "111111:AA-token"

    created = await client.post("/api/v1/reminders/bots", json={
        "name": "Main Bot", "bot_token": raw_token,
    }, headers=admin)
    assert created.status_code == 201, created.text
    bot_id = created.json()["id"]
    # The raw token never leaves the API.
    assert raw_token not in created.json()["bot_token"]
    assert created.json()["bot_token"].endswith(raw_token[-4:])

    # Duplicate bot names are rejected.
    conflict = await client.post("/api/v1/reminders/bots", json={
        "name": "Main Bot", "bot_token": "222222:BBB-token",
    }, headers=admin)
    assert conflict.status_code == 409

    bots = (await client.get("/api/v1/reminders/bots", headers=admin)).json()
    assert [b["id"] for b in bots] == [bot_id]
    assert bots[0]["bot_token"].endswith(raw_token[-4:])

    recipient = await client.post("/api/v1/reminders/recipients", json={
        "display_name": "Allen", "telegram_chat_id": "555", "telegram_bot_ids": [bot_id],
        "user_id": await _owner_user_id(client, admin),
    }, headers=admin)
    assert recipient.status_code == 201, recipient.text
    assert recipient.json()["telegram_bot_names"] == ["Main Bot"]

    listed = (await client.get("/api/v1/reminders/recipients", headers=admin)).json()
    assert listed[0]["telegram_bot_ids"] == [bot_id]
    assert listed[0]["telegram_bot_names"] == ["Main Bot"]

    # Recipients must belong to a user.
    no_owner = await client.post("/api/v1/reminders/recipients", json={
        "display_name": "Ownerless", "telegram_chat_id": "557", "telegram_bot_ids": [bot_id],
    }, headers=admin)
    assert no_owner.status_code == 422, no_owner.text

    # Recipients pointing at a missing bot are rejected.
    missing = await client.post("/api/v1/reminders/recipients", json={
        "display_name": "Ghost", "telegram_chat_id": "556", "telegram_bot_ids": [99999],
        "user_id": await _owner_user_id(client, admin),
    }, headers=admin)
    assert missing.status_code == 404

    # Sending the masked token back means "keep the existing token".
    updated = await client.put(f"/api/v1/reminders/bots/{bot_id}", json={
        "active": False, "bot_token": bots[0]["bot_token"],
    }, headers=admin)
    assert updated.status_code == 200
    assert updated.json()["active"] is False
    assert (await client.get("/api/v1/reminders/bots", headers=admin)).json()[0]["bot_token"].endswith(raw_token[-4:])

    assert (await client.delete(f"/api/v1/reminders/bots/{bot_id}", headers=admin)).status_code == 204
    assert (await client.get("/api/v1/reminders/bots", headers=admin)).json() == []


async def test_record_type_can_pin_a_reminder_bot(client):
    admin = await _login(client)
    bot = await client.post("/api/v1/reminders/bots", json={
        "name": "Type Bot", "bot_token": "333333:CCC-token",
    }, headers=admin)
    bot_id = bot.json()["id"]

    created = await client.post("/api/v1/record-types", json={
        "name": "Pinned Type",
        "telegram_bot_id": bot_id,
        "fields": [{"name": "Renewal Date", "field_type": "date"}],
    }, headers=admin)
    assert created.status_code == 201, created.text
    assert created.json()["telegram_bot_id"] == bot_id

    cleared = await client.put(f"/api/v1/record-types/{created.json()['id']}", json={
        "telegram_bot_id": None,
    }, headers=admin)
    assert cleared.status_code == 200
    assert cleared.json()["telegram_bot_id"] is None

    missing_bot = await client.put(f"/api/v1/record-types/{created.json()['id']}", json={
        "telegram_bot_id": 99999,
    }, headers=admin)
    assert missing_bot.status_code == 404
