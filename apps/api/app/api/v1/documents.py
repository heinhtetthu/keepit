import json
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import Response
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.config import get_settings
from app.core.exceptions import ValidationException
from app.db.session import get_db
from app.models.document import DOCUMENT_CATEGORIES
from app.schemas.document import DocumentLinkIn, DocumentListResponse, DocumentResponse, DocumentUpdate
from app.services import document as svc
from app.services.documents.validation import INLINE_PREVIEWABLE

router = APIRouter(prefix="/documents", tags=["documents"])
DB = Depends(get_db, scope="function")


@router.get("/categories")
async def categories(user=Depends(require_permission("document.view"))):
    return list(DOCUMENT_CATEGORIES)


@router.get("", response_model=DocumentListResponse)
async def list_documents(q: str | None = Query(None, max_length=200), category: str | None = None,
                         entity_type: str | None = None, entity_id: int | None = None,
                         expiring_before: date | None = None, deleted: bool = False,
                         page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
                         db: AsyncSession = DB, user=Depends(require_permission("document.view"))):
    return await svc.list_documents(db, q=q, category=category, entity_type=entity_type, entity_id=entity_id,
                                    expiring_before=expiring_before, deleted=deleted, page=page, page_size=page_size)


@router.post("", response_model=DocumentResponse, status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    category: str = Form("Other"),
    title: str | None = Form(None),
    description: str | None = Form(None),
    tags: str | None = Form(None, description="JSON array or comma-separated"),
    reference_number: str | None = Form(None),
    expiry_date: date | None = Form(None),
    links: str | None = Form(None, description='JSON: [{"entity_type": "asset", "entity_id": 1}]'),
    db: AsyncSession = DB, user=Depends(require_permission("document.upload")),
):
    data = await file.read(get_settings().MAX_DOCUMENT_BYTES + 1)
    tag_list: list[str] = []
    if tags:
        try:
            parsed = json.loads(tags)
            tag_list = [str(t) for t in parsed] if isinstance(parsed, list) else []
        except ValueError:
            tag_list = [t for t in tags.split(",")]
    try:
        link_list = TypeAdapter(list[DocumentLinkIn]).validate_json(links) if links else []
    except ValidationError:
        raise ValidationException("links must be a JSON list of {entity_type, entity_id}")
    doc = await svc.upload(db, file_name=file.filename or "", content_type=file.content_type, data=data, title=title,
                           category=category, description=description, tags=tag_list, reference_number=reference_number,
                           expiry_date=expiry_date, links=link_list, user_id=user.id)
    return await svc.serialize(db, doc)


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(doc_id: int, db: AsyncSession = DB, user=Depends(require_permission("document.view"))):
    return await svc.serialize(db, await svc.get_document(db, doc_id))


@router.get("/{doc_id}/file")
async def download(doc_id: int, download: bool = False, db: AsyncSession = DB, user=Depends(require_permission("document.view"))):
    doc, data = await svc.read_file(db, doc_id)
    inline = doc.mime_type in INLINE_PREVIEWABLE and not download
    disposition = f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(doc.file_name)}"
    return Response(content=data, media_type=doc.mime_type, headers={
        "Content-Disposition": disposition, "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, max-age=300"})


@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_document(doc_id: int, data: DocumentUpdate, db: AsyncSession = DB, user=Depends(require_permission("document.edit"))):
    return await svc.serialize(db, await svc.update(db, doc_id, data, user.id))


@router.post("/{doc_id}/links", response_model=DocumentResponse)
async def add_link(doc_id: int, data: DocumentLinkIn, db: AsyncSession = DB, user=Depends(require_permission("document.edit"))):
    return await svc.serialize(db, await svc.add_link(db, doc_id, data, user.id))


@router.delete("/{doc_id}/links/{link_id}", response_model=DocumentResponse)
async def remove_link(doc_id: int, link_id: int, db: AsyncSession = DB, user=Depends(require_permission("document.edit"))):
    return await svc.serialize(db, await svc.remove_link(db, doc_id, link_id, user.id))


@router.delete("/{doc_id}", status_code=204)
async def delete_document(doc_id: int, db: AsyncSession = DB, user=Depends(require_permission("document.delete"))):
    await svc.soft_delete(db, doc_id, user.id)


@router.post("/{doc_id}/restore", response_model=DocumentResponse)
async def restore_document(doc_id: int, db: AsyncSession = DB, user=Depends(require_permission("document.delete"))):
    return await svc.serialize(db, await svc.restore(db, doc_id, user.id))
