# Contributing

1. Branch from `main`. Keep pull requests focused.
2. Before pushing, run the same checks as CI (see the table in the README):
   * API: ruff, migration round-trip, `pytest` and `RECORDS_TEST_RLS=1 pytest`
   * Web, core and MCP: `pnpm typecheck`, `pnpm --filter web lint`, `pnpm --filter @workspace/core test`, `pnpm build`
   * Changed an API schema? `pnpm gen:api` and commit `packages/api-client`.
3. Migrations are append-only: `alembic revision --autogenerate`, then make sure `alembic check` is clean.

## Conventions

* **Backend layering:** `api/v1/<router>.py` → `schemas/` → `services/` → `models/`. Every mutation calls `log_audit`. Record writes use `ensure_type_access(..., write=True)`.
* **New permission strings:** add them to `app/seed.py` (`PERMISSIONS`) and an access level in `app/services/access_levels.py`.
* **UI:**
  * use `Select`/`Combobox` (searchable), never a native `<select>`;
  * use colour tokens (`bg-primary`, `text-gray-*`), never hard-coded hex;
  * keep animations short and respect reduced motion;
  * add new creatable things to `components/CreateMenu.tsx` and new settings to `SECTIONS` in `pages/Settings.tsx`.
* **Shared code:** new web screens use `@workspace/core` hooks. Keep `packages/core` free of DOM APIs so the mobile app can reuse it.
* **Commits:** imperative subject lines, ideally 72 characters or fewer.
