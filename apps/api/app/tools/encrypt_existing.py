"""Re-encrypt persisted secrets with the first configured key. Run after backup."""
import asyncio
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified
from app.db.session import AsyncSessionLocal
from app.models.reminder import TelegramBot
from app.models.delivery import ReminderDelivery
from app.models.record import RecordValue
from app.models.user import User
from app.services.encryption import cipher, PREFIX


async def main():
    crypt = cipher()
    for model, attribute in ((TelegramBot, 'bot_token'), (ReminderDelivery, 'message')):
        cursor = 0; count = 0
        while True:
            async with AsyncSessionLocal() as db:
                rows = (await db.execute(select(model).where(model.id > cursor).order_by(model.id).limit(100).with_for_update())).scalars().all()
                if not rows: break
                for row in rows:
                    flag_modified(row, attribute)
                cursor = rows[-1].id; count += len(rows)
                await db.commit()
        print(model.__tablename__, 'encrypted rows:', count)
    async with AsyncSessionLocal() as db:
        users = (await db.execute(select(User).with_for_update())).scalars().all()
        for user in users:
            for attribute in ('mfa_secret', 'mfa_pending_secret'):
                value = getattr(user, attribute)
                if value and value.startswith(PREFIX):
                    setattr(user, attribute, PREFIX + crypt.rotate(value[len(PREFIX):].encode()).decode())
        await db.commit()
    cursor = 0
    while True:
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(RecordValue).where(RecordValue.id > cursor).order_by(RecordValue.id).limit(500).with_for_update())).scalars().all()
            if not rows: break
            for row in rows:
                value = row.value or {}
                if value.get('secret'):
                    row.value = {'secret': PREFIX + crypt.rotate(value['secret'][len(PREFIX):].encode()).decode()}
            cursor = rows[-1].id
            await db.commit()
    print('Encryption rotation completed; no secret values displayed.')
    from app.services.report_jobs import ROOT
    for path in ROOT.glob('*.enc'):
        path.write_bytes(crypt.rotate(path.read_bytes()))
    from app.models.audit import AuditLog
    from app.services.audit import intact, seal
    async with AsyncSessionLocal() as db:
        rows = await db.stream_scalars(select(AuditLog).where(AuditLog.integrity.is_not(None)).execution_options(yield_per=200))
        async for row in rows:
            if not intact(row): raise ValueError('Audit integrity failed; investigate before rotating keys')
            seal(row)
        await db.commit()


if __name__ == '__main__':
    asyncio.run(main())
