import asyncio
import logging


from app.core.config import get_settings
from app.db.session import AsyncSessionLocal
from app.services.reminder import process_due_reminders
from app.services.delivery import dispatch_deliveries
from app.services.operations import heartbeat
from app.services.report_jobs import report_loop

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("worker")


async def run_reminder_cycle():
    await heartbeat('schedule')
    async with AsyncSessionLocal() as db:
        try:
            result = await process_due_reminders(db)
            await db.commit()
            from app.services.asset_alerts import run_asset_digest
            result["asset_digest"] = await run_asset_digest(db)
            await db.commit()
            await heartbeat('schedule', success=True)
            logger.info("Reminder cycle completed: %s", result)
        except Exception:
            await db.rollback()
            await heartbeat('schedule', failure=True)
            logger.exception("Reminder cycle failed")


async def schedule_loop():
    settings = get_settings()
    logger.info("Worker started (interval=%ss)", settings.WORKER_INTERVAL_SECONDS)
    while True:
        await run_reminder_cycle()
        await asyncio.sleep(settings.WORKER_INTERVAL_SECONDS)


async def delivery_loop():
    while True:
        try:
            result = await dispatch_deliveries()
            await heartbeat('dispatch', success=True)
            if result["delivered"] or result["delivery_failures"]:
                logger.info("Delivery batch completed: %s", result)
        except Exception:
            await heartbeat('dispatch', failure=True)
            logger.exception("Delivery batch failed; durable jobs will be retried")
        await asyncio.sleep(5)


async def main():
    settings = get_settings()
    settings.validate_production()
    await asyncio.gather(schedule_loop(), delivery_loop(), report_loop())


if __name__ == "__main__":
    asyncio.run(main())
