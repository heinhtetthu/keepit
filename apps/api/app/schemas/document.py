from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

EntityType = Literal["asset", "employee", "record", "borrow"]


class DocumentLinkIn(BaseModel):
    entity_type: EntityType
    entity_id: int


class DocumentLinkOut(DocumentLinkIn):
    id: int
    label: str | None = None
    model_config = {"from_attributes": True}


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    category: str | None = Field(default=None, max_length=50)
    tags: list[str] | None = Field(default=None, max_length=30)
    reference_number: str | None = Field(default=None, max_length=100)
    expiry_date: date | None = None


class DocumentResponse(BaseModel):
    id: int
    title: str
    description: str | None
    category: str
    tags: list[str]
    reference_number: str | None
    expiry_date: date | None
    file_name: str
    mime_type: str
    size_bytes: int
    uploaded_by: int | None
    uploaded_by_name: str | None = None
    created_at: datetime
    updated_at: datetime
    previewable: bool = False
    links: list[DocumentLinkOut] = []
    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    items: list[DocumentResponse]
    page: int
    page_size: int
    total: int
    total_pages: int
