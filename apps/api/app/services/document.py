"""Documents: upload, metadata, links to assets/employees/records/borrows,
download, soft delete. Files go through the pluggable storage backend."""
import hashlib
from datetime import date, datetime, timedelta, timezone
from math import ceil
from typing import Any

from sqlalchemy import and_, cast, func, or_, select, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import ConflictException, NotFoundException, ValidationException
from app.models.asset import Asset, AssetBorrow
from app.models.document import DOCUMENT_CATEGORIES, Document, DocumentLink
from app.models.employee import Employee
from app.models.record import Record
from app.models.user import User
from app.schemas.document import DocumentLinkIn, DocumentUpdate
from app.services.audit import log_audit
from app.services.documents.storage import get_storage, new_key
from app.services.documents.validation import INLINE_PREVIEWABLE, extension, validate_upload

ENTITY_MODELS = {"asset": Asset, "employee": Employee, "record": Record, "borrow": AssetBorrow}


def _clean_tags(tags: list[str] | None) -> list[str]:
    out: list[str] = []
    for t in tags or []:
        t = str(t).strip()[:40]
        if t and t.lower() not in [x.lower() for x in out]:
            out.append(t)
    return out[:30]


async def _entity_label(db: AsyncSession, entity_type: str, entity_id: int) -> str | None:
    model = ENTITY_MODELS[entity_type]
    obj = await db.get(model, entity_id)
    if obj is None:
        return None
    if isinstance(obj, Asset):
        return obj.display_name
    if isinstance(obj, AssetBorrow):
        return f"{obj.item_name} → {obj.borrower_name}"
    return obj.name


async def serialize(db: AsyncSession, doc: Document, with_labels: bool = True) -> dict[str, Any]:
    links = []
    for link in doc.links:
        label = await _entity_label(db, link.entity_type, link.entity_id) if with_labels else None
        links.append({"id": link.id, "entity_type": link.entity_type, "entity_id": link.entity_id, "label": label})
    uploader = await db.get(User, doc.uploaded_by) if doc.uploaded_by else None
    return {**{c: getattr(doc, c) for c in ("id", "title", "description", "category", "tags", "reference_number",
                                            "expiry_date", "file_name", "mime_type", "size_bytes", "uploaded_by",
                                            "created_at", "updated_at")},
            "uploaded_by_name": uploader.name if uploader else None,
            "previewable": doc.mime_type in INLINE_PREVIEWABLE, "links": links}


async def get_document(db: AsyncSession, doc_id: int, include_deleted: bool = False) -> Document:
    doc = await db.get(Document, doc_id)
    if doc is None or (doc.deleted_at is not None and not include_deleted):
        raise NotFoundException("Document not found")
    return doc


async def _ensure_entity(db: AsyncSession, link: DocumentLinkIn) -> None:
    if await db.get(ENTITY_MODELS[link.entity_type], link.entity_id) is None:
        raise NotFoundException(f"{link.entity_type.capitalize()} {link.entity_id} not found")


async def upload(db: AsyncSession, *, file_name: str, content_type: str | None, data: bytes, title: str | None,
                 category: str, description: str | None, tags: list[str], reference_number: str | None,
                 expiry_date: date | None, links: list[DocumentLinkIn], user_id: int) -> Document:
    if category not in DOCUMENT_CATEGORIES:
        raise ValidationException(f"Unknown category. Use one of: {', '.join(DOCUMENT_CATEGORIES)}")
    err, mime = validate_upload(file_name, content_type, data, get_settings().MAX_DOCUMENT_BYTES)
    if err:
        raise ValidationException(err)
    for link in links:
        await _ensure_entity(db, link)
    key = new_key(extension(file_name))
    await get_storage().put(key, data, mime)
    doc = Document(title=(title or file_name).strip()[:255], description=description, category=category,
                   tags=_clean_tags(tags), reference_number=reference_number, expiry_date=expiry_date,
                   file_name=file_name.replace("\\", "/").split("/")[-1][:255], storage_key=key, mime_type=mime,
                   size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), uploaded_by=user_id)
    doc.links = [DocumentLink(entity_type=link.entity_type, entity_id=link.entity_id) for link in
                 {(lk.entity_type, lk.entity_id): lk for lk in links}.values()]
    db.add(doc)
    try:
        await db.flush()
    except Exception:
        await get_storage().delete(key)
        raise
    await log_audit(db, "document.upload", "document", doc.id, doc.title,
                    new_values={"file_name": doc.file_name, "category": category, "links": [lk.model_dump() for lk in links]},
                    user_id=user_id)
    return doc


