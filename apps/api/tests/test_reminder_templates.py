from datetime import date, timedelta, datetime, timezone
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from app.core.exceptions import ValidationException
from app.services import reminder_template as messages

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _objects():
    fields = [NS(id=10, name="Vendor", slug="vendor", field_type="text", active=True, show_in_details=True, options=[]),
              NS(id=11, name="License Key", slug="license_key", field_type="text", active=True, show_in_details=True, options=[]),
              NS(id=12, name="Currency", slug="currency", field_type="select", active=True, show_in_details=True,
                 options=[NS(value="USD", label="US Dollars")])]
    rt = NS(id=1, name="Licenses", slug="licenses", fields=fields, reminder_config=None)
    record = NS(id=123, name="Record A", status="active", values=[
        NS(field_id=10, value={"value": "AT&T <Ops>"}), NS(field_id=11, value={"value": "PRIVATE-KEY"}),
        NS(field_id=12, value={"value": "USD"})])
    return rt, record


async def test_template_tokens_escape_values_defaults_and_missing_fields():
    rt, record = _objects()
    values = messages.context(rt, record, "2028-01-31", 7, date(2028, 1, 24))
    rendered = messages.render('<b>{record_name}</b> {field_10} {field.currency} {{literal}}', values)
    assert rendered["html"] == '<b>Record A</b> AT&amp;T &lt;Ops&gt; US Dollars {literal}'
    assert rendered["text"] == 'Record A AT&T <Ops> US Dollars {literal}'
    default = messages.default_template(rt)
    assert "field_10" in default and "field_11" not in default
    assert "PRIVATE-KEY" not in messages.render(default, values)["text"]
    record.values = []
    assert messages.context(rt, record, "2028-01-31", 7, date(2028, 1, 24))["field_10"] == "—"


@pytest.mark.parametrize("template", [
    "{unknown}", "{record_name.__class__}", "{record_name[0]}", "{record_name!r}", "{record_name:100000}",
    "{record_name", '<script>bad</script>', '<b>missing close', '<b>wrong</i>',
    '<a href="javascript:alert(1)">bad</a>', '<b onclick="alert(1)">bad</b>', '<blockquote><blockquote>x</blockquote></blockquote>',
    "A\x00B", "\ud800",
])
async def test_template_rejects_unsafe_or_invalid_syntax(template):
    rt, record = _objects()
    with pytest.raises(ValidationException):
        messages.render(template, messages.context(rt, record, "2028-01-31", 7, date(2028, 1, 24)))


async def test_template_limits_fallback_and_safe_notice():
    assert messages.render("a" * 4096, {})["length"] == 4096
    with pytest.raises(ValidationException):
        messages.render("🔔" * 2100, {})
    rt, record = _objects()
    record.values[0].value = {"value": "x" * 5000}
    rt.reminder_config = {"message_template": "{field_10}"}
    result = messages.render_message(rt, record, "2028-01-31", 7, date(2028, 1, 24))
    assert "Record A" in result and "field_10" not in result and len(result) < 4096
    assert messages.append_notice("a" * 4096, "\nextra") == "a" * 4096


async def _setup(client):
    from app.db.session import AsyncSessionLocal
    from app.services.clock import app_today
    token = (await client.post("/api/v1/auth/login", json={"identifier": "admin", "password": "admin12345"})).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    response = await client.post("/api/v1/record-types", headers=headers, json={"name": "Dynamic messages", "fields": [
        {"name": "Expiry", "field_type": "date"}, {"name": "Vendor", "field_type": "text"},
        {"name": "Cost", "field_type": "currency"}, {"name": "Currency", "field_type": "select", "options": [{"value": "USD", "label": "US Dollars"}]},
        {"name": "License Key", "field_type": "text"}, {"name": "Auto Renewal", "field_type": "boolean"},
    ]})
    assert response.status_code == 201, response.text
    rt = response.json()
    fields = {f["name"]: f["id"] for f in rt["fields"]}
    await client.put(f"/api/v1/record-types/{rt['id']}", headers=headers, json={"reminder_field_id": fields["Expiry"]})
    async with AsyncSessionLocal() as db:
        today = await app_today(db)
    values = [{"field_id": fields[name], "value": value} for name, value in {
        "Expiry": (today + timedelta(days=7)).isoformat(), "Vendor": "AT&T <Ops>", "Cost": 12.5,
        "Currency": "USD", "License Key": "NEVER-AUTO-INCLUDE", "Auto Renewal": False,
    }.items()]
    response = await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={"name": "Dynamic record", "values": values})
    assert response.status_code == 201, response.text
    return headers, rt, fields, response.json(), values


