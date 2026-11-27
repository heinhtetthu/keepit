import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _h(client):
    r = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_departments_crud_and_rename_follows(client):
    h = await _h(client)
    r = await client.post("/api/v1/departments", json={"name": " Finance "}, headers=h)
    assert r.status_code == 201, r.text
    dept = r.json()
    assert dept["name"] == "Finance" and dept["employee_count"] == 0
    dupe = await client.post("/api/v1/departments", json={"name": "finance"}, headers=h)
    assert dupe.status_code == 409

    emp = await client.post("/api/v1/employees", json={"name": "Aye Aye", "department": "finance", "country": "Myanmar"}, headers=h)
    assert emp.status_code == 201, emp.text
    emp = emp.json()
    # Snapshot uses the master entry's spelling.
    assert emp["department"] == "Finance" and emp["country"] == "Myanmar"

    listed = (await client.get("/api/v1/departments", headers=h)).json()
    assert [(d["name"], d["employee_count"]) for d in listed] == [("Finance", 1)]

    r = await client.put(f"/api/v1/departments/{dept['id']}", json={"name": "Accounting"}, headers=h)
    assert r.status_code == 200 and r.json()["name"] == "Accounting" and r.json()["employee_count"] == 1
    got = (await client.get(f"/api/v1/employees/{emp['id']}", headers=h)).json()["employee"]
    assert got["department"] == "Accounting"

    # A new name on an employee joins the master list.
    upd = await client.put(f"/api/v1/employees/{emp['id']}", json={"department": "IT", "country": ""}, headers=h)
    assert upd.status_code == 200 and upd.json()["department"] == "IT" and upd.json()["country"] is None
    names = [d["name"] for d in (await client.get("/api/v1/departments", headers=h)).json()]
    assert names == ["Accounting", "IT"]

    assert (await client.delete(f"/api/v1/departments/{dept['id']}", headers=h)).status_code == 204
    assert (await client.delete(f"/api/v1/departments/{dept['id']}", headers=h)).status_code == 404


async def test_bulk_department_and_csv_import(client):
    h = await _h(client)
    a = (await client.post("/api/v1/employees", json={"name": "Ko Ko"}, headers=h)).json()
    b = (await client.post("/api/v1/employees", json={"name": "Ma Ma"}, headers=h)).json()
    r = await client.post("/api/v1/employees/bulk", json={"ids": [a["id"], b["id"]], "department": "Sales"}, headers=h)
    assert r.status_code == 200 and r.json()["updated"] == 2
    rows = (await client.get("/api/v1/employees", headers=h)).json()
    assert {e["name"]: e["department"] for e in rows} == {"Ko Ko": "Sales", "Ma Ma": "Sales"}

    csv = b"Name,Business Unit,Department,Country\nZaw Zaw,HQ,Operations,Thailand\nKo Ko,HQ,,\n"
    files = {"file": ("people.csv", csv, "text/csv")}
    preview = (await client.post("/api/v1/employees/import-file?preview=true", files=files, headers=h)).json()
    assert preview["mapping"]["department"] == "Department" and preview["mapping"]["country"] == "Country"
    assert preview["mapping"]["business_units"] == "Business Unit"
    done = (await client.post("/api/v1/employees/import-file", files=files, headers=h)).json()
    assert done["created"] == 1 and done["updated"] == 1
    rows = {e["name"]: e for e in (await client.get("/api/v1/employees", headers=h)).json()}
    assert rows["Zaw Zaw"]["department"] == "Operations" and rows["Zaw Zaw"]["country"] == "Thailand"
    assert rows["Zaw Zaw"]["business_units"] == ["HQ"]
    # Blank cells leave the existing value alone.
    assert rows["Ko Ko"]["department"] == "Sales"
    assert "Operations" in [d["name"] for d in (await client.get("/api/v1/departments", headers=h)).json()]
