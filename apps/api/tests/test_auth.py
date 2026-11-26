import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_login_success(client):
    from app.seed import seed
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await seed(db)
    resp = await client.post("/api/v1/auth/login", json={"identifier": "admin@example.com", "password": "admin12345"})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


async def test_login_invalid(client):
    resp = await client.post("/api/v1/auth/login", json={"identifier": "bad@example.com", "password": "wrong"})
    assert resp.status_code == 401


async def test_me_unauthenticated(client):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401