async def test_type_message_save_preview_reset_and_rule_overrides(client):
    from app.db.session import AsyncSessionLocal
    from app.models import RecordType
    headers, rt, fields, record, _ = await _setup(client)
    endpoint = f"/api/v1/reminders/types/{rt['id']}/message"
    data = (await client.get(endpoint, headers=headers)).json()
    assert data["template"] is None and f"field_{fields['License Key']}" not in data["default_template"]
    async with AsyncSessionLocal() as db:
        stored = await db.get(RecordType, rt["id"])
        stored.reminder_config = {"other_setting": "preserved"}
        await db.commit()
    template = f"<b>{{record_name}}</b> | {{field.vendor}} | {{field_{fields['Cost']}}} | {{days_remaining}}"
    saved = await client.put(endpoint, headers=headers, json={"template": template})
    assert saved.status_code == 200, saved.text
    preview = await client.post(endpoint + "/preview", headers=headers, json={"record_id": record["id"]})
    assert preview.status_code == 200, preview.text
    assert preview.json()["text"] == "Dynamic record | AT&T <Ops> | 12.5 | 7"
    assert "AT&amp;T &lt;Ops&gt;" in preview.json()["html"]
    assert (await client.put(endpoint, headers=headers, json={"template": "{unknown}"})).status_code == 400
    assert (await client.get(endpoint, headers=headers)).json()["template"] == template
    rule = await client.post("/api/v1/reminders/rules", headers=headers, json={
        "record_type_id": rt["id"], "name": "Seven days", "days_before": 7, "template": "Override {record_name}",
    })
    assert rule.status_code == 201, rule.text
    assert (await client.get(endpoint, headers=headers)).json()["rule_overrides"] == 1
    cleared = await client.put(endpoint, headers=headers, json={"template": template, "replace_rule_overrides": True})
    assert cleared.json()["rule_overrides"] == 0
    assert (await client.post("/api/v1/reminders/rules", headers=headers, json={
        "record_type_id": rt["id"], "name": "Invalid", "days_before": 3, "template": "{unknown}",
    })).status_code == 400
    reset = await client.put(endpoint, headers=headers, json={"template": None})
    assert reset.status_code == 200 and reset.json()["template"] is None
    async with AsyncSessionLocal() as db:
        assert (await db.get(RecordType, rt["id"])).reminder_config == {"other_setting": "preserved"}


