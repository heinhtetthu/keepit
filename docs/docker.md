# Docker

## Services

| Service | What it is | Exposed |
|---|---|---|
| `frontend` | nginx serving the web app and proxying `/api` and `/docs` to the API | `${FRONTEND_PORT:-80}` |
| `backend` | FastAPI API, runs as `keepit_app` | internal :8000 |
| `worker` | reminders, auto-renewals, asset digest, report jobs | - |
| `postgres` | PostgreSQL 16 | internal |
| `backups` | encrypted nightly `pg_dump` | - |
| `mcp` | MCP server for AI clients (profile `tools`, started on demand) | stdio |

## First run

```bash
cp .env.example .env
docker run --rm -v "$PWD:/workspace" -w /workspace python:3.12-slim \
  sh -c 'pip install -q cryptography && python scripts/init-local-security.py'   # generates keys and DB passwords
docker compose up -d --build
```

Open http://localhost and sign in as `admin` / `admin12345` (development only). `AUTO_SEED=true` creates the admin and the defaults on an empty database. Seeding is idempotent and refuses the default password when `DEPLOYMENT_ENV=production`.

## Everyday commands

```bash
docker compose ps                     # health of every service
docker compose logs -f backend worker
docker compose up -d --build          # rebuild after code changes
docker compose exec backend alembic current
docker compose run --rm -T -e API_TOKEN=rnw_... mcp   # MCP over stdio
docker compose down                   # stop (data volumes are kept)
```

Volumes: `postgres_data`, `documents_data` (uploaded files), `exports_data` (report files), plus `./backups` on the host.
