from datetime import datetime
from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None
    user_name: str | None
    action: str
    entity_type: str
    entity_id: int | None
    entity_name: str | None
    old_values: dict | None
    new_values: dict | None
    details: str | None
    ip_address: str | None
    timestamp: datetime

    model_config = {"from_attributes": True}
