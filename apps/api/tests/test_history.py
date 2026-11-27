"""Per-entity history timeline and "restore this version" for assets, records and employees."""
import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _login(client, identifier="admin@example.com", password="admin12345"):
    r = await client.post("/api/v1/auth/login", json={"identifier": identifier, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _limited_user(client, admin, email, permissions):
    perms = (await client.get("/api/v1/users/permissions", headers=admin)).json()
    role = await client.post("/api/v1/users/roles", headers=admin, json={
        "name": f"Role {email}", "permission_ids": [p["id"] for p in perms if p["name"] in permissions]})
    assert role.status_code == 201, role.text
    user = await client.post("/api/v1/users", headers=admin, json={
        "email": email, "username": email.split("@")[0], "name": "History Tester", "password": "password123",
        "role_id": role.json()["id"]})
    assert user.status_code == 201, user.text
    return user.json()["id"]


async def _history(client, h, entity, entity_id, **params):
    r = await client.get(f"/api/v1/history/{entity}/{entity_id}", headers=h, params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def test_asset_history_and_restore(client):
    h = await _login(client)
    emp = (await client.post("/api/v1/employees", headers=h, json={"name": "Hist Holder"})).json()
    a = (await client.post("/api/v1/assets", headers=h, json={
        "asset_type": "Laptop", "brand": "Dell", "model": "XPS", "serial_number": "HIST-1",
        "specs": {"cpu": "i5"}, "notes": "first"})).json()
    r = await client.patch(f"/api/v1/assets/{a['id']}", headers=h, json={"brand": "Lenovo", "specs": {"cpu": "i7"}, "notes": "second"})
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/v1/assets/{a['id']}/assign", headers=h, json={"employee_id": emp["id"]})
    assert r.status_code == 200, r.text

    page = await _history(client, h, "asset", a["id"])
    assert page["can_restore"] is True
    actions = [e["action"] for e in page["items"]]
    assert actions[:3] == ["asset.assign", "asset.update", "asset.create"]
    update = page["items"][1]
    labels = {c["label"]: (c["before"], c["after"]) for c in update["changes"]}
    assert labels["Brand"] == ("Dell", "Lenovo") and labels["Specs: cpu"] == ("i5", "i7") and labels["Notes"] == ("first", "second")
    assert update["summary"].startswith("updated ") and update["actor_name"]
    assert page["items"][0]["kind"] == "assignment" and "Hist Holder" in page["items"][0]["summary"]
    assert {k["key"] for k in page["kinds"]} >= {"edit", "assignment"}
    assert [e["action"] for e in (await _history(client, h, "asset", a["id"], kind="assignment"))["items"]] == ["asset.assign"]

    # Assignment entries hold no full version.
    assign_id = page["items"][0]["audit_id"]
    assert page["items"][0]["restorable"] is False
    assert (await client.post(f"/api/v1/history/asset/{a['id']}/revert/{assign_id}", headers=h)).status_code == 400

    create_id = page["items"][2]["audit_id"]
    preview = (await client.get(f"/api/v1/history/asset/{a['id']}/revert/{create_id}/preview", headers=h)).json()
    assert {c["label"] for c in preview["changes"]} == {"Brand", "Specs: cpu", "Notes"}
    r = await client.post(f"/api/v1/history/asset/{a['id']}/revert/{create_id}", headers=h)
    assert r.status_code == 200, r.text
    asset = (await client.get(f"/api/v1/assets/{a['id']}", headers=h)).json()
    assert asset["brand"] == "Dell" and asset["specs"] == {"cpu": "i5"} and asset["notes"] == "first"
    assert asset["employee_id"] == emp["id"]  # holder is not part of a restore
    top = (await _history(client, h, "asset", a["id"]))["items"][0]
    assert top["action"] == "asset.revert" and top["summary"] == "restored a previous version" and top["restorable"]
    # Restoring the same version again changes nothing.
    assert (await client.post(f"/api/v1/history/asset/{a['id']}/revert/{create_id}", headers=h)).status_code == 400
    # An entry of another asset is not accepted.
    b = (await client.post("/api/v1/assets", headers=h, json={"asset_type": "Phone", "serial_number": "HIST-2"})).json()
    assert (await client.post(f"/api/v1/history/asset/{b['id']}/revert/{create_id}", headers=h)).status_code == 404

    # Asset viewers without edit see the timeline but cannot restore.
    await _limited_user(client, h, "asset-viewer@example.com", {"asset.view"})
    viewer = await _login(client, "asset-viewer@example.com", "password123")
    assert (await _history(client, viewer, "asset", a["id"]))["can_restore"] is False
    assert (await client.post(f"/api/v1/history/asset/{a['id']}/revert/{create_id}", headers=viewer)).status_code == 403
    nobody = await _limited_user(client, h, "no-assets@example.com", {"record.view"})
    assert nobody
    no = await _login(client, "no-assets@example.com", "password123")
    assert (await client.get(f"/api/v1/history/asset/{a['id']}", headers=no)).status_code == 403


async def test_record_history_restore_and_access(client):
    h = await _login(client)
    rt = await client.post("/api/v1/record-types", headers=h, json={"name": "Hist Type", "fields": [
        {"name": "Vendor", "field_type": "text"}, {"name": "Seats", "field_type": "integer"},
        {"name": "Admin Password", "field_type": "secret"}]})
    assert rt.status_code == 201, rt.text
    rt = rt.json()
    hidden = (await client.post("/api/v1/record-types", headers=h, json={"name": "Hist Hidden", "fields": [
        {"name": "Vendor", "field_type": "text"}]})).json()
    f = {x["name"]: x["id"] for x in rt["fields"]}
    rec = await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=h, json={
        "name": "Hist Record", "status": "active",
        "values": [{"field_id": f["Vendor"], "value": "Acme"}, {"field_id": f["Seats"], "value": 5},
                   {"field_id": f["Admin Password"], "value": "s3cret-value"}]})
    assert rec.status_code == 201, rec.text
    rec = rec.json()
    r = await client.put(f"/api/v1/records/{rec['id']}", headers=h, json={
        "name": "Hist Record 2", "values": [{"field_id": f["Vendor"], "value": "Globex"}, {"field_id": f["Seats"], "value": None},
                                             {"field_id": f["Admin Password"], "value": "changed-secret"}]})
    assert r.status_code == 200, r.text

    page = await _history(client, h, "record", rec["id"])
    assert [e["action"] for e in page["items"]] == ["update", "create"]
    upd = {c["label"]: (c["before"], c["after"]) for c in page["items"][0]["changes"]}
    assert upd["Vendor"] == ("Acme", "Globex") and upd["Seats"] == (5, None) and upd["Name"] == ("Hist Record", "Hist Record 2")
    assert "s3cret-value" not in str(page) and "changed-secret" not in str(page)
    created = {c["label"]: c["after"] for c in page["items"][1]["changes"]}
    assert created["Vendor"] == "Acme" and "Admin Password" not in created

    create_id = page["items"][1]["audit_id"]
    preview = (await client.get(f"/api/v1/history/record/{rec['id']}/revert/{create_id}/preview", headers=h)).json()
    assert {c["label"] for c in preview["changes"]} == {"Name", "Vendor", "Seats"}
    r = await client.post(f"/api/v1/history/record/{rec['id']}/revert/{create_id}", headers=h)
    assert r.status_code == 200, r.text
    detail = (await client.get(f"/api/v1/records/{rec['id']}", headers=h)).json()
    vals = {v["field_name"]: v["value"] for v in detail["values"]}
    assert detail["name"] == "Hist Record" and vals["Vendor"] == "Acme" and vals["Seats"] == 5
    assert "Admin Password" in vals  # the secret was neither restored nor cleared
    top = (await _history(client, h, "record", rec["id"]))["items"][0]
    assert top["action"] == "record.revert" and top["summary"] == "restored a previous version"

    # View-only grant: sees history, cannot restore. No grant: cannot see it at all.
    other = (await client.post(f"/api/v1/records/by-type/{hidden['id']}", headers=h, json={"name": "Secret Rec", "status": "active"})).json()
    uid = await _limited_user(client, h, "rec-viewer@example.com", {"record.view", "record.edit", "record_type.view"})
    grant = await client.put(f"/api/v1/users/{uid}/record-type-access", headers=h, json={"record_type_ids": [rt["id"]]})
    assert grant.status_code == 200, grant.text
    from sqlalchemy import text
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await db.execute(text("UPDATE user_record_type_access SET can_edit = false WHERE user_id = :u"), {"u": uid})
        await db.commit()
    viewer = await _login(client, "rec-viewer@example.com", "password123")
    vp = await _history(client, viewer, "record", rec["id"])
    assert vp["can_restore"] is False and vp["total"] >= 3
    assert (await client.post(f"/api/v1/history/record/{rec['id']}/revert/{create_id}", headers=viewer)).status_code == 403
    assert (await client.get(f"/api/v1/history/record/{other['id']}", headers=viewer)).status_code in (403, 404)
    assert (await client.get(f"/api/v1/history/record/999999", headers=viewer)).status_code == 404


async def test_employee_history_and_restore(client):
    h = await _login(client)
    emp = (await client.post("/api/v1/employees", headers=h, json={"name": "Hist Emp", "title": "Engineer",
                                                                   "phone": "111"})).json()
    r = await client.put(f"/api/v1/employees/{emp['id']}", headers=h, json={"title": "Lead", "phone": "222"})
    assert r.status_code == 200, r.text
    a = (await client.post("/api/v1/assets", headers=h, json={"asset_type": "Laptop", "brand": "HP", "serial_number": "HIST-E1",
                                                              "employee_id": emp["id"]})).json()
    page = await _history(client, h, "employee", emp["id"])
    actions = [e["action"] for e in page["items"]]
    assert "employee.update" in actions and "employee.create" in actions and "asset_assignment" in actions
    upd = next(e for e in page["items"] if e["action"] == "employee.update")
    assert {c["label"]: (c["before"], c["after"]) for c in upd["changes"]} == {"Title": ("Engineer", "Lead"), "Phone": ("111", "222")}
    held = next(e for e in page["items"] if e["action"] == "asset_assignment")
    assert (held["link"]["type"], held["link"]["id"]) == ("asset", a["id"]) and held["subject"] is True

    create_id = next(e for e in page["items"] if e["action"] == "employee.create")["audit_id"]
    r = await client.post(f"/api/v1/history/employee/{emp['id']}/revert/{create_id}", headers=h)
    assert r.status_code == 200, r.text
    assert {c["label"] for c in r.json()["changes"]} == {"Title", "Phone"}
    e = (await client.get(f"/api/v1/employees/{emp['id']}", headers=h)).json()["employee"]
    assert e["title"] == "Engineer" and e["phone"] == "111"
    assert (await _history(client, h, "employee", emp["id"]))["items"][0]["action"] == "employee.revert"

    await _limited_user(client, h, "emp-viewer@example.com", {"employee.view"})
    viewer = await _login(client, "emp-viewer@example.com", "password123")
    vp = await _history(client, viewer, "employee", emp["id"])
    assert vp["can_restore"] is False and "asset_assignment" not in [x["action"] for x in vp["items"]]
    assert (await client.post(f"/api/v1/history/employee/{emp['id']}/revert/{create_id}", headers=viewer)).status_code == 403
