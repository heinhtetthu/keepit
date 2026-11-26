"""Renew-before-expiry behaviour (per-record lead days + auto-renew engine)."""
from datetime import date, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _login(client):
    from app.seed import seed
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await seed(db)
    resp = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    return resp.json()["access_token"]


async def _setup(client, headers, auto_renew: bool, expiry_offset: int = 7):
    """A record type + record with the renewal machinery the engine looks for."""
    rt_resp = await client.post("/api/v1/record-types", json={
        "name": "Early Renew Type",
        "fields": [
            {"name": "Label", "field_type": "text", "required": True},
            {"name": "Expiry Date", "field_type": "date", "required": True},
            {"name": "Auto Renewal", "field_type": "boolean"},
            {"name": "Billing Cycle", "field_type": "text"},
        ],
    }, headers=headers)
    rt = rt_resp.json()
    fmap = {f["name"]: f["id"] for f in rt["fields"]}

    # The engine/reminder worker only look at the type's reminder (expiry)
    # field; point it at Expiry Date like production types do.
    from app.models.record_type import RecordType
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        rt_obj = await db.get(RecordType, rt["id"])
        rt_obj.reminder_field_id = fmap["Expiry Date"]
        await db.commit()

    expiry = (date.today() + timedelta(days=expiry_offset)).isoformat()
    values = [
        {"field_id": fmap["Label"], "value": "widget"},
        {"field_id": fmap["Expiry Date"], "value": expiry},
        {"field_id": fmap["Auto Renewal"], "value": auto_renew},
        {"field_id": fmap["Billing Cycle"], "value": "Yearly"},
    ]
    rec_resp = await client.post(f"/api/v1/records/by-type/{rt['id']}", json={
        "name": "Early Renew Record", "status": "active", "values": values,
    }, headers=headers)
    record = rec_resp.json()

    opt_resp = await client.put(f"/api/v1/records/{record['id']}/renewal-options",
                                json={"renew_before_days": 14}, headers=headers)
    assert opt_resp.status_code == 200
    assert opt_resp.json()["renew_before_days"] == 14
    return record, fmap


async def test_auto_renew_on_expiry_uses_explicit_cycle_or_yearly_default(client):
    from app.db.session import AsyncSessionLocal
    from app.models.renewal import RecordRenewal
    from app.services.clock import app_today
    from app.services.record import _add_months, auto_renew_due_records

    headers = {"Authorization": f"Bearer {await _login(client)}"}
    async with AsyncSessionLocal() as db:
        today = await app_today(db)
    expected = {}
    record_ids = []
    for has_cycle_field in (False, True):
        fields = [{"name": "Expiry Date", "field_type": "date"}]
        if has_cycle_field:
            fields.append({"name": "Billing Cycle", "field_type": "text"})
        response = await client.post("/api/v1/record-types", headers=headers, json={
            "name": f"Renewal policy {has_cycle_field}", "fields": fields,
        })
        assert response.status_code == 201, response.text
        record_type = response.json()
        ids = {field["name"]: field["id"] for field in record_type["fields"]}
        cases = [(None, True, 12), (None, False, None)]
        if has_cycle_field:
            cases += [("Monthly", True, 1), ("One-time", True, None)]
        for index, (cycle, enabled, months) in enumerate(cases):
            values = [
                {"field_id": ids["Expiry Date"], "value": today.isoformat()},
                {"field_id": ids["Auto Renewal"], "value": enabled},
            ]
            if cycle:
                values.append({"field_id": ids["Billing Cycle"], "value": cycle})
            response = await client.post(f"/api/v1/records/by-type/{record_type['id']}", headers=headers,
                                         json={"name": f"Renewal case {index}", "values": values})
            assert response.status_code == 201, response.text
            record_id = response.json()["id"]
            record_ids.append(record_id)
            if months:
                expected[record_id] = _add_months(today, months)

    async with AsyncSessionLocal() as db:
        await auto_renew_due_records(db)
        await auto_renew_due_records(db)
        renewals = (await db.scalars(select(RecordRenewal).where(
            RecordRenewal.record_id.in_(record_ids)))).all()
        assert len(renewals) == len(expected)
        assert all(row.is_automatic for row in renewals)
        assert {row.record_id: row.new_date for row in renewals} == expected


