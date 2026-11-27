"""List filters for the Documents and Notifications tables."""
from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _login(client):
    r = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_document_filters(client, tmp_path):
    from app.services.documents.storage import LocalStorage, set_storage
    set_storage(LocalStorage(str(tmp_path)))
    h = await _login(client)
    emp = (await client.post("/api/v1/employees", json={"name": "Doc Person", "email": "docp@corp.local"}, headers=h)).json()
    soon = (date.today() + timedelta(days=10)).isoformat()
    past = (date.today() - timedelta(days=5)).isoformat()
    pdf = b"%PDF-1.4\n" + b"0" * 100

    async def up(name, data, links=None):
        if links:
            data = {**data, "links": links}
        r = await client.post("/api/v1/documents", headers=h, files={"file": (name, pdf, "application/pdf")}, data=data)
        assert r.status_code == 201, r.text
        return r.json()

    a = await up("a.pdf", {"category": "Warranty", "title": "Alpha", "expiry_date": soon},
                 f'[{{"entity_type":"employee","entity_id":{emp["id"]}}}]')
    b = await up("b.pdf", {"category": "Contract", "title": "Bravo", "expiry_date": past})
    c = await up("c.pdf", {"category": "Invoice", "title": "Charlie"})

    async def ids(**params):
        r = await client.get("/api/v1/documents", params=params, headers=h)
        assert r.status_code == 200, r.text
        return [d["id"] for d in r.json()["items"]]

    assert set(await ids(category="Warranty,Contract")) == {a["id"], b["id"]}
    assert await ids(expiry="expiring") == [a["id"]]
    assert await ids(expiry="expired") == [b["id"]]
    assert await ids(expiry="none") == [c["id"]]
    assert set(await ids(linked="none")) == {b["id"], c["id"]}
    assert await ids(linked="employee") == [a["id"]]
    assert await ids(expiry_from=past, expiry_to=past) == [b["id"]]
    assert set(await ids(file_type="pdf")) == {a["id"], b["id"], c["id"]}
    assert await ids(file_type="image") == []
    assert set(await ids(uploaded_from=date.today().isoformat())) == {a["id"], b["id"], c["id"]}
    assert await ids(sort="title", order="asc") == [a["id"], b["id"], c["id"]]
    assert await ids(sort="title", order="desc") == [c["id"], b["id"], a["id"]]
    assert (await client.get("/api/v1/documents", params={"sort": "nope"}, headers=h)).status_code == 422
    counts = (await client.get("/api/v1/documents/tab-counts", headers=h)).json()
    assert counts == {"total": 3, "expiring": 1, "expired": 1, "unlinked": 2}


async def test_reminder_log_filters(client):
    h = await _login(client)
    for params in ({"status": "sent,failed"}, {"q": "x", "sort": "record", "order": "asc"}, {"record_type_ids": "1,2", "recipient_ids": "1"},
                   {"date_from": date.today().isoformat(), "date_to": date.today().isoformat(), "sort": "scheduled_date"}):
        r = await client.get("/api/v1/reminders/logs", params=params, headers=h)
        assert r.status_code == 200, r.text
    assert (await client.get("/api/v1/reminders/logs", params={"sort": "bogus"}, headers=h)).status_code == 422
