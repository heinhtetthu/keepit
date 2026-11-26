import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_search_counts_and_pages_are_not_multiplied_by_field_matches(client):
    tokens = (await client.post("/api/v1/auth/login", json={"identifier": "admin", "password": "admin12345"})).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    rt = (await client.post("/api/v1/record-types", headers=headers, json={
        "name": "Search performance", "fields": [
            {"name": "First", "field_type": "text"}, {"name": "Second", "field_type": "text"},
            {"name": "Hidden", "field_type": "text", "searchable": False},
        ],
    })).json()
    for i in range(3):
        response = await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={
            "name": f"Needle {i}", "values": [{"field_id": f["id"], "value": "needle"} for f in rt["fields"]],
        })
        assert response.status_code == 201, response.text
    await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={
        "name": "Unsearchable value", "values": [{"field_id": rt["fields"][2]["id"], "value": "needle"}],
    })
    pages = []
    for page in (1, 2):
        response = await client.get(f"/api/v1/records/by-type/{rt['id']}", headers=headers,
                                    params={"search": "needle", "page_size": 2, "page": page})
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["total"] == 3 and data["total_pages"] == 2
        pages.append(data["items"])
    assert [len(p) for p in pages] == [2, 1]
    assert len({r["id"] for p in pages for r in p}) == 3
    response = await client.get("/api/v1/search", headers=headers, params={"q": "needle", "limit_per_type": 2})
    assert response.status_code == 200, response.text
    matches = [r for r in response.json()["results"] if r["kind"] == "record"]
    assert len(matches) == 2 and len({r["record_id"] for r in matches}) == 2
    assert all(r["title"].startswith("Needle") for r in matches)
