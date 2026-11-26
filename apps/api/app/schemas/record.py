from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class RecordValueInput(BaseModel):
    field_id: int
    value: Any = None


class RecordCreate(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    status: str = "active"
    values: list[RecordValueInput] = []


class RecordUpdate(BaseModel):
    expected_updated_at: datetime | None = None
    name: str | None = Field(default=None, min_length=1, max_length=500)
    status: str | None = None
    values: list[RecordValueInput] | None = None


class RecordValueResponse(BaseModel):
    field_id: int
    field_name: str
    field_slug: str
    field_type: str
    value: Any
    display_value: str | None = None

    model_config = {"from_attributes": True}


class RecordResponse(BaseModel):
    id: int
    record_type_id: int
    record_type_name: str
    record_type_slug: str
    name: str
    status: str
    archived: bool
    reminder_field_id: int | None
    renew_before_days: int | None = None
    values: list[RecordValueResponse]
    created_by: int | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None

    model_config = {"from_attributes": True}


class RecordListResponse(BaseModel):
    id: int
    name: str
    status: str
    archived: bool
    record_type_id: int
    record_type_name: str
    record_type_slug: str
    reminder_date: datetime | None = None
    reminder_field_id: int | None = None
    values: dict[str, Any] = {}
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RecordFilter(BaseModel):
    search: str | None = None
    status: str | None = None
    filters: dict[str, Any] | None = None
    sort: str | None = None
    order: str = "asc"
    page: int = 1
    page_size: int = 25


class RecordRenewalOptionsUpdate(BaseModel):
    """Per-record renewal timing: how many days before expiry to renew."""
    renew_before_days: int | None = Field(default=None, ge=1, le=365)


class BulkArchiveRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)


class BulkStatusRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)
    status: str = Field(min_length=1, max_length=50)


class BulkDeleteRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)
