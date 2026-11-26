from datetime import datetime

from pydantic import BaseModel, Field


class BusinessUnitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    active: bool = True


class BusinessUnitUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    active: bool | None = None


class BusinessUnitResponse(BaseModel):
    id: int
    name: str
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
