from typing import Any

from pydantic import BaseModel, Field


class SavedViewCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    record_type_id: int | None = None
    # "records" (with record_type_id) or a list key such as "assets", "employees", "borrows".
    scope: str = Field(default="records", pattern=r"^[a-z][a-z0-9_-]{1,19}$")
    filters: dict[str, Any] | None = None
    sort: dict[str, Any] | None = None
    visible_columns: list[str] | None = None


class SavedViewUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    filters: dict[str, Any] | None = None
    sort: dict[str, Any] | None = None
    visible_columns: list[str] | None = None


class SavedViewResponse(BaseModel):
    id: int
    name: str
    record_type_id: int | None
    scope: str = "records"
    filters: dict[str, Any] | None
    sort: dict[str, Any] | None
    visible_columns: list[str] | None

    model_config = {"from_attributes": True}
