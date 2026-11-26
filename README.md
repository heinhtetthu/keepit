# Keepit

[![CI](https://github.com/heinhtetthu/keepit/actions/workflows/ci.yml/badge.svg)](https://github.com/heinhtetthu/keepit/actions/workflows/ci.yml)
[![Security](https://github.com/heinhtetthu/keepit/actions/workflows/security.yml/badge.svg)](https://github.com/heinhtetthu/keepit/actions/workflows/security.yml)

**Everything your company owns. Who has it. When it renews.**

Keepit tracks IT assets (laptops, monitors, phones…), the people who hold them, repairs, maintenance and borrows, and the paperwork that comes with them. It also tracks renewals such as subscriptions, licenses and domains, with reminders before anything expires. It merges two earlier apps, Renewly and AssetWise, into one API, one database and one web app, and is ready for a future mobile app.

## Highlights

* **Assets:** assignment history, repairs (they set the asset to *In Repair*), maintenance checklists, borrows with overdue tracking, QR labels, CSV import, bulk actions, auto product numbers, trash and restore.
* **Renewals:** custom record types with 16 field types, renewals and forecasts, auto-renewal, license-seat ownership, Telegram reminders, saved views, reports.
* **People:** one employee directory. *Employee 360* shows everything a person holds. *Offboarding* returns their assets, closes borrows, releases seats and deactivates them in one step.
* **Documents:** invoices, warranties and contracts linked to assets, people or records, with expiry dates. **AI extraction** fills in records from documents, with human review before anything is saved.
* **Ask Keepit:** a simple chat for quick answers about assets and renewals. It works without AI; AI is optional.
* **Access you can explain:** separate Assets and Records levels, View/Edit per record type, and plain-language explanations in the UI. [docs/permissions.md](docs/permissions.md)
* **Security:**
  * PostgreSQL **row-level security**, with the app running as a limited database role;
  * Argon2 passwords, rotating sessions, MFA, passkeys, email password reset;
  * personal API tokens, a tamper-evident audit log and encrypted secrets.
  
  [SECURITY.md](SECURITY.md) · [docs/row-level-security.md](docs/row-level-security.md)
* **Design:**
  * light and dark themes, with your own brand colour, logo and favicon;
  * one Create menu (press `C`), ⌘K search, searchable dropdowns everywhere;
  * a phone tab bar and subtle animations.

## Quick start (Docker)

```bash
git clone https://github.com/heinhtetthu/keepit.git && cd keepit
cp .env.example .env
docker run --rm -v "$PWD:/workspace" -w /workspace python:3.12-slim \
  sh -c 'pip install -q cryptography && python scripts/init-local-security.py'
docker compose up -d --build
```

Open **http://localhost** and sign in as `admin` / `admin12345` (development only; change it right away). More: [docs/docker.md](docs/docker.md) · production: [docs/deployment.md](docs/deployment.md).

## Repository layout

```
apps/api      FastAPI + SQLAlchemy + Alembic (Python 3.12). API, worker, migrations, tests
apps/web      React + Vite + Tailwind web app, served by nginx
apps/mcp      MCP server for AI clients; talks to the REST API with an API token
apps/mobile   Plan for the future Expo app (shares packages/core)
packages/api-client  TypeScript types generated from the OpenAPI schema (pnpm gen:api)
packages/core        Platform-neutral API map, React Query hooks, formatters
docs/         Feature and operations docs (start at docs/README.md)
```

```
web / mobile / MCP ──▶ REST API (/api/v1, OpenAPI at /docs) ──▶ PostgreSQL 16 (RLS)
                          └─ worker: reminders, auto-renewals, asset digest, reports
```

## Development

Requirements: Python 3.12+, Node 22, pnpm 9, Docker (for Postgres).

```bash
pnpm install
python3 -m venv apps/api/.venv && apps/api/.venv/bin/pip install -r apps/api/requirements.txt -r apps/api/requirements-dev.txt
docker run -d --name keepit-dev-db -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=records postgres:16-alpine
cd apps/api && .venv/bin/alembic upgrade head && .venv/bin/python -m app.seed && .venv/bin/uvicorn app.main:app --reload
pnpm dev   # web app on http://localhost:5173 (proxies /api to :8000; set API_PROXY_TARGET to change)
```

| Task | Command |
|---|---|
| API tests | `cd apps/api && RECORDS_TEST_DB=postgresql+asyncpg://postgres:postgres@localhost:5432/records_test .venv/bin/pytest tests -q` |
| API tests under RLS (as `keepit_app`) | add `RECORDS_TEST_RLS=1` |
| Lint | `.venv/bin/ruff check app tests --select F401,F811,E9` · `pnpm --filter web lint` |
| Types / build | `pnpm typecheck && pnpm build` |
| Regenerate the TS client after API changes | `pnpm gen:api` (CI fails if it drifts) |
| New migration | `cd apps/api && .venv/bin/alembic revision --autogenerate -m "..."` |

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and [AGENTS.md](AGENTS.md) for AI-agent guidance.

## MCP server

Create a token in **Settings → Password & security → API tokens**, then run:

```bash
docker compose run --rm -T -e API_TOKEN=rnw_... mcp
```

It provides 20 tools (search, assets, employees, borrows, repairs, documents, summaries, offboarding). They act with the token owner's permissions and are audited.

## Migrating data from Renewly / AssetWise

This version starts with an empty database. The column mapping is in [docs/data-migration-notes.md](docs/data-migration-notes.md).

## License

Proprietary. All rights reserved unless a license file says otherwise.
