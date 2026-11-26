# Deployment

See [docker.md](docker.md) for the stack. Production checklist:

1. Set `DEPLOYMENT_ENV=production`. The API then refuses to start without a strong `SECRET_KEY`, a non-default database password, `DATA_ENCRYPTION_KEYS`, an HTTPS `FRONTEND_URL` and explicit `ALLOWED_HOSTS`.
2. Run `scripts/init-local-security.py`. It generates `SECRET_KEY`, `DATA_ENCRYPTION_KEYS`, `BACKUP_ENCRYPTION_KEY`, `POSTGRES_PASSWORD` and `APP_DB_PASSWORD` (the limited role that row-level security applies to).
3. Set `BOOTSTRAP_ADMIN_PASSWORD` (at least 14 characters). The first admin must change it on first sign-in.
4. Put TLS in front of the `frontend` container (a reverse proxy or load balancer). Set `WEBAUTHN_RP_ID` to your domain and `WEBAUTHN_ORIGINS` to the exact https origin.
5. Optional:
   * `STORAGE_BACKEND=s3` + `S3_*` for documents, so API replicas can scale horizontally;
   * `RESEND_*` for password-reset email;
   * an AI provider under Settings → AI (https only, unless `AI_ALLOW_LOCAL_PROVIDER=true` for a local model server).
6. Keep `./backups` and the encryption keys somewhere else as well; see [backups.md](backups.md).

Upgrades: `docker compose up -d --build`. Migrations run automatically, as the owner account, before the API starts.

---

﻿# Deployment

## Production Deployment

1. Copy `.env.example` to `.env` and configure all values
2. Set a strong `SECRET_KEY`
3. Configure `TELEGRAM_BOT_TOKEN`
4. Set `CORS_ALLOWED_ORIGINS` to your domain
5. Build and start: `docker compose up -d --build`

## Reverse Proxy

For production, place Nginx or Caddy in front:

```nginx
server {
    listen 443 ssl;
    server_name records.company.local;

    location / {
        proxy_pass http://frontend:80;
    }

    location /api/ {
        proxy_pass http://backend:8000;
    }
}
```

## Health Checks

- `GET /api/v1/health` - Liveness
- `GET /api/v1/health/ready` - Readiness (includes DB check)