async def test_early_renewal_moves_expiry_immediately(client):
    from app.services.record import auto_renew_due_records
    from app.models.record import Record
    from app.db.session import AsyncSessionLocal

    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    record, fmap = await _setup(client, headers, auto_renew=True, expiry_offset=14)
    expiry = (date.today() + timedelta(days=14)).isoformat()

    async with AsyncSessionLocal() as db:
        res = await auto_renew_due_records(db)
        assert res["auto_renewed"] >= 1

        rec = (await db.execute(
            select(Record).where(Record.id == record["id"])
            .options(selectinload(Record.values))
        )).scalar_one()
        expiry_val = next((v.value for v in rec.values if v.field_id == fmap["Expiry Date"]), None)
        # renewed now, like the registrar does: the expiry moves a year ahead
        new_expiry = date.fromisoformat(expiry).replace(year=date.fromisoformat(expiry).year + 1)
        assert expiry_val == {"value": new_expiry.isoformat()}

        # one history entry: old = previous expiry, new = expiry + 1 year
        from app.models.renewal import RecordRenewal
        rows = (await db.execute(
            select(RecordRenewal).where(RecordRenewal.record_id == record["id"])
        )).scalars().all()
        assert len(rows) == 1
        assert rows[0].old_date == date.fromisoformat(expiry)
        assert rows[0].new_date == date.fromisoformat(expiry) + timedelta(days=365)  # approx; exact check below
        # same day next year (month-clamped arithmetic uses calendar months)
        assert rows[0].renewed_on == date.today()
        assert "before expiry" in rows[0].notes

        await db.rollback()


async def test_early_renewal_no_duplicate_on_second_run(client):
    from app.services.record import auto_renew_due_records
    from app.db.session import AsyncSessionLocal

    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    record, _ = await _setup(client, headers, auto_renew=True)

    async with AsyncSessionLocal() as db:
        first = await auto_renew_due_records(db)
        assert first["auto_renewed"] >= 1
        second = await auto_renew_due_records(db)
        assert second["auto_renewed"] == 0
        await db.rollback()


async def test_overdue_record_applies_pre_recorded_renewal(client):
    """The early entry takes effect at the expiry date: no new history row."""
    from app.services.record import auto_renew_due_records
    from app.models.record import Record
    from app.models.renewal import RecordRenewal
    from app.db.session import AsyncSessionLocal

    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    record, fmap = await _setup(client, headers, auto_renew=True)

    async with AsyncSessionLocal() as db:
        # make it overdue, with a pre-recorded early renewal for the same term
        past = date.today() - timedelta(days=1)
        rec = (await db.execute(
            select(Record).where(Record.id == record["id"]).options(selectinload(Record.values))
        )).scalar_one()
        rv = next(v for v in rec.values if v.field_id == fmap["Expiry Date"])
        expiry = rv.value["value"]
        rv.value = {"value": past.isoformat()}
        rec.status = "expired"
        db.add(RecordRenewal(
            record_id=rec.id, renewed_by=None, renewed_on=date.today(),
            old_date=past, new_date=date(past.year + 1, past.month, past.day),
            notes="Auto-renewed (Yearly), 14 days before expiry",
        ))
        await db.flush()

        res = await auto_renew_due_records(db)
        # the pre-recorded row was reused, no additional history was written for it
        rows = (await db.execute(
            select(RecordRenewal).where(RecordRenewal.record_id == record["id"])
        )).scalars().all()
        ours = [r for r in rows if r.old_date == past]
        assert len(ours) == 1

        rec_fresh = (await db.execute(
            select(Record).where(Record.id == record["id"]).options(selectinload(Record.values))
        )).scalar_one()
        expiry_val = next((v.value for v in rec_fresh.values if v.field_id == fmap["Expiry Date"]), None)
        assert expiry_val == {"value": date(past.year + 1, past.month, past.day).isoformat()}
        assert rec_fresh.status == "active"
        await db.rollback()