async def test_scheduled_early_and_legacy_retry_messages_use_dynamic_values(client, monkeypatch):
    from app.db.session import AsyncSessionLocal
    from app.models import ReminderDelivery, ReminderLog
    from app.services.reminder import process_due_reminders
    from app.services.delivery import dispatch_deliveries
    from app.services.notification import notification_service
    headers, rt, fields, record, values = await _setup(client)
    endpoint = f"/api/v1/reminders/types/{rt['id']}/message"
    template = "Custom {record_name}: {field.vendor}"
    await client.put(endpoint, headers=headers, json={"template": template})
    rule = (await client.post("/api/v1/reminders/rules", headers=headers, json={
        "record_type_id": rt["id"], "name": "Seven days", "days_before": 7,
    })).json()
    bot = (await client.post("/api/v1/reminders/bots", headers=headers, json={"name": "Mocked bot", "bot_token": "test-only-placeholder"})).json()
    uid = (await client.get("/api/v1/auth/me", headers=headers)).json()["id"]
    recipient = (await client.post("/api/v1/reminders/recipients", headers=headers, json={
        "display_name": "Test recipient", "telegram_chat_id": "test", "telegram_bot_ids": [bot["id"]], "user_id": uid,
    })).json()
    send = AsyncMock(return_value=(True, None))
    monkeypatch.setattr(notification_service, "send", send)
    async with AsyncSessionLocal() as db:
        await process_due_reminders(db)
        await db.commit()
        queued = (await db.execute(select(ReminderDelivery.message))).scalar_one()
    assert queued == "Custom Dynamic record: AT&amp;T &lt;Ops&gt;"
    send.assert_not_awaited()
    await client.put(endpoint, headers=headers, json={"template": "New {record_name}"})
    await dispatch_deliveries()
    assert send.call_args.args[2] == queued
    async with AsyncSessionLocal() as db:
        db.add(ReminderLog(record_id=record["id"], reminder_rule_id=rule["id"], recipient_id=recipient["id"],
                           scheduled_date=datetime.now(timezone.utc) - timedelta(days=1), status="failed"))
        await db.commit()
        await process_due_reminders(db)
        await db.commit()
        assert "New Dynamic record" in (await db.execute(select(ReminderDelivery.message))).scalars().all()
    await dispatch_deliveries()
    await client.put(f"/api/v1/reminders/rules/{rule['id']}", headers=headers, json={"days_before": 30})
    early = (await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={"name": "Early record", "values": values})).json()
    await client.put(f"/api/v1/records/{early['id']}/renewal-options", headers=headers, json={"renew_before_days": 7})
    await client.put(endpoint, headers=headers, json={"template": "Early {record_name}: {field.vendor}"})
    async with AsyncSessionLocal() as db:
        await process_due_reminders(db)
        await db.commit()
        bodies = (await db.execute(select(ReminderDelivery.message))).scalars().all()
    assert "Early Early record: AT&amp;T &lt;Ops&gt;" in bodies


async def test_message_permissions_and_real_preview_access(client):
    from app.db.session import AsyncSessionLocal
    from app.models import User, Role, Permission, UserRecordTypeAccess
    from app.core.security import hash_password
    headers, rt, _, record, _ = await _setup(client)
    async with AsyncSessionLocal() as db:
        permissions = (await db.execute(select(Permission).where(Permission.name.in_(["reminder.view", "reminder.edit"])))).scalars().all()
        user = User(email="message@example.com", username="message", name="Message editor", hashed_password=hash_password("test-password-only"),
                    roles=[Role(name="Message editor", permissions=list(permissions))])
        db.add(user)
        await db.flush()
        uid = user.id
        await db.commit()
    token = (await client.post("/api/v1/auth/login", json={"identifier": "message", "password": "test-password-only"})).json()["access_token"]
    limited = {"Authorization": f"Bearer {token}"}
    endpoint = f"/api/v1/reminders/types/{rt['id']}/message"
    assert (await client.get(endpoint, headers=limited)).status_code == 403
    assert (await client.put(endpoint, headers=limited, json={"template": "Changed"})).status_code == 403
    async with AsyncSessionLocal() as db:
        db.add(UserRecordTypeAccess(user_id=uid, record_type_id=rt["id"]))
        await db.commit()
    assert (await client.post(endpoint + "/preview", headers=limited, json={})).status_code == 200
    assert (await client.post(endpoint + "/preview", headers=limited, json={"record_id": record["id"]})).status_code == 403
    viewer_role = (await client.get("/api/v1/users/roles", headers=headers)).json()
    viewer = next(r for r in viewer_role if r["name"] == "Records viewer")
    await client.put(f"/api/v1/users/{uid}", headers=headers, json={"role_id": viewer["id"]})
    token = (await client.post("/api/v1/auth/login", json={"identifier": "message", "password": "test-password-only"})).json()["access_token"]
    assert (await client.put(endpoint, headers={"Authorization": f"Bearer {token}"}, json={"template": "Changed"})).status_code == 403
