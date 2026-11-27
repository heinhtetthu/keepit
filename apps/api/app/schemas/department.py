from datetime import datetime

from pydantic import BaseModel, Field


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)


class DepartmentResponse(BaseModel):
    id: int
    name: str
    employee_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
