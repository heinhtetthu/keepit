from datetime import datetime, timedelta, timezone
from hashlib import sha256
import hmac
from sqlalchemy import case, delete
from sqlalchemy.dialects.postgresql import insert
from app.models.security import RateBucket
from app.core.config import get_settings
from app.core.exceptions import AppException


async def limit(db, identity, maximum=20, seconds=600):
    now = datetime.now(timezone.utc)
    key = hmac.new(get_settings().SECRET_KEY.encode(), identity.encode(), sha256).hexdigest()
    expired = RateBucket.started_at < now - timedelta(seconds=seconds)
    stmt = insert(RateBucket).values(key=key, count=1, started_at=now).on_conflict_do_update(
        index_elements=[RateBucket.key], set_={'count': case((expired, 1), else_=RateBucket.count + 1),
                                              'started_at': case((expired, now), else_=RateBucket.started_at)},
    ).returning(RateBucket.count)
    count = (await db.execute(stmt)).scalar_one()
    await db.execute(delete(RateBucket).where(RateBucket.started_at < now - timedelta(days=1)))
    await db.commit()  # Persist attempts even when authentication subsequently fails.
    if count > maximum:
        raise AppException('RATE_LIMITED', 'Too many attempts. Please wait ten minutes before trying again.', 429)
