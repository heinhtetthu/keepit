#!/bin/sh
set -e
alembic upgrade head
if [ "${AUTO_SEED:-false}" = "true" ]; then
  python -m app.seed
fi
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log --proxy-headers --forwarded-allow-ips="*"
