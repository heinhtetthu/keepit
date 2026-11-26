from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


def _validate_date(v: str | None, label: str) -> str | None:
    if v is None:
        return v
    from datetime import datetime as dt
    try:
        dt.strptime(v, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"{label} must be a valid date in YYYY-MM-DD format")
    return v


class AssignmentCreate(BaseModel):
    """Hand a seat to a new holder, or release it (`unassign`)."""
    unassign: bool = False
    employee_id: int | None = None
    employee_name: str | None = Field(default=None, max_length=200)  # free-text fallback
    business_unit: str | None = Field(default=None, max_length=100)
    effective_date: str = Field(min_length=8, max_length=10)
    # Cost of the seat under this assignment; None → inherit the record's current
    # Cost value. A different value updates the record's Cost field as well.
    cost: float | None = None
    currency: str | None = Field(default=None, max_length=10)
    reason: str | None = Field(default=None, max_length=100)
    notes: str | None = None

    @field_validator("effective_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        return _validate_date(v, "effective_date") or v


class SwapRequest(BaseModel):
    """Exchange the holders of two seats of the same record type."""
    other_record_id: int
    effective_date: str = Field(min_length=8, max_length=10)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("effective_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        return _validate_date(v, "effective_date") or v


class ReleaseRequest(BaseModel):
    """Offboarding: unassign every seat an employee holds."""
    effective_date: str = Field(min_length=8, max_length=10)
    reason: str = Field(default="Resignation", max_length=100)
    deactivate: bool = True

    @field_validator("effective_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        return _validate_date(v, "effective_date") or v


class Holding(BaseModel):
    record_id: int
    name: str
    record_type_id: int
    record_type_name: str
    record_type_slug: str
    product: str | None
    since: date | None


class AssignmentUpdate(BaseModel):
    """Admin corrections to an ownership-history entry."""
    employee_id: int | None = None
    employee_name: str | None = Field(default=None, max_length=200)
    business_unit: str | None = Field(default=None, max_length=100)
    effective_date: str | None = Field(default=None, min_length=8, max_length=10)
    cost: float | None = None
    currency: str | None = Field(default=None, max_length=10)
    reason: str | None = Field(default=None, max_length=100)
    notes: str | None = None

    @field_validator("effective_date")
    @classmethod
    def validate_date(cls, v: str | None) -> str | None:
        return _validate_date(v, "effective_date")


class AssignmentResponse(BaseModel):
    id: int
    record_id: int
    employee_id: int | None
    employee_name: str
    business_unit: str | None
    effective_date: date
    cost: float | None
    currency: str | None
    reason: str | None
    notes: str | None
    created_by: int | None
    created_at: datetime


class BulkAssignItem(BaseModel):
    record_id: int
    unassign: bool = False
    employee_id: int | None = None
    employee_name: str | None = Field(default=None, max_length=200)
    business_unit: str | None = Field(default=None, max_length=100)


class BulkAssignRequest(BaseModel):
    """Several seat changes applied together (reassign, unassign, swap, rotate)."""
    items: list[BulkAssignItem] = Field(min_length=1, max_length=200)
    effective_date: str = Field(min_length=8, max_length=10)
    reason: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("effective_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        return _validate_date(v, "effective_date") or v
