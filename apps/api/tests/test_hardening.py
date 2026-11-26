import asyncio
from datetime import datetime, timedelta, timezone
from io import BytesIO
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, func, update

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def login(client, identifier="admin@example.com", password="admin12345"):
    response = await client.post("/api/v1/auth/login", json={"identifier": identifier, "password": password})
    assert response.status_code == 200, response.text
    tokens = response.json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}, tokens


async def make_type(client, headers, name="Secure type", fields=None):
    response = await client.post("/api/v1/record-types", headers=headers, json={
        "name": name, "fields": fields or [{"name": "Expiry", "field_type": "date"}],
    })
    assert response.status_code == 201, response.text
    return response.json()


async def test_session_rotation_reuse_logout_and_password_revocation(client):
    from app.core.security import decode_token
    headers, old = await login(client)
    response = await client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]})
    assert response.status_code == 200, response.text
    new = response.json()
    assert new["refresh_token"] != old["refresh_token"]
    assert decode_token(new["refresh_token"])["exp"] == decode_token(old["refresh_token"])["exp"]
    # A lost refresh response or concurrent browser tab recovers the same
    # current credential without rotating again or extending the lifetime.
    recovered = await client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]})
    assert recovered.status_code == 200
    assert recovered.json()["refresh_token"] == new["refresh_token"]
    concurrent = await asyncio.gather(*[
        client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]})
        for _ in range(4)
    ])
    assert all(r.status_code == 200 for r in concurrent)
    assert {r.json()["refresh_token"] for r in concurrent} == {new["refresh_token"]}
    from app.db.session import AsyncSessionLocal
    from app.models.session import AuthSession
    async with AsyncSessionLocal() as db:
        await db.execute(update(AuthSession).where(AuthSession.id == decode_token(new["refresh_token"])["sid"]).values(
            refresh_issued_at=datetime.now(timezone.utc) - timedelta(seconds=6),
        ))
        await db.commit()
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]})).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {new['access_token']}"})).status_code == 401
    headers, tokens = await login(client)
    assert (await client.post("/api/v1/auth/logout", headers=headers)).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})).status_code == 401
    headers, tokens = await login(client)
    assert (await client.put("/api/v1/users/me/password", headers=headers, json={
        "current_password": "admin12345", "new_password": "changed-password-123",
    })).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})).status_code == 401


async def test_cookie_refresh_and_origin_check(client):
    response = await client.post("/api/v1/auth/login", json={"identifier": "admin", "password": "admin12345"})
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie
    assert response.headers["cache-control"] == "no-store"
    assert (await client.post("/api/v1/auth/refresh", json={})).status_code == 200
    assert (await client.post("/api/v1/auth/refresh", headers={"Origin": "https://attacker.invalid"}, json={})).status_code == 403


async def test_authorization_and_field_validation(client):
    admin, _ = await login(client)
    rt = await make_type(client, admin, fields=[{"name": "Amount", "field_type": "integer", "required": True}])
    other = await make_type(client, admin, "Other type")
    perms = (await client.get("/api/v1/users/permissions", headers=admin)).json()
    role = (await client.post("/api/v1/users/roles", headers=admin, json={
        "name": "User manager", "permission_ids": [p["id"] for p in perms if p["name"] in {
            "user.view", "user.create", "user.edit", "report.view", "record.view", "record.edit",
        }],
    })).json()
    user = await client.post("/api/v1/users", headers=admin, json={
        "name": "Manager", "email": "manager@example.com", "username": "manager",
        "password": "password123", "role_id": role["id"],
    })
    uid = user.json()["id"]
    limited, _ = await login(client, "manager", "password123")
    assert (await client.get(f"/api/v1/reports/allocation?record_type_id={rt['id']}&start=2026-01-01&end=2026-12-31", headers=limited)).status_code == 403
    assert (await client.post("/api/v1/users/roles", headers=limited, json={"name": "Escalation"})).status_code == 403
    assert (await client.put(f"/api/v1/users/{uid}", headers=limited, json={"role_id": role["id"]})).status_code == 403
    assert (await client.put(f"/api/v1/users/{uid}", headers=limited, json={"password": "newpassword123"})).status_code == 403
    assert (await client.put(f"/api/v1/users/{uid}/record-type-access", headers=limited, json={"record_type_ids": [rt["id"]]})).status_code == 403
    field = rt["fields"][0]["id"]
    created = await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=admin, json={
        "name": "Record", "values": [{"field_id": field, "value": 5}],
    })
    assert created.status_code == 201, created.text
    record_id = created.json()["id"]
    for values in ([{"field_id": other["fields"][0]["id"], "value": "2026-01-01"}],
                   [{"field_id": field, "value": "not a number"}],
                   [{"field_id": field, "value": None}],
                   [{"field_id": field, "value": 1}, {"field_id": field, "value": 2}]):
        assert (await client.put(f"/api/v1/records/{record_id}", headers=admin, json={"values": values})).status_code == 400
    # Exactly one of two writers using the same version may save.
    version = created.json()["updated_at"]
    results = await asyncio.gather(*[client.put(f"/api/v1/records/{record_id}", headers=admin, json={
        "expected_updated_at": version, "name": f"Writer {i}",
    }) for i in range(2)])
    assert sorted(r.status_code for r in results) == [200, 409]


