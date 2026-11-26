"""Small permission/revision-scoped process cache; no report data is persisted."""
from collections import OrderedDict
import copy
import json
import time
from sqlalchemy import select, text
from app.models.settings import SystemSetting

_cache = OrderedDict()
_bytes = 0


def clear():
    global _bytes
    _cache.clear()
    _bytes = 0


async def revision(db):
    return (await db.execute(select(SystemSetting.value).where(SystemSetting.key == 'data_revision'))).scalar_one_or_none() or '0'


async def invalidate(db):
    await db.execute(text("INSERT INTO system_settings (key,value) VALUES ('data_revision','1') ON CONFLICT (key) DO UPDATE SET value=(CAST(system_settings.value AS bigint)+1)::text"))


def get(key):
    entry = _cache.get(key)
    if not entry or entry[0] < time.monotonic(): return None
    _cache.move_to_end(key)
    return copy.deepcopy(entry[1])


def put(key, value):
    global _bytes
    size = len(json.dumps(value, default=str).encode())
    if size > 1024 * 1024: return
    if key in _cache: _bytes -= _cache.pop(key)[2]
    _cache[key] = (time.monotonic() + 15, copy.deepcopy(value), size)
    _bytes += size
    while len(_cache) > 128 or _bytes > 16 * 1024 * 1024:
        _, entry = _cache.popitem(last=False); _bytes -= entry[2]
