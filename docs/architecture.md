# Architecture

> Unified app: see the README for the monorepo layout. Asset features follow the same layering
> (router → schema → service → model), and every client (web, mobile, MCP) talks to the same REST API.

## Overview

The system follows a decoupled apps/web/backend architecture:

- **Frontend**: React SPA served by Nginx
- **Backend**: FastAPI REST API
- **Database**: PostgreSQL
- **Worker**: Background scheduler for reminders

## Design Principles

1. Frontend and backend are completely decoupled
2. All communication via REST API
3. Generic record engine - no hard-coded record types
4. Telegram is only a notification channel
5. Backend permissions are authoritative

## Layers

```
API Route → Schema Validation → Service Layer → Repository → PostgreSQL
```

## Key Components

- `apps/api/app/api/` - FastAPI route handlers
- `apps/api/app/services/` - Business logic
- `apps/api/app/repositories/` - Data access
- `apps/api/app/models/` - SQLAlchemy models
- `apps/api/app/schemas/` - Pydantic schemas
- `apps/api/app/workers/` - Background scheduler
- `apps/api/app/reports/` - Excel/PDF generation