async def queue_reminder(client):
    from app.db.session import AsyncSessionLocal
    from app.services.clock import app_today
    from app.services.reminder import process_due_reminders
    admin, _ = await login(client)
    rt = await make_type(client, admin)
    await client.put(f"/api/v1/record-types/{rt['id']}", headers=admin,
                     json={"reminder_field_id": rt["fields"][0]["id"]})
    async with AsyncSessionLocal() as db:
        today = await app_today(db)
    await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=admin, json={
        "name": "Due", "values": [{"field_id": rt["fields"][0]["id"], "value": (today + timedelta(days=7)).isoformat()}],
    })
    await client.post("/api/v1/reminders/rules", headers=admin, json={
        "name": "Seven days", "record_type_id": rt["id"], "days_before": 7,
    })
    bot = (await client.post("/api/v1/reminders/bots", headers=admin, json={
        "name": "Test bot", "bot_token": "test-only-placeholder",
    })).json()
    user = (await client.get("/api/v1/auth/me", headers=admin)).json()
    await client.post("/api/v1/reminders/recipients", headers=admin, json={
        "display_name": "Admin", "telegram_chat_id": "test", "telegram_bot_ids": [bot["id"]], "user_id": user["id"],
    })
    async with AsyncSessionLocal() as db:
        await process_due_reminders(db)
        await db.commit()
        await process_due_reminders(db)
        await db.commit()


async def test_outbox_is_durable_and_claimed_once(client, monkeypatch):
    from app.db.session import AsyncSessionLocal
    from app.models.delivery import ReminderDelivery
    from app.models.reminder import ReminderLog
    from app.services.delivery import dispatch_deliveries
    from app.services.notification import notification_service
    send = AsyncMock(return_value=(True, None))
    monkeypatch.setattr(notification_service, "send", send)
    await queue_reminder(client)
    send.assert_not_awaited()
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count(ReminderDelivery.id)))).scalar() == 1
    # A provider exception is persisted as a retry without holding a DB lock.
    send.side_effect = RuntimeError("worker interrupted")
    await dispatch_deliveries()
    async with AsyncSessionLocal() as db:
        from datetime import datetime, timezone, timedelta
        job = (await db.execute(select(ReminderDelivery))).scalar_one()
        assert job.status == 'retry'
        job.available_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()
    send.side_effect = None
    send.reset_mock()
    await asyncio.gather(dispatch_deliveries(), dispatch_deliveries())
    assert send.await_count == 1
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(ReminderLog.status))).scalar() == "sent"
    await dispatch_deliveries()
    assert send.await_count == 1


async def test_outbox_backoff_and_cancelled_recipient(client, monkeypatch):
    from app.db.session import AsyncSessionLocal
    from app.models.delivery import ReminderDelivery
    from app.models.reminder import NotificationRecipient
    from app.services.delivery import dispatch_deliveries
    from app.services.notification import notification_service
    send = AsyncMock(return_value=(False, "provider unavailable"))
    monkeypatch.setattr(notification_service, "send", send)
    await queue_reminder(client)
    await dispatch_deliveries()
    await dispatch_deliveries()
    assert send.await_count == 1
    async with AsyncSessionLocal() as db:
        await db.execute(update(ReminderDelivery).values(available_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.execute(update(NotificationRecipient).values(active=False))
        await db.commit()
    await dispatch_deliveries()
    assert send.await_count == 1
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(ReminderDelivery.status))).scalar() == "cancelled"
        # Deleting a bot must retain its job so it can be cancelled, not leave
        # the parent reminder permanently pending after an ON DELETE CASCADE.
        from app.models.reminder import TelegramBot
        log_id = (await db.execute(select(ReminderDelivery.log_id))).scalar()
        bot = TelegramBot(name="Deleted bot", bot_token="test-only-placeholder", active=True)
        db.add(bot)
        await db.flush()
        db.add(ReminderDelivery(log_id=log_id, bot_id=bot.id, message="Test", available_at=datetime.now(timezone.utc)))
        await db.flush()
        await db.delete(bot)
        await db.commit()
    await dispatch_deliveries()
    assert send.await_count == 1
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count(ReminderDelivery.id)))).scalar() == 2
        assert set((await db.execute(select(ReminderDelivery.status))).scalars()) == {"cancelled"}


