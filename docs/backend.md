# Backend

## Stack

- Python 3.12+
- FastAPI
- SQLAlchemy 2.x (async)
- Alembic
- Pydantic v2
- PostgreSQL

## Structure

```
apps/api/
├── app/
│   ├── api/v1/        # Route handlers
│   ├── core/          # Config, security, exceptions
│   ├── db/            # Database session, base
│   ├── models/        # SQLAlchemy models
│   ├── schemas/       # Pydantic schemas
│   ├── services/      # Business logic
│   ├── workers/       # Background scheduler
│   ├── reports/       # Excel/PDF generation
│   └── main.py        # FastAPI app
├── alembic/           # Migrations
├── tests/             # Test suite
└── requirements.txt
```

## Running Locally

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Migrations

```bash
alembic upgrade head
alembic revision --autogenerate -m "description"
```
