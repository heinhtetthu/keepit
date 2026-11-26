from datetime import datetime
from pydantic import BaseModel, Field


class FieldOptionCreate(BaseModel):
    value: str = Field(min_length=1, max_length=255)
    label: str = Field(min_length=1, max_length=255)
    display_order: int = 0


class FieldOptionResponse(BaseModel):
    id: int
    value: str
    label: str
    display_order: int

    model_config = {"from_attributes": True}


class RecordFieldCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    field_type: str = Field(min_length=1, max_length=50)
    required: bool = False
    unique: bool = False
    searchable: bool = True
    sortable: bool = True
    filterable: bool = True
    show_in_list: bool = True
    show_in_details: bool = True
    show_in_reports: bool = True
    display_order: int = 0
    default_value: str | None = None
    help_text: str | None = None
    options: list[FieldOptionCreate] = []


class RecordFieldUpdate(BaseModel):
    name: str | None = None
    field_type: str | None = None
    required: bool | None = None
    unique: bool | None = None
    searchable: bool | None = None
    sortable: bool | None = None
    filterable: bool | None = None
    show_in_list: bool | None = None
    show_in_details: bool | None = None
    show_in_reports: bool | None = None
    display_order: int | None = None
    default_value: str | None = None
    help_text: str | None = None
    active: bool | None = None


class RecordFieldResponse(BaseModel):
    id: int
    record_type_id: int
    name: str
    slug: str
    field_type: str
    required: bool
    unique: bool
    searchable: bool
    sortable: bool
    filterable: bool
    show_in_list: bool
    show_in_details: bool
    show_in_reports: bool
    display_order: int
    default_value: str | None
    help_text: str | None
    active: bool
    options: list[FieldOptionResponse]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class FieldReorderRequest(BaseModel):
    field_ids: list[int]


class RecordTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    icon: str | None = None
    telegram_bot_id: int | None = None
    fields: list[RecordFieldCreate] = []


class RecordTypeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    active: bool | None = None
    reminder_field_id: int | None = None
    telegram_bot_id: int | None = None
    track_ownership: bool | None = None
    renew_before_days: int | None = Field(default=None, ge=0, le=365)  # 0 clears the default


class RecordTypeResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None
    icon: str | None
    active: bool
    reminder_field_id: int | None = None
    telegram_bot_id: int | None = None
    track_ownership: bool = False
    renew_before_days: int | None = None
    created_at: datetime
    updated_at: datetime
    fields: list[RecordFieldResponse]

    model_config = {"from_attributes": True}


class RecordTypeSummary(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None
    icon: str | None
    active: bool
    reminder_field_id: int | None = None
    telegram_bot_id: int | None = None
    track_ownership: bool = False
    renew_before_days: int | None = None
    fields: list["RecordFieldResponse"] = []

    model_config = {"from_attributes": True}
