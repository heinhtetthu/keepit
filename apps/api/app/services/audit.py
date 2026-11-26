from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
import re
import base64
import hashlib
import hmac
import json
from app.core.config import get_settings
from app.services.actor import current_actor
from app.services.query_cache import invalidate


def signatures(entry):
    fields = ('id', 'actor_snapshot', 'action', 'entity_type', 'entity_id', 'entity_name',
              'old_values', 'new_values', 'details', 'ip_address')
    payload = {name: getattr(entry, name) for name in fields}
    payload['timestamp'] = entry.timestamp.astimezone(timezone.utc).isoformat()
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':'), default=str).encode()
    return [hmac.new(base64.urlsafe_b64decode(key.strip()), b'renewly-audit-v1:' + raw, hashlib.sha256).hexdigest()
            for key in get_settings().DATA_ENCRYPTION_KEYS.split(',') if key.strip()]


def seal(entry):
    entry.integrity = signatures(entry)[0]


def intact(entry):
    return entry.integrity is not None and any(hmac.compare_digest(entry.integrity, value) for value in signatures(entry))


def redact(value):
    if isinstance(value, dict):
        return {key: '[REDACTED]' if re.search(r'password|token|secret|recovery|license.?key|api.?key', str(key), re.I)
                else redact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


async def log_audit(
    db: AsyncSession,
    action: str,
    entity_type: str,
    entity_id: int | None = None,
    entity_name: str | None = None,
    old_values: dict | None = None,
    new_values: dict | None = None,
    details: str | None = None,
    user_id: int | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    if entity_type in ('record', 'record_type', 'record_batch', 'settings'):
        await invalidate(db)
    entry = AuditLog(
        user_id=user_id if user_id is not None else current_actor.get(),
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_name=entity_name,
        old_values=redact(old_values),
        new_values=redact(new_values),
        details=details,
        ip_address=ip_address,
        timestamp=datetime.now(timezone.utc),
    )
    db.add(entry)
    await db.flush()
    entry.actor_snapshot = entry.user_id
    seal(entry)
    return entry