EXPIRY_STATES = ("expired", "expiring", "active", "none")
EXPIRING_DAYS = 30
# File kinds for the "Type" filter, matched on the stored MIME type.
FILE_KINDS = {
    "pdf": ["application/pdf"],
    "image": ["image/%"],
    "text": ["text/%"],
    "office": ["application/msword", "application/vnd.openxmlformats-officedocument%", "application/vnd.ms-%",
               "application/vnd.oasis.opendocument%"],
}
DOCUMENT_SORTS = {"title": Document.title, "category": Document.category, "expiry_date": Document.expiry_date,
                  "size_bytes": Document.size_bytes, "created_at": Document.created_at, "file_name": Document.file_name,
                  "updated_at": Document.updated_at}


def _csv(v: str | None) -> list[str]:
    return [x.strip() for x in (v or "").split(",") if x.strip()]


def _kind_clause(kind: str):
    if kind == "other":
        known = [p for ps in FILE_KINDS.values() for p in ps]
        return and_(*[~Document.mime_type.like(p) for p in known])
    return or_(*[Document.mime_type.like(p) for p in FILE_KINDS.get(kind, [])]) if kind in FILE_KINDS else None


async def list_documents(db: AsyncSession, *, q: str | None = None, category: str | None = None,
                         entity_type: str | None = None, entity_id: int | None = None, expiring_before: date | None = None,
                         deleted: bool = False, page: int = 1, page_size: int = 50, linked: str | None = None,
                         expiry: str | None = None, expiry_from: date | None = None, expiry_to: date | None = None,
                         uploaded_from: date | None = None, uploaded_to: date | None = None, file_type: str | None = None,
                         sort: str | None = None, order: str = "desc") -> dict[str, Any]:
    stmt = select(Document).where(Document.deleted_at.isnot(None) if deleted else Document.deleted_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Document.title.ilike(like), Document.file_name.ilike(like),
                              Document.reference_number.ilike(like), cast(Document.tags, String).ilike(like)))
    if categories := _csv(category):
        stmt = stmt.where(Document.category.in_(categories))
    if entity_type and entity_id:
        stmt = stmt.where(Document.id.in_(select(DocumentLink.document_id).where(
            DocumentLink.entity_type == entity_type, DocumentLink.entity_id == entity_id)))
    if kinds := _csv(linked):
        # "none" = not linked to anything; other values are entity types (asset, employee, record, borrow).
        clauses = []
        types = [k for k in kinds if k in ENTITY_MODELS]
        if types:
            clauses.append(Document.id.in_(select(DocumentLink.document_id).where(DocumentLink.entity_type.in_(types))))
        if "none" in kinds:
            clauses.append(~Document.id.in_(select(DocumentLink.document_id)))
        stmt = stmt.where(or_(*clauses) if clauses else Document.id == -1)
    if expiring_before:
        stmt = stmt.where(Document.expiry_date.isnot(None), Document.expiry_date <= expiring_before)
    if states := [s for s in _csv(expiry) if s in EXPIRY_STATES]:
        d0 = _today()
        by_state = {
            "expired": Document.expiry_date < d0,
            "expiring": Document.expiry_date.between(d0, d0 + timedelta(days=EXPIRING_DAYS)),
            "active": Document.expiry_date > d0 + timedelta(days=EXPIRING_DAYS),
            "none": Document.expiry_date.is_(None),
        }
        stmt = stmt.where(or_(*[by_state[s] for s in states]))
    if expiry_from:
        stmt = stmt.where(Document.expiry_date >= expiry_from)
    if expiry_to:
        stmt = stmt.where(Document.expiry_date <= expiry_to)
    if uploaded_from:
        stmt = stmt.where(func.date(Document.created_at) >= uploaded_from)
    if uploaded_to:
        stmt = stmt.where(func.date(Document.created_at) <= uploaded_to)
    if kinds := [c for c in (_kind_clause(k) for k in _csv(file_type)) if c is not None]:
        stmt = stmt.where(or_(*kinds))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    col = DOCUMENT_SORTS.get(sort or "created_at", Document.created_at)
    direction = col.asc().nulls_last() if order == "asc" else col.desc().nulls_last()
    rows = (await db.execute(stmt.order_by(direction, Document.id.desc())
                             .offset((page - 1) * page_size).limit(page_size))).scalars().all()
    return {"items": [await serialize(db, d, with_labels=False) for d in rows], "page": page, "page_size": page_size,
            "total": total, "total_pages": max(1, ceil(total / page_size))}