async def test_non_auto_record_gets_early_reminder(client):
    from app.services.record import auto_renew_due_records
    from app.services.reminder import process_due_reminders
    from app.models.renewal import RecordRenewal
    from app.db.session import AsyncSessionLocal

    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    record, fmap = await _setup(client, headers, auto_renew=False, expiry_offset=14)
    expiry = (date.today() + timedelta(days=14)).isoformat()

    async with AsyncSessionLocal() as db:
        # the engine must leave non-auto records alone
        res = await auto_renew_due_records(db)
        from app.models.record import Record
        rec = (await db.execute(
            select(Record).where(Record.id == record["id"]).options(selectinload(Record.values))
        )).scalar_one()
        expiry_val = next((v.value for v in rec.values if v.field_id == fmap["Expiry Date"]), None)
        assert expiry_val == {"value": expiry}
        renewals = (await db.execute(
            select(RecordRenewal).where(RecordRenewal.record_id == record["id"])
        )).scalars().all()
        assert len(renewals) == 0

        # a reminder rule for the type, then the worker schedules the early reminder
        from app.models.reminder import ReminderRule, TelegramBot, recipient_bots, NotificationRecipient
        db.add(ReminderRule(record_type_id=record["record_type_id"], name="Expiry soon", days_before=3, active=True))
        # a Telegram recipient owned by the admin (bypasses type access)
        bot = TelegramBot(name="early-bot", bot_token="111:test")
        db.add(bot)
        await db.flush()
        recipient = NotificationRecipient(
            display_name="Admin TG", telegram_chat_id="700001", user_id=1, active=True,
        )
        db.add(recipient)
        await db.flush()
        from sqlalchemy import insert
        await db.execute(insert(recipient_bots).values(recipient_id=recipient.id, bot_id=bot.id))
        await db.flush()

        res = await process_due_reminders(db)
        from app.models.reminder import ReminderLog
        logs = (await db.execute(
            select(ReminderLog).where(ReminderLog.record_id == record["id"])
        )).scalars().all()
        leads = {l.scheduled_date.date() for l in logs}
        # early reminder at expiry - 14
        assert date.fromisoformat(expiry) - timedelta(days=14) in leads
        await db.rollback()


async def test_type_default_lead_applies_without_record_setting(client):
    """A type-wide 'renew 30 days early' default (domains) needs no per-record setup."""
    from app.services.record import auto_renew_due_records
    from app.models.record import Record
    from app.db.session import AsyncSessionLocal

    token = await _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    record, fmap = await _setup(client, headers, auto_renew=True, expiry_offset=25)
    clear = await client.put(f"/api/v1/records/{record['id']}/renewal-options", json={"renew_before_days": None}, headers=headers)
    assert clear.status_code == 200 and clear.json()["renew_before_days"] is None
    # outside the at-expiry window: nothing happens yet
    async with AsyncSessionLocal() as db:
        assert (await auto_renew_due_records(db))["auto_renewed"] == 0
        await db.rollback()
    resp = await client.put(f"/api/v1/record-types/{record['record_type_id']}", json={"renew_before_days": 30}, headers=headers)
    assert resp.status_code == 200 and resp.json()["renew_before_days"] == 30
    async with AsyncSessionLocal() as db:
        assert (await auto_renew_due_records(db))["auto_renewed"] == 1
        await db.commit()
        rec = (await db.execute(select(Record).where(Record.id == record["id"]).options(selectinload(Record.values)))).scalar_one()
        expiry = next(v.value["value"] for v in rec.values if v.field_id == fmap["Expiry Date"])
        assert date.fromisoformat(expiry) > date.today() + timedelta(days=300)
