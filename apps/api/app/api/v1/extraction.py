from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.db.session import get_db
from app.models.document import ExtractionRun
from app.services.extraction import service as svc
from app.services.extraction.fields import DOC_TYPES, describe

router = APIRouter(prefix="/extraction", tags=["extraction"])
DB = Depends(get_db, scope="function")


class RunRequest(BaseModel):
    document_id: int
    doc_type: str = Field(max_length=30)


class ConfirmRequest(BaseModel):
    values: dict = Field(default_factory=dict)
    target: dict = Field(default_factory=dict)


def _out(r: ExtractionRun) -> dict:
    return {c: getattr(r, c) for c in ("id", "document_id", "doc_type", "status", "model", "error", "result",
                                       "confirmed_values", "confirmed_at", "target", "extracted_at")}


@router.get("/doc-types")
async def doc_types(user=Depends(require_permission("document.view"))):
    return [{"key": k, "label": v, "fields": describe(k), "row_based": k == "log-sheet"} for k, v in DOC_TYPES.items()]


@router.get("/runs")
async def runs(document_id: int, db: AsyncSession = DB, user=Depends(require_permission("document.view"))):
    rows = (await db.execute(select(ExtractionRun).where(ExtractionRun.document_id == document_id)
                             .order_by(ExtractionRun.extracted_at.desc()).limit(20))).scalars().all()
    return [_out(r) for r in rows]


@router.post("/runs")
async def run(data: RunRequest, db: AsyncSession = DB, user=Depends(require_permission("extraction.run"))):
    return _out(await svc.run(db, data.document_id, data.doc_type, user.id))


@router.post("/runs/{run_id}/confirm")
async def confirm(run_id: int, data: ConfirmRequest, db: AsyncSession = DB, user=Depends(require_permission("extraction.run"))):
    return await svc.confirm(db, run_id, data.values, data.target, user.id)


@router.post("/runs/{run_id}/reject", status_code=204)
async def reject(run_id: int, db: AsyncSession = DB, user=Depends(require_permission("extraction.run"))):
    await svc.reject(db, run_id, user.id)
