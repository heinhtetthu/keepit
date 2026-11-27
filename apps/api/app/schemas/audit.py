from datetime import datetime
from typing import Any

from pydantic import BaseModel


class AuditChange(BaseModel):
    field: str
    old: Any = None
    new: Any = None


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None
    user_name: str | None
    action: str
    action_label: str
    category: str
    summary: str
    entity_type: str
    entity_label: str
    entity_id: int | None
    entity_name: str | None
    old_values: dict | None
    new_values: dict | None
    changes: list[AuditChange] = []
    details: str | None
    ip_address: str | None
    timestamp: datetime

    model_config = {"from_attributes": True}


class AuditOption(BaseModel):
    value: str
    label: str
    category: str | None = None


class AuditFilterOptions(BaseModel):
    actions: list[AuditOption]
    entity_types: list[AuditOption]
    users: list[AuditOption]
    categories: list[AuditOption]
