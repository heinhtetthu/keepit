"""Row-level security is enforced by Postgres itself for the keepit_app role."""
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.rls import role_statements

pytestmark = pytest.mark.asyncio(loop_scope="session")
PW = "disposable-test-app-role-0001"


async def test_rls_policies_limit_rows_and_writes(client):
    import os
    from urllib.parse import urlparse, urlunparse
    owner_url = os.environ["RECORDS_TEST_DB"]
    owner = create_async_engine(owner_url)
    async with owner.begin() as conn:
        for sql in role_statements(PW):
            await conn.execute(text(sql))
        from app.db.rls import grant_statements
        for sql in grant_statements():
            await conn.execute(text(sql))
        types = dict((await conn.execute(text("SELECT name, id FROM record_types"))).all())
        uid = (await conn.execute(text(
            "INSERT INTO users (email, username, name, hashed_password, is_active, is_superuser, session_version, must_change_password,"
            " created_at, updated_at) VALUES ('rls@x.com','rls','RLS','x',true,false,0,false,now(),now()) RETURNING id"))).scalar_one()
        await conn.execute(text("INSERT INTO user_record_type_access (user_id, record_type_id, can_edit, created_at, updated_at) VALUES "
                                "(:u, :lic, true, now(), now()), (:u, :dom, false, now(), now())"),
                           {"u": uid, "lic": types["License"], "dom": types["Domain"]})
        for name, t in (("lic-1", "License"), ("dom-1", "Domain"), ("sub-1", "Subscription")):
            await conn.execute(text("INSERT INTO records (record_type_id, name, status, archived, created_at, updated_at) "
                                    "VALUES (:t, :n, 'active', false, now(), now())"), {"t": types[t], "n": name})
    await owner.dispose()

    u = urlparse(owner_url)
    app_engine = create_async_engine(urlunparse(u._replace(netloc=f"keepit_app:{PW}@{u.hostname}:{u.port or 5432}")))
    scope = text("SELECT set_config('app.user_id', :u, true), set_config('app.is_admin', 'off', true)")
    try:
        async with app_engine.connect() as conn:
            # System context (worker, seed): everything visible.
            assert (await conn.execute(text("SELECT count(*) FROM records"))).scalar_one() == 3
            await conn.rollback()
            # User context: Subscription is hidden entirely.
            async with conn.begin():
                await conn.execute(scope, {"u": str(uid)})
                names = set((await conn.execute(text("SELECT name FROM records"))).scalars())
                assert names == {"lic-1", "dom-1"}
            # Edit grant: insert allowed.
            async with conn.begin():
                await conn.execute(scope, {"u": str(uid)})
                await conn.execute(text("INSERT INTO records (record_type_id, name, status, archived, created_at, updated_at) "
                                        "VALUES (:t, 'lic-2', 'active', false, now(), now())"), {"t": types["License"]})
            # View-only grant: insert rejected by the policy.
            with pytest.raises(Exception, match="row-level security"):
                async with conn.begin():
                    await conn.execute(scope, {"u": str(uid)})
                    await conn.execute(text("INSERT INTO records (record_type_id, name, status, archived, created_at, updated_at) "
                                            "VALUES (:t, 'dom-2', 'active', false, now(), now())"), {"t": types["Domain"]})
            # View-only rows cannot be updated or deleted (silently 0 rows).
            async with conn.begin():
                await conn.execute(scope, {"u": str(uid)})
                assert (await conn.execute(text("UPDATE records SET status='x' WHERE name='dom-1'"))).rowcount == 0
                assert (await conn.execute(text("DELETE FROM records WHERE name='dom-1'"))).rowcount == 0
            # The app role cannot delete audit history.
            with pytest.raises(Exception, match="permission denied"):
                async with conn.begin():
                    await conn.execute(text("DELETE FROM audit_logs"))
    finally:
        await app_engine.dispose()
