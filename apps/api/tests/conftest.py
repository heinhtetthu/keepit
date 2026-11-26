import os

ROOT = os.path.dirname(__file__)

# Tests need a disposable PostgreSQL test database that the runner can create
# and drop freely. Point RECORDS_TEST_DB at a test database URL to enable:
#   RECORDS_TEST_DB=postgresql+asyncpg://postgres:postgres@localhost:5432/records_test pytest
TEST_DATABASE_URL = os.getenv("RECORDS_TEST_DB")
if TEST_DATABASE_URL:
    import re
    from urllib.parse import urlparse
    test_name = urlparse(TEST_DATABASE_URL).path.lstrip('/')
    if not re.fullmatch(r'(records_test[a-z0-9_]*|test_[a-z0-9_]+)', test_name):
        raise RuntimeError('Schema-reset tests require an explicitly named records_test* or test_* database')
if os.getenv("CI") and not TEST_DATABASE_URL:
    raise RuntimeError("CI requires a disposable RECORDS_TEST_DB; refusing to skip the test suite")

collect_ignore = []
if not TEST_DATABASE_URL:
    # Skips every test module so CI passes without a test database.
        collect_ignore = [
        os.path.join(ROOT, "test_auth.py"),
        os.path.join(ROOT, "test_records.py"),
        os.path.join(ROOT, "test_reminders.py"),
        os.path.join(ROOT, "test_exports.py"),
        os.path.join(ROOT, "test_access.py"),
        os.path.join(ROOT, "test_ownership.py"),
        os.path.join(ROOT, "test_early_renewal.py"),
        os.path.join(ROOT, "test_hardening.py"),
        os.path.join(ROOT, "test_forecast.py"),
        os.path.join(ROOT, "test_search.py"),
        os.path.join(ROOT, "test_reminder_templates.py"),
        os.path.join(ROOT, "test_help.py"),
        os.path.join(ROOT, "test_assistant_answers.py"),
        os.path.join(ROOT, "test_security_controls.py"),
        os.path.join(ROOT, "test_license_flows.py"),
        os.path.join(ROOT, "test_assets.py"),
        os.path.join(ROOT, "test_account.py"),
        os.path.join(ROOT, "test_workspace.py"),
        os.path.join(ROOT, "test_rls.py"),
    ]
else:
    # Isolated test key; never used by deployment or backup scripts.
    import base64
    os.environ.setdefault('DATA_ENCRYPTION_KEYS', base64.urlsafe_b64encode(b'0' * 32).decode())
    os.environ.setdefault('SECRET_KEY', 'disposable-test-signing-key-at-least-32-characters')
    # Point the application at the test database before anything imports it.
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    # RECORDS_TEST_RLS=1 runs the whole suite as the limited keepit_app role with
    # row-level security enabled, exactly like the Docker deployment.
    RLS_MODE = os.getenv("RECORDS_TEST_RLS") == "1"
    APP_ROLE_PASSWORD = "disposable-test-app-role-0001"
    if RLS_MODE:
        import asyncio
        import asyncpg
        from urllib.parse import urlparse, urlunparse

        def _role_url(url: str) -> str:
            u = urlparse(url)
            return urlunparse(u._replace(netloc=f"keepit_app:{APP_ROLE_PASSWORD}@{u.hostname}:{u.port or 5432}"))

        async def _ensure_role():
            from app.db.rls import role_statements
            conn = await asyncpg.connect(TEST_DATABASE_URL.replace("postgresql+asyncpg", "postgresql"))
            try:
                for sql in role_statements(APP_ROLE_PASSWORD):
                    await conn.execute(sql)
            finally:
                await conn.close()
        asyncio.run(_ensure_role())
        os.environ["DATABASE_URL"] = _role_url(TEST_DATABASE_URL)

    import pytest
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text

    def _reset_schema(sync_conn):
        # record_fields <-> record_types form an unnamed foreign key cycle, so
        # metadata.drop_all cannot sort the DROP order. Dropping the schema
        # wholesale sidesteps it.
        sync_conn.execute(text("DROP SCHEMA public CASCADE"))
        sync_conn.execute(text("CREATE SCHEMA public"))
        sync_conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    @pytest.fixture
    async def client():
        # `import app.models` would rebind the local name `app` to the package,
        # so pull the FastAPI instance in first under its own name.
        from app.main import app as fastapi_app
        from app import models  # noqa: F401  (register every table on Base.metadata)
        from app.db.base import Base
        from app.db.session import engine, AsyncSessionLocal
        from app.db.rls import enable_statements, grant_statements
        from app.seed import seed
        from app.services.query_cache import clear
        from sqlalchemy.ext.asyncio import create_async_engine
        clear()

        owner = create_async_engine(TEST_DATABASE_URL)
        async with owner.begin() as conn:
            await conn.run_sync(_reset_schema)
            await conn.run_sync(Base.metadata.create_all)
            for sql in enable_statements() + grant_statements():
                await conn.execute(text(sql))
        await owner.dispose()

        async with AsyncSessionLocal() as db:
            await seed(db)

        transport = ASGITransport(app=fastapi_app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as test_client:
            yield test_client

        await engine.dispose()