async def test_expired_lease_reclaimed_and_stale_claim_cannot_send(client, monkeypatch):
    from app.db.session import AsyncSessionLocal
    from app.models.delivery import ReminderDelivery
    from app.services.delivery import claim_jobs, deliver_claim
    from app.services.notification import notification_service
    await queue_reminder(client)
    first = (await claim_jobs(1))[0]
    assert not await claim_jobs(1)
    async with AsyncSessionLocal() as db:
        await db.execute(update(ReminderDelivery).values(leased_until=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()
    second = (await claim_jobs(1))[0]
    assert first[0] == second[0] and first[1] != second[1]
    send = AsyncMock(return_value=(True, None))
    monkeypatch.setattr(notification_service, 'send', send)
    assert await deliver_claim(*first) == (0, 0)
    send.assert_not_awaited()
    assert await deliver_claim(*second) == (1, 0)
    assert send.await_count == 1


async def test_timezone_dashboard_and_bulk_import(client):
    from app.db.session import AsyncSessionLocal
    from app.services.clock import app_today
    admin, _ = await login(client)
    assert (await client.put("/api/v1/settings", headers=admin, json={"timezone": "Invalid/Zone"})).status_code == 422
    await client.put("/api/v1/settings", headers=admin, json={"timezone": "Asia/Yangon"})
    async with AsyncSessionLocal() as db:
        assert str(await app_today(db, datetime(2026, 1, 1, 20, tzinfo=timezone.utc))) == "2026-01-02"
        today = await app_today(db)
    rt = await make_type(client, admin)
    await client.put(f"/api/v1/record-types/{rt['id']}", headers=admin, json={"reminder_field_id": rt["fields"][0]["id"]})
    content = "Name,Expiry\n" + "\n".join(f"Imported {i},{today.isoformat()}" for i in range(510))
    response = await client.post(f"/api/v1/record-types/{rt['id']}/import/commit", headers=admin,
                                 files={"file": ("records.csv", content, "text/csv")})
    assert response.status_code == 200, response.text
    assert response.json()["created"] == 510
    dashboard = await client.get("/api/v1/dashboard", headers=admin)
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["renewing_this_week"] >= 510
    assert len(dashboard.json()["upcoming_renewals"]) == 10
    search = await client.get("/api/v1/search", headers=admin, params={"q": "Imported", "limit_per_type": 8})
    assert search.status_code == 200, search.text
    assert len([r for r in search.json()["results"] if r["kind"] == "record"]) == 8
    # Reporting a tracked type must not persist baseline ownership on GET.
    await client.put(f"/api/v1/record-types/{rt['id']}", headers=admin, json={"track_ownership": True})
    from app.models.assignment import RecordAssignment
    async with AsyncSessionLocal() as db:
        before = (await db.execute(select(func.count(RecordAssignment.id)))).scalar()
    report = await client.get("/api/v1/reports/allocation", headers=admin, params={
        "record_type_id": rt["id"], "start": today.isoformat(), "end": today.isoformat(),
    })
    assert report.status_code == 200, report.text
    async with AsyncSessionLocal() as db:
        assert (await db.execute(select(func.count(RecordAssignment.id)))).scalar() == before
    from app.services.import_records import read_tabular, MAX_IMPORT_ROWS
    from app.core.exceptions import ValidationException
    from fastapi import UploadFile
    with pytest.raises(ValidationException):
        read_tabular(UploadFile(filename="large.csv", file=BytesIO(("Name\n" + "row\n" * (MAX_IMPORT_ROWS + 1)).encode())))
