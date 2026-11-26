import asyncio
from app.db.session import AsyncSessionLocal
from app.services.operations import worker_status


async def main():
    async with AsyncSessionLocal() as db:
        status = await worker_status(db)
    if not all(row['healthy'] for row in status.values()):
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
