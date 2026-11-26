from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator


class RenewalCreate(BaseModel):
    new_date: str = Field(min_length=8, max_length=10, description="New renewal/expiry date (YYYY-MM-DD)")
    renewed_on: str | None = Field(default=None, min_length=8, max_length=10, description="Date the renewal was made (YYYY-MM-DD); defaults to today")
    cost: float | None = None
    currency: str | None = Field(default=None, max_length=10)
    payment_method: str | None = Field(default=None, max_length=100)
    payment_reference: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    notes: str | None = None

    @field_validator("new_date")
    @classmethod
    def validate_date(cls, v: str) -> str:
        from datetime import datetime
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("new_date must be a valid date in YYYY-MM-DD format")
        return v

    @field_validator("renewed_on")
    @classmethod
    def validate_renewed_on(cls, v: str | None) -> str | None:
        if v is None:
            return v
        from datetime import datetime
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("renewed_on must be a valid date in YYYY-MM-DD format")
        return v


class RenewalUpdate(BaseModel):
    """Admin edits to an existing renewal-history entry."""
    new_date: str | None = Field(default=None, min_length=8, max_length=10)
    renewed_on: str | None = Field(default=None, min_length=8, max_length=10)
    cost: float | None = None
    currency: str | None = Field(default=None, max_length=10)
    payment_method: str | None = Field(default=None, max_length=100)
    payment_reference: str | None = Field(default=None, max_length=255)
    location: str | None = Field(default=None, max_length=255)
    notes: str | None = None

    @field_validator("new_date")
    @classmethod
    def validate_date(cls, v: str | None) -> str | None:
        if v is None:
            return v
        from datetime import datetime
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("new_date must be a valid date in YYYY-MM-DD format")
        return v

    @field_validator("renewed_on")
    @classmethod
    def validate_renewed_on(cls, v: str | None) -> str | None:
        if v is None:
            return v
        from datetime import datetime
        try:
            datetime.strptime(v, "%Y-%m-%d")
        except ValueError:
            raise ValueError("renewed_on must be a valid date in YYYY-MM-DD format")
        return v


class RenewalResponse(BaseModel):
    id: int
    record_id: int
    renewed_by_name: str | None = None
    renewed_on: date | None = None
    old_date: date | None
    new_date: date
    cost: float | None
    currency: str | None = None
    payment_method: str | None = None
    payment_reference: str | None = None
    location: str | None = None
    notes: str | None = None
    renewed_at: datetime


class AutoRenewalLogEntry(BaseModel):
    id: int
    record_id: int
    record_name: str
    record_type: str
    record_type_slug: str
    can_open: bool
    created_at: datetime
    renewed_on: date | None
    old_date: date | None
    new_date: date