async def tab_counts(db: AsyncSession) -> dict[str, int]:
    """Counts for the Documents page tabs."""
    d0 = _today()
    live = Document.deleted_at.is_(None)
    linked = Document.id.in_(select(DocumentLink.document_id))
    row = (await db.execute(select(
        func.count(Document.id),
        func.count(Document.id).filter(Document.expiry_date.between(d0, d0 + timedelta(days=EXPIRING_DAYS))),
        func.count(Document.id).filter(Document.expiry_date < d0),
        func.count(Document.id).filter(~linked),
    ).where(live))).one()
    return {"total": row[0], "expiring": row[1], "expired": row[2], "unlinked": row[3]}


def _today() -> date:
    from app.services.clock import today
    return today()


async def documents_for_entity(db: AsyncSession, entity_type: str, entity_id: int) -> list[dict[str, Any]]:
    return (await list_documents(db, entity_type=entity_type, entity_id=entity_id, page_size=200))["items"]


async def update(db: AsyncSession, doc_id: int, data: DocumentUpdate, user_id: int) -> Document:
    doc = await get_document(db, doc_id)
    changes = data.model_dump(exclude_unset=True)
    if "category" in changes and changes["category"] not in DOCUMENT_CATEGORIES:
        raise ValidationException("Unknown category")
    if "tags" in changes:
        changes["tags"] = _clean_tags(changes["tags"])
    for k, v in changes.items():
        setattr(doc, k, v)
    await db.flush()
    await log_audit(db, "document.update", "document", doc.id, doc.title, new_values=data.model_dump(mode="json", exclude_unset=True), user_id=user_id)
    await db.refresh(doc)
    return doc


async def add_link(db: AsyncSession, doc_id: int, link: DocumentLinkIn, user_id: int) -> Document:
    doc = await get_document(db, doc_id)
    await _ensure_entity(db, link)
    if any(lk.entity_type == link.entity_type and lk.entity_id == link.entity_id for lk in doc.links):
        raise ConflictException("Already linked")
    doc.links.append(DocumentLink(entity_type=link.entity_type, entity_id=link.entity_id))
    await db.flush()
    await log_audit(db, "document.link", "document", doc.id, doc.title, new_values=link.model_dump(), user_id=user_id)
    return doc


async def remove_link(db: AsyncSession, doc_id: int, link_id: int, user_id: int) -> Document:
    doc = await get_document(db, doc_id)
    link = next((lk for lk in doc.links if lk.id == link_id), None)
    if link is None:
        raise NotFoundException("Link not found")
    doc.links.remove(link)
    await db.flush()
    await log_audit(db, "document.unlink", "document", doc.id, doc.title,
                    old_values={"entity_type": link.entity_type, "entity_id": link.entity_id}, user_id=user_id)
    return doc


async def soft_delete(db: AsyncSession, doc_id: int, user_id: int) -> None:
    doc = await get_document(db, doc_id)
    doc.deleted_at = datetime.now(timezone.utc)
    await log_audit(db, "document.delete", "document", doc.id, doc.title, user_id=user_id)


async def restore(db: AsyncSession, doc_id: int, user_id: int) -> Document:
    doc = await get_document(db, doc_id, include_deleted=True)
    doc.deleted_at = None
    await log_audit(db, "document.restore", "document", doc.id, doc.title, user_id=user_id)
    return doc


async def read_file(db: AsyncSession, doc_id: int) -> tuple[Document, bytes]:
    doc = await get_document(db, doc_id)
    return doc, await get_storage().get(doc.storage_key)
