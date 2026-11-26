from datetime import datetime, timezone
import json
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from app.db.session import AsyncSessionLocal
from app.models.settings import SystemSetting


async def heartbeat(kind, success=False, failure=False):
    now = datetime.now(timezone.utc).isoformat()
    updates = {f'worker_{kind}_heartbeat': now}
    if success:
        updates[f'worker_{kind}_success'] = now
        updates[f'worker_{kind}_failure'] = ''
    if failure: updates[f'worker_{kind}_failure'] = now
    async with AsyncSessionLocal() as db, db.begin():
        for key, value in updates.items():
            await db.execute(insert(SystemSetting).values(key=key, value=value).on_conflict_do_update(index_elements=[SystemSetting.key], set_={'value': value}))


async def worker_status(db):
    values = dict((await db.execute(select(SystemSetting.key, SystemSetting.value).where(SystemSetting.key.like('worker_%')))).all())
    now = datetime.now(timezone.utc)
    from app.core.config import get_settings
    result = {}
    for kind, maximum in [('schedule', get_settings().WORKER_INTERVAL_SECONDS * 2 + 60), ('dispatch', 120), ('reports', 660)]:
        value = values.get(f'worker_{kind}_heartbeat')
        try: age = max(0, (now - datetime.fromisoformat(value)).total_seconds())
        except (ValueError, TypeError): age = None
        result[kind] = {'healthy': age is not None and age < maximum and not values.get(f'worker_{kind}_failure'),
                        'heartbeat_age_seconds': age, 'last_success': values.get(f'worker_{kind}_success'),
                        'last_failure': values.get(f'worker_{kind}_failure') or None}
    return result


def backup_status():
    try:
        value = json.loads(Path('/backups/status.json').read_text())
        # Only an allowlist of metadata is exposed; never filenames containing secrets.
        return {key: value.get(key) for key in ('last_success', 'last_restore_verified', 'last_failure', 'error')}
    except (OSError, ValueError):
        return {'error': 'No backup status available'}
