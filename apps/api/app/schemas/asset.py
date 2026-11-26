from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

AssignmentStatus = Literal["Assigned", "Unassigned", "Borrowed"]
ConditionStatus = Literal["Operational", "In Repair", "Written-Off"]
RepairStatus = Literal["In Progress", "Complete"]
BodyCondition = Literal["Good", "Fair", "Needs Repair", "Repaired", "Not Applicable"]


def _clean_specs(v: dict | None) -> dict:
    out: dict[str, str] = {}
    for k, val in (v or {}).items():
        key = str(k).strip()[:50]
        sval = "" if val is None else str(val).strip()[:200]
        if key and sval:
            out[key] = sval
    return out


class AssetBase(BaseModel):
    asset_type: str = Field(min_length=1, max_length=100)
    other_type_name: str | None = Field(default=None, max_length=200)
    brand: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)
    serial_number: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    specs: dict[str, str | None] = Field(default_factory=dict)
    purchase_date: date | None = None
    purchase_cost: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=10)
    supplier: str | None = Field(default=None, max_length=200)
    warranty_end_date: date | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @field_validator("specs")
    @classmethod
    def clean_specs(cls, v):
        return _clean_specs(v)

    @field_validator("serial_number", "brand", "model", "location", "supplier", "other_type_name")
    @classmethod
    def strip(cls, v):
        return (v.strip() or None) if isinstance(v, str) else v


class AssetCreate(AssetBase):
    employee_id: int | None = None
    assigned_from: date | None = None


class AssetUpdate(BaseModel):
    asset_type: str | None = Field(default=None, min_length=1, max_length=100)
    other_type_name: str | None = Field(default=None, max_length=200)
    brand: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)
    serial_number: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    specs: dict[str, str | None] | None = None
    purchase_date: date | None = None
    purchase_cost: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=10)
    supplier: str | None = Field(default=None, max_length=200)
    warranty_end_date: date | None = None
    notes: str | None = Field(default=None, max_length=5000)
    condition_status: ConditionStatus | None = None

    @field_validator("specs")
    @classmethod
    def clean_specs(cls, v):
        return None if v is None else _clean_specs(v)


class EmployeeRef(BaseModel):
    id: int
    name: str
    email: str | None = None
    business_units: list[str] = []
    active: bool = True
    model_config = {"from_attributes": True}


class AssetResponse(AssetBase):
    id: int
    display_name: str
    employee_id: int | None
    employee: EmployeeRef | None = None
    assignment_status: AssignmentStatus
    condition_status: ConditionStatus
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    model_config = {"from_attributes": True}


class AssetListResponse(BaseModel):
    items: list[AssetResponse]
    page: int
    page_size: int
    total: int
    total_pages: int


class AssignRequest(BaseModel):
    employee_id: int | None = None  # None = unassign
    effective_date: date | None = None
    location: str | None = Field(default=None, max_length=200)
    remark: str | None = Field(default=None, max_length=1000)


class BulkAssignItem(BaseModel):
    asset_id: int
    employee_id: int | None


class BulkAssignRequest(BaseModel):
    items: list[BulkAssignItem] = Field(min_length=1, max_length=500)
    effective_date: date | None = None
    remark: str | None = Field(default=None, max_length=1000)


class BulkUpdateRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)
    location: str | None = Field(default=None, max_length=200)
    condition_status: ConditionStatus | None = None
    supplier: str | None = Field(default=None, max_length=200)


class BulkIdsRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)


class AssetImportRequest(BaseModel):
    items: list[AssetCreate] = Field(min_length=1, max_length=5000)


class AssetAssignmentResponse(BaseModel):
    id: int
    asset_id: int
    employee_id: int | None
    employee_name: str
    assigned_from: date
    assigned_to: date | None
    remark: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class AssignmentHistoryImportItem(BaseModel):
    asset_id: int
    employee_id: int
    assigned_from: date
    assigned_to: date | None = None
    remark: str | None = None


# ---- repairs -------------------------------------------------------------
class RepairCreate(BaseModel):
    repair_date: date
    issue: str = Field(min_length=1, max_length=5000)
    status: RepairStatus = "In Progress"
    cost: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=10)
    vendor: str | None = Field(default=None, max_length=200)
    warranty: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=5000)


class RepairUpdate(BaseModel):
    repair_date: date | None = None
    issue: str | None = Field(default=None, min_length=1, max_length=5000)
    status: RepairStatus | None = None
    cost: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=10)
    vendor: str | None = Field(default=None, max_length=200)
    warranty: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=5000)


class RepairResponse(RepairCreate):
    id: int
    asset_id: int
    created_at: datetime
    asset_name: str | None = None
    model_config = {"from_attributes": True}


class RepairImportItem(RepairCreate):
    asset_id: int


