FROM python:3.12-slim AS base

LABEL org.opencontainers.image.title="keepit-api" org.opencontainers.image.source="https://github.com/heinhtetthu/keepit"

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .

RUN adduser --disabled-password --gecos '' appuser
RUN mkdir -p /exports /data/documents && chown appuser:appuser /exports /data/documents
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health/ready')" || exit 1

# Startup: migrations (as the owner account), optional idempotent seed (only creates
# the admin and defaults when the database is empty), then the API as keepit_app.
COPY docker-entrypoint.sh /docker-entrypoint.sh
CMD ["sh", "/docker-entrypoint.sh"]
