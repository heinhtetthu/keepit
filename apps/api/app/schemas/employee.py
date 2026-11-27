from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

# Employees carry a contact email only - internal domains like .local are
# legitimate, so this is validated loosely (unlike login accounts).
EMAIL_MAX = 255


def clean_bus(value: list[str]) -> list[str]:
    out: list[str] = []
    for item in value:
        s = (item or "").strip()
        if s and s not in out:
            out.append(s)
    return out


class EmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=EMAIL_MAX)
    # One employee may belong to several business units.
    business_units: list[str] = Field(default_factory=list)
    # Deprecated single-unit input, kept for compatibility with existing clients.
    business_unit: str | None = Field(default=None, max_length=100)
    title: str | None = Field(default=None, max_length=100)
    department: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    active: bool = True
    username: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    regions: list[str] = Field(default_factory=list)
    gender: Literal["Male", "Female", "Other"] | None = None
    avatar_url: str | None = Field(default=None, max_length=2000)
    join_date: date | None = None
    resignation_date: date | None = None

    def resolved_business_units(self) -> list[str]:
        if self.business_units:
            return clean_bus(self.business_units)
        return clean_bus([self.business_unit]) if self.business_unit else []


class EmployeeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    email: str | None = Field(default=None, max_length=EMAIL_MAX)
    business_units: list[str] | None = None
    business_unit: str | None = Field(default=None, max_length=100)
    title: str | None = Field(default=None, max_length=100)
    department: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    active: bool | None = None
    username: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    regions: list[str] | None = None
    gender: Literal["Male", "Female", "Other"] | None = None
    avatar_url: str | None = Field(default=None, max_length=2000)
    join_date: date | None = None
    resignation_date: date | None = None

    def resolved_business_units(self) -> list[str] | None:
        if self.business_units is None:
            if "business_unit" not in self.model_fields_set:
                return None
            return clean_bus([self.business_unit]) if self.business_unit else []
        return clean_bus(self.business_units) if self.business_units is not None else []


class EmployeeResponse(BaseModel):
    id: int
    name: str
    email: str | None
    business_units: list[str] = []
    title: str | None
    department: str | None = None
    country: str | None = None
    active: bool
    username: str | None = None
    phone: str | None = None
    regions: list[str] = []
    gender: str | None = None
    avatar_url: str | None = None
    join_date: date | None = None
    resignation_date: date | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EmployeeImportRequest(BaseModel):
    """One-time bulk import. Upserts by exact (case-insensitive) name."""
    items: list[EmployeeCreate]


class EmployeeImportResponse(BaseModel):
    created: int
    updated: int


class EmployeeBulkUpdate(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)
    business_units: list[str] | None = None
    department: str | None = Field(default=None, max_length=100)
    active: bool | None = None


class EmployeeBulkDelete(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)


class EmployeeBulkResponse(BaseModel):
    updated: int
    deleted: int = 0