# ---- maintenance ---------------------------------------------------------
class ComponentStatus(BaseModel):
    component: str = Field(min_length=1, max_length=100)
    status: str = Field(min_length=1, max_length=30)
    notes: str | None = Field(default=None, max_length=500)


class MaintenanceCreate(BaseModel):
    maintenance_date: date
    asset_status: str | None = Field(default=None, max_length=50)
    operating_system: str | None = Field(default=None, max_length=100)
    body_condition: BodyCondition = "Good"
    components: list[ComponentStatus] = Field(default_factory=list, max_length=100)
    notes: str | None = Field(default=None, max_length=5000)


class MaintenanceUpdate(BaseModel):
    maintenance_date: date | None = None
    asset_status: str | None = Field(default=None, max_length=50)
    operating_system: str | None = Field(default=None, max_length=100)
    body_condition: BodyCondition | None = None
    components: list[ComponentStatus] | None = None
    notes: str | None = Field(default=None, max_length=5000)


class MaintenanceResponse(MaintenanceCreate):
    id: int
    asset_id: int
    created_at: datetime
    asset_name: str | None = None
    model_config = {"from_attributes": True}


# ---- borrows -------------------------------------------------------------
class BorrowCreate(BaseModel):
    asset_id: int | None = None
    item_name: str | None = Field(default=None, max_length=300)
    employee_id: int | None = None
    borrower_name: str | None = Field(default=None, max_length=200)
    borrower_email: str | None = Field(default=None, max_length=255)
    borrowed_date: date
    expected_return_date: date | None = None
    notes: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def check(self):
        if not self.asset_id and not (self.item_name or "").strip():
            raise ValueError("Pick an asset or enter an item name")
        if not self.employee_id and not (self.borrower_name or "").strip():
            raise ValueError("Pick an employee or enter a borrower name")
        if self.expected_return_date and self.expected_return_date < self.borrowed_date:
            raise ValueError("Expected return date cannot be before the borrow date")
        return self


class BorrowUpdate(BaseModel):
    item_name: str | None = Field(default=None, max_length=300)
    employee_id: int | None = None
    borrower_name: str | None = Field(default=None, max_length=200)
    borrower_email: str | None = Field(default=None, max_length=255)
    borrowed_date: date | None = None
    expected_return_date: date | None = None
    returned_date: date | None = None
    notes: str | None = Field(default=None, max_length=5000)


class ReturnRequest(BaseModel):
    returned_date: date | None = None


class BorrowResponse(BaseModel):
    id: int
    asset_id: int | None
    item_name: str
    employee_id: int | None
    borrower_name: str
    borrower_email: str | None
    borrowed_date: date
    expected_return_date: date | None
    returned_date: date | None
    notes: str | None
    overdue: bool = False
    serial_number: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class AssetDetailResponse(AssetResponse):
    assignments: list[AssetAssignmentResponse]
    repairs: list[RepairResponse]
    maintenance: list[MaintenanceResponse]
    borrows: list[BorrowResponse]


# ---- settings ------------------------------------------------------------
class TemplateUpsert(BaseModel):
    attributes: list[str] = Field(default_factory=list, max_length=30)


class SerialSettingUpsert(BaseModel):
    enabled: bool
    format: str = Field(default="", max_length=40)
    next_number: int | None = Field(default=None, ge=1)


class SerialSettingResponse(BaseModel):
    asset_type: str
    enabled: bool
    format: str
    next_number: int
    reserved_number: int | None
    preview: str | None = None
    model_config = {"from_attributes": True}


# ---- offboarding ---------------------------------------------------------
class OffboardRequest(BaseModel):
    effective_date: date
    reason: str = Field(default="Resignation", max_length=100)
    return_assets: bool = True
    close_borrows: bool = True
    release_seats: bool = True
    deactivate: bool = True


class AssetFilters(BaseModel):
    """Asset filters as query parameters. Multi-value filters take comma-separated lists."""
    q: str | None = Field(default=None, max_length=200)
    asset_type: str | None = Field(default=None, max_length=1000)
    assignment_status: str | None = Field(default=None, max_length=200)
    condition_status: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=1000)
    brand: str | None = Field(default=None, max_length=1000)
    supplier: str | None = Field(default=None, max_length=1000)
    model: str | None = Field(default=None, max_length=200)
    business_unit: str | None = Field(default=None, max_length=1000)
    employee_id: int | None = None
    purchase_from: date | None = None
    purchase_to: date | None = None
    warranty_from: date | None = None
    warranty_to: date | None = None
    warranty_before: date | None = None
    warranty: Literal["active", "expiring", "expired", "none"] | None = None
    cost_min: Decimal | None = Field(default=None, ge=0)
    cost_max: Decimal | None = Field(default=None, ge=0)
    open_repair: bool | None = None
    deleted: bool = False
