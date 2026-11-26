# AGENTS.md: guidance for AI agents working on Keepit

Keepit is a renewals and IT-asset management app: a FastAPI + PostgreSQL + React/Vite monorepo. It is the merger of Renewly and AssetWise.

## Golden rules

1. **Never commit secrets.** `.env` and `apps/api/.env` are git-ignored; `.env.example` shows the shape.
2. **Commit only when asked.**
3. Match existing conventions. Check `package.json` / `requirements.txt` before adding a library.
4. Migrations are append-only (head: `0006_remove_extraction`). Use `alembic revision --autogenerate` and keep `alembic check` clean.
5. `Mapped["X"]` annotations cause 8 known ruff F821 false positives. Gate with `ruff check app tests --select F401,F811,E9`.

## Layout

| Path | What |
|---|---|
| `apps/api/app/api/v1/*` | Routers. Permission checks: `Depends(require_permission("x.y"))`, `require_superuser`, `require_any_permission` |
| `apps/api/app/services/*` | Business logic: `access.py` (record-type visibility/edit), `access_levels.py` (role catalogue), `asset.py`, `document.py`, `ai.py`, `record.py`, `assignment.py`, `reminder.py`, `audit.py` |
| `apps/api/app/db/rls.py` + `session.py` | Row-level security policies and per-request context (`set_rls_context`) |
| `apps/web/src` | Pages, components, `lib/branding.tsx` (runtime brand colour/logo), `store/*` (zustand) |
| `packages/core` | Platform-neutral API map + React Query hooks (no DOM APIs, so mobile can reuse it) |
| `packages/api-client` | Types generated from OpenAPI by `pnpm gen:api` |
| `apps/mcp` | MCP server; REST-only, authenticated with an API token |

## Checks (same as CI)

```bash
# API (needs a disposable Postgres; conftest drops the schema, so never point it at real data)
cd apps/api
.venv/bin/ruff check app tests --select F401,F811,E9
RECORDS_TEST_DB=postgresql+asyncpg://postgres:postgres@localhost:5432/records_test .venv/bin/pytest tests -q
RECORDS_TEST_RLS=1 RECORDS_TEST_DB=... .venv/bin/pytest tests -q        # whole suite as keepit_app under RLS
# Web / core / MCP
pnpm typecheck && pnpm --filter web lint && pnpm --filter @workspace/core test && pnpm build
pnpm gen:api   # after any API schema change; commit packages/api-client
```

Add new DB-backed test files to `collect_ignore` in `tests/conftest.py` so CI without a database still passes.

Running stack: `docker compose up -d --build` → http://localhost (admin / admin12345 in development). See `docs/docker.md`.

## Conventions and gotchas

* **Access:** users have an Assets level, a Records level and Hidden/View/Edit per record type (`docs/permissions.md`). Record writes must call `ensure_type_access(db, user, type_id, write=True)`. RLS enforces the same rule in Postgres. New permission strings go into `app/seed.py` `PERMISSIONS` and a level in `access_levels.py`. `seed()` syncs them idempotently.
* **RLS:** the API and worker connect as `keepit_app`; migrations use `MIGRATION_DATABASE_URL` (the owner). Sessions without a user context (worker, seed) are trusted system jobs.
* **React:** hooks must run before any conditional `return` (early returns caused React #310 blank pages).
* **UI:**
  * never use a native `<select>`; use `components/ui/select.tsx` (same API, searchable) or `Combobox`;
  * colours come from tokens: Tailwind gray/status palettes and `white` are CSS variables, so dark mode needs no `dark:` classes, and the primary colour is set at runtime by `lib/branding.tsx`;
  * motion utilities: `animate-pop-in`, `animate-scale-in`, `animate-sheet-up`, `animate-page-in`, `press`, `card-hover`;
  * new creatable things go into `components/CreateMenu.tsx`, new settings into `SECTIONS` in `pages/Settings.tsx`, new guide topics into `app/services/guide.py` (with `group` and `icon`).
* `/assets/*` is an app route, so Vite build files live under `/_app/` (`vite.config.ts`, `nginx.conf`).
* Record values are JSONB `{"value": …}`. Employee and business-unit names are stored as snapshots in history.
* "Recently viewed" is per user (`recently-viewed:<user_id>`).
* The worker compares dates in `TIMEZONE` (default Asia/Yangon).
