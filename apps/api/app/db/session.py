from collections.abc import AsyncGenerator

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(settings.DATABASE_URL, echo=False, pool_pre_ping=True, pool_size=10, max_overflow=20)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


_RLS_SQL = text("SELECT set_config('app.user_id', :uid, true), set_config('app.is_admin', :admin, true)")


def _rls_params(ctx: dict) -> dict:
    return {"uid": str(ctx["user_id"]), "admin": "on" if ctx["is_admin"] else "off"}


@event.listens_for(Session, "after_begin")
def _reapply_rls(session, transaction, connection):
    """Row-level security context survives commits: re-set it for every new transaction."""
    ctx = session.info.get("rls")
    if ctx:
        connection.execute(_RLS_SQL, _rls_params(ctx))


async def set_rls_context(db: AsyncSession, user) -> None:
    """Scope this request's database session to the signed-in user (see app/db/rls.py)."""
    ctx = {"user_id": user.id, "is_admin": bool(user.is_superuser)}
    db.sync_session.info["rls"] = ctx
    await db.execute(_RLS_SQL, _rls_params(ctx))
