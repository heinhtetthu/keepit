import pytest
from datetime import date, timedelta

pytestmark = pytest.mark.asyncio(loop_scope="session")
TODAY = date.today()


async def _login(client, identifier="admin@example.com", password="admin12345"):
    r = await client.post("/api/v1/auth/login", json={"identifier": identifier, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _employee(client, h, name="Aye Aye", **kw):
    r = await client.post("/api/v1/employees", json={"name": name, "email": f"{name.split()[0].lower()}@corp.local",
                                                     "business_units": ["IT"], **kw}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def _asset(client, h, **kw):
    body = {"asset_type": "Laptop", "brand": "Dell", "model": "Latitude 5440", "serial_number": "SN-1",
            "specs": {"cpu": "i7", "ram": "16GB", "gpu": ""}, "purchase_date": "2025-01-10",
            "warranty_end_date": (TODAY + timedelta(days=20)).isoformat(), **kw}
    r = await client.post("/api/v1/assets", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def test_asset_lifecycle(client):
    h = await _login(client)
    emp = await _employee(client, h, gender="Female", join_date="2024-03-01", regions=["Yangon"])
    assert emp["gender"] == "Female" and emp["regions"] == ["Yangon"]
    a = await _asset(client, h, employee_id=emp["id"])
    assert a["assignment_status"] == "Assigned" and a["employee"]["name"] == "Aye Aye"
    assert a["specs"] == {"cpu": "i7", "ram": "16GB"}  # blanks dropped
    assert a["display_name"] == "Dell Latitude 5440 (SN-1)"

    dup = await client.post("/api/v1/assets", json={"asset_type": "Laptop", "serial_number": "sn-1"}, headers=h)
    assert dup.status_code == 409

    # reassign to a second employee closes the first period
    emp2 = await _employee(client, h, name="Bo Bo")
    r = await client.post(f"/api/v1/assets/{a['id']}/assign", json={"employee_id": emp2["id"], "remark": "swap"}, headers=h)
    assert r.status_code == 200 and r.json()["employee_id"] == emp2["id"]
    detail = (await client.get(f"/api/v1/assets/{a['id']}", headers=h)).json()
    assert [x["employee_name"] for x in detail["assignments"]] == ["Bo Bo", "Aye Aye"]
    assert detail["assignments"][1]["assigned_to"] == TODAY.isoformat()

    # repairs drive condition
    rep = await client.post(f"/api/v1/assets/{a['id']}/repairs", json={"repair_date": TODAY.isoformat(), "issue": "Battery",
                                                                      "cost": "120.50", "vendor": "Shop"}, headers=h)
    assert rep.status_code == 201
    assert (await client.get(f"/api/v1/assets/{a['id']}", headers=h)).json()["condition_status"] == "In Repair"
    await client.patch(f"/api/v1/assets/{a['id']}/repairs/{rep.json()['id']}", json={"status": "Complete"}, headers=h)
    assert (await client.get(f"/api/v1/assets/{a['id']}", headers=h)).json()["condition_status"] == "Operational"

    m = await client.post(f"/api/v1/assets/{a['id']}/maintenance", json={
        "maintenance_date": TODAY.isoformat(), "body_condition": "Fair", "operating_system": "Windows 11 Pro",
        "components": [{"component": "Battery", "status": "Good"}]}, headers=h)
    assert m.status_code == 201 and m.json()["components"][0]["component"] == "Battery"

    log = (await client.get("/api/v1/assets/repairs", headers=h)).json()
    assert log["total"] == 1 and log["items"][0]["asset_name"].startswith("Dell")

    # list + search + warranty filter
    lst = (await client.get("/api/v1/assets", params={"q": "latitude"}, headers=h)).json()
    assert lst["total"] == 1
    soon = (await client.get("/api/v1/assets", params={"warranty_before": (TODAY + timedelta(days=30)).isoformat()}, headers=h)).json()
    assert soon["total"] == 1

    # soft delete -> trash -> restore
    assert (await client.delete(f"/api/v1/assets/{a['id']}", headers=h)).status_code == 204
    assert (await client.get("/api/v1/assets", headers=h)).json()["total"] == 0
    assert (await client.get("/api/v1/assets", params={"deleted": True}, headers=h)).json()["total"] == 1
    restored = await client.post(f"/api/v1/assets/{a['id']}/restore", headers=h)
    assert restored.status_code == 200 and restored.json()["assignment_status"] == "Unassigned"

    audit = (await client.get("/api/v1/audit-logs", params={"entity_type": "asset"}, headers=h))
    assert audit.status_code == 200


async def test_borrow_flow(client):
    h = await _login(client)
    emp = await _employee(client, h)
    a = await _asset(client, h)
    b = await client.post("/api/v1/borrows", json={"asset_id": a["id"], "employee_id": emp["id"],
                                                   "borrowed_date": (TODAY - timedelta(days=5)).isoformat(),
                                                   "expected_return_date": (TODAY - timedelta(days=1)).isoformat()}, headers=h)
    assert b.status_code == 201, b.text
    assert b.json()["overdue"] is True and b.json()["borrower_name"] == "Aye Aye"
    assert (await client.get(f"/api/v1/assets/{a['id']}", headers=h)).json()["assignment_status"] == "Borrowed"
    # borrowed asset cannot be assigned or borrowed again
    assert (await client.post(f"/api/v1/assets/{a['id']}/assign", json={"employee_id": emp["id"]}, headers=h)).status_code == 400
    assert (await client.post("/api/v1/borrows", json={"asset_id": a["id"], "borrower_name": "X",
                                                       "borrowed_date": TODAY.isoformat()}, headers=h)).status_code == 400
    overdue = (await client.get("/api/v1/borrows", params={"status": "overdue"}, headers=h)).json()
    assert overdue["total"] == 1 and overdue["items"][0]["serial_number"] == "SN-1"
    r = await client.post(f"/api/v1/borrows/{b.json()['id']}/return", json={}, headers=h)
    assert r.status_code == 200 and r.json()["returned_date"] == TODAY.isoformat()
    assert (await client.get(f"/api/v1/assets/{a['id']}", headers=h)).json()["assignment_status"] == "Unassigned"
    # untracked item borrow
    c = await client.post("/api/v1/borrows", json={"item_name": "HDMI cable", "borrower_name": "Guest",
                                                   "borrowed_date": TODAY.isoformat()}, headers=h)
    assert c.status_code == 201 and c.json()["asset_id"] is None


async def test_auto_serial(client):
    h = await _login(client)
    bad = await client.put("/api/v1/assets/serial-settings/UPS", json={"enabled": True, "format": "UPS-{SEQ:x}"}, headers=h)
    assert bad.status_code == 400
    ok = await client.put("/api/v1/assets/serial-settings/UPS", json={"enabled": True, "format": "UPS-{YY}-{SEQ:4}"}, headers=h)
    assert ok.status_code == 200, ok.text
    g1 = (await client.post("/api/v1/assets/serial-settings/UPS/generate", headers=h)).json()["serial"]
    g2 = (await client.post("/api/v1/assets/serial-settings/UPS/generate", headers=h)).json()["serial"]
    assert g1 == g2 == f"UPS-{TODAY.year % 100:02d}-0001"
    await _asset(client, h, asset_type="UPS", serial_number=g1)
    g3 = (await client.post("/api/v1/assets/serial-settings/UPS/generate", headers=h)).json()["serial"]
    assert g3.endswith("-0002")


async def test_reference_and_templates(client):
    h = await _login(client)
    lists = (await client.get("/api/v1/reference", headers=h)).json()
    assert "Laptop" in [i["name"] for i in lists["asset_type"]]
    r = await client.post("/api/v1/reference/vendor", json={"name": "Fix-It", "meta": {"phone": "123"}}, headers=h)
    assert r.status_code == 201 and r.json()["meta"]["phone"] == "123"
    assert (await client.post("/api/v1/reference/vendor", json={"name": "fix-it"}, headers=h)).status_code == 409
    assert (await client.post("/api/v1/reference/nope", json={"name": "x"}, headers=h)).status_code == 400
    t = await client.put("/api/v1/assets/templates/Tablet", json={"attributes": ["storage", " storage", "Color"]}, headers=h)
    assert t.json()["attributes"] == ["storage", "Color"]


async def test_documents(client, tmp_path):
    from app.services.documents.storage import LocalStorage, set_storage
    set_storage(LocalStorage(str(tmp_path)))
    try:
        h = await _login(client)
        a = await _asset(client, h)
        pdf = b"%PDF-1.4\n" + b"0" * 100
        r = await client.post("/api/v1/documents", headers=h, files={"file": ("invoice.pdf", pdf, "application/pdf")},
                              data={"category": "Invoice", "tags": "dell, 2025", "expiry_date": "2027-01-01",
                                    "links": f'[{{"entity_type":"asset","entity_id":{a["id"]}}}]'})
        assert r.status_code == 201, r.text
        doc = r.json()
        assert doc["tags"] == ["dell", "2025"] and doc["links"][0]["label"].startswith("Dell") and doc["previewable"]
        f = await client.get(f"/api/v1/documents/{doc['id']}/file", headers=h)
        assert f.status_code == 200 and f.content == pdf and f.headers["content-type"] == "application/pdf"
        # spoofed content is rejected
        bad = await client.post("/api/v1/documents", headers=h, files={"file": ("x.pdf", b"MZ" + b"0" * 50, "application/pdf")})
        assert bad.status_code == 400
        bad = await client.post("/api/v1/documents", headers=h, files={"file": ("x.exe", b"MZ" + b"0" * 50, "application/octet-stream")})
        assert bad.status_code == 400
        by_asset = (await client.get("/api/v1/documents", params={"entity_type": "asset", "entity_id": a["id"]}, headers=h)).json()
        assert by_asset["total"] == 1
        # link to a renewal record too
        rec_types = (await client.get("/api/v1/record-types", headers=h)).json()
        assert rec_types
        emp = await _employee(client, h)
        linked = await client.post(f"/api/v1/documents/{doc['id']}/links", json={"entity_type": "employee", "entity_id": emp["id"]}, headers=h)
        assert linked.status_code == 200 and len(linked.json()["links"]) == 2
        overview = (await client.get(f"/api/v1/employees/{emp['id']}", headers=h)).json()
        assert overview["documents"][0]["id"] == doc["id"]
        assert (await client.delete(f"/api/v1/documents/{doc['id']}", headers=h)).status_code == 204
        assert (await client.get("/api/v1/documents", headers=h)).json()["total"] == 0
    finally:
        set_storage(None)


async def test_offboard_returns_everything(client):
    h = await _login(client)
    emp = await _employee(client, h)
    a = await _asset(client, h, employee_id=emp["id"])
    b = await _asset(client, h, serial_number="SN-2")
    await client.post("/api/v1/borrows", json={"asset_id": b["id"], "employee_id": emp["id"], "borrowed_date": TODAY.isoformat()}, headers=h)
    r = await client.post(f"/api/v1/employees/{emp['id']}/offboard", json={"effective_date": TODAY.isoformat()}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["assets_returned"] == 1 and r.json()["borrows_closed"] == 1 and r.json()["deactivated"]
    assert (await client.get(f"/api/v1/assets/{a['id']}", headers=h)).json()["assignment_status"] == "Unassigned"
    assert (await client.get(f"/api/v1/assets/{b['id']}", headers=h)).json()["assignment_status"] == "Unassigned"
    overview = (await client.get(f"/api/v1/employees/{emp['id']}", headers=h)).json()
    assert overview["employee"]["active"] is False and overview["employee"]["resignation_date"] == TODAY.isoformat()
    assert overview["asset_history"][0]["assigned_to"] == TODAY.isoformat()


async def test_viewer_cannot_write_assets(client):
    h = await _login(client)
    u = await client.post("/api/v1/users", json={"email": "v@corp.com", "username": "viewer", "name": "V",
                                                 "password": "viewer-pass-123456"}, headers=h)
    assert u.status_code == 201, u.text
    r = await client.put(f"/api/v1/users/{u.json()['id']}/access", json={"assets": "viewer", "records": "viewer"}, headers=h)
    assert r.status_code == 200, r.text
    vh = await _login(client, "v@corp.com", "viewer-pass-123456")
    assert (await client.get("/api/v1/assets", headers=vh)).status_code == 200
    assert (await client.get("/api/v1/employees", headers=vh)).status_code == 200
    assert (await client.post("/api/v1/assets", json={"asset_type": "Laptop"}, headers=vh)).status_code == 403


async def test_split_access_per_type(client):
    """Viewer on assets, Editor on records with Edit on one type and View on another."""
    h = await _login(client)
    types = {t["name"]: t["id"] for t in (await client.get("/api/v1/record-types", headers=h)).json()}
    cat = (await client.get("/api/v1/users/access-catalog", headers=h)).json()
    assert [lv["key"] for lv in cat["assets"]["levels"]] == ["none", "viewer", "editor", "manager"]
    assert all(lv["description"] for lv in cat["records"]["levels"])
    u = (await client.post("/api/v1/users", json={"email": "mix@corp.com", "username": "mix", "name": "Mix",
                                                  "password": "mixed-pass-123456"}, headers=h)).json()
    body = {"assets": "viewer", "records": "editor", "grants": [
        {"record_type_id": types["License"], "access": "edit"}, {"record_type_id": types["Domain"], "access": "view"}]}
    prof = (await client.put(f"/api/v1/users/{u['id']}/access", json=body, headers=h)).json()
    assert prof["assets"] == "viewer" and prof["records"] == "editor" and len(prof["grants"]) == 2
    mh = await _login(client, "mix@corp.com", "mixed-pass-123456")
    me = (await client.get("/api/v1/auth/me", headers=mh)).json()
    assert me["record_type_access"] == {str(types["License"]): "edit", str(types["Domain"]): "view"}
    lic = await client.post(f"/api/v1/records/by-type/{types['License']}", json={"name": "Office seat", "values": []}, headers=mh)
    assert lic.status_code != 403, lic.text  # passes access; may still fail field validation
    dom = await client.post(f"/api/v1/records/by-type/{types['Domain']}", json={"name": "example.com", "values": []}, headers=mh)
    assert dom.status_code == 403 and "view-only" in dom.text
    assert (await client.get(f"/api/v1/records/by-type/{types['Domain']}", headers=mh)).status_code == 200
    assert (await client.get(f"/api/v1/records/by-type/{types['Subscription']}", headers=mh)).status_code == 403
    assert (await client.get("/api/v1/assets", headers=mh)).status_code == 200
    assert (await client.post("/api/v1/assets", json={"asset_type": "Laptop"}, headers=mh)).status_code == 403
    # Only system administrators may change access
    assert (await client.put(f"/api/v1/users/{u['id']}/access", json={"records": "manager"}, headers=mh)).status_code == 403
