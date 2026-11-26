# Development

## Prerequisites

- Python 3.12+
- Node.js 20+
- Docker

## Backend Setup

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Frontend Setup

```bash
cd apps/web
npm install
npm run dev
```

## Running Tests

```bash
# Backend
cd apps/api
pytest

# Frontend
cd apps/web
npm run lint
```

## Database Migrations

```bash
cd apps/api
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## Code Style

- Backend: PEP 8, type hints
- Frontend: ESLint, Prettier
