# Row-level security (PostgreSQL RLS)

Renewal records are also protected inside the database. If a query ever forgets a record-type filter, Postgres still returns only rows from record types granted to the signed-in user, and only lets them change rows in types granted with **Edit**.

## Moving parts

| Piece | Where |
|---|---|
| Policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on `records`, `record_values`, `record_renewals`, `record_assignments` | `apps/api/app/db/rls.py`, applied by migration `0003_row_level_security` |
| Limited login role `keepit_app` (`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`) | Created/refreshed by migration 0003 from `APP_DB_PASSWORD` |
| Per-request context `app.user_id`, `app.is_admin` | `set_rls_context()` in `apps/api/app/db/session.py`, called from `get_current_user` |
| Context survives mid-request commits | `after_begin` session hook re-applies it to every transaction |

## Connections

* **API and worker** connect as `keepit_app` (`DATABASE_URL`), so RLS applies.
* **Migrations and backups** use the owner account (`MIGRATION_DATABASE_URL`), which bypasses RLS and is the only one with DDL rights.
* `keepit_app` has `SELECT/INSERT/UPDATE/DELETE` on tables and **cannot delete or truncate `audit_logs`**.

## Policy logic

* **User context set:** a row is visible if its record type is in the user's `user_record_type_access` grants. Writes also need `can_edit`. System administrators (`app.is_admin = on`) see everything.
* **No user context** (background worker, seed, health checks): access is allowed, because these are trusted system jobs that already run their own permission checks.

## Verifying

```bash
# Policy behaviour, as keepit_app
RECORDS_TEST_DB=postgresql+asyncpg://postgres:postgres@localhost:5432/records_test pytest tests/test_rls.py
# The whole API suite as keepit_app with RLS on (CI runs both modes)
RECORDS_TEST_RLS=1 RECORDS_TEST_DB=... pytest tests
# In the running stack
docker compose exec postgres psql -U postgres -d records -c "select tablename from pg_tables where rowsecurity"
```

Local development without Docker usually connects as the `postgres` superuser, which bypasses RLS. Use the commands above to exercise it.
