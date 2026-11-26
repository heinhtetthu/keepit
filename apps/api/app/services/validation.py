"""Shared field validation for API writes and spreadsheet imports."""
from datetime import datetime
from decimal import Decimal, InvalidOperation
from math import isfinite

from pydantic import TypeAdapter, EmailStr

from app.core.exceptions import ValidationException


def validate_value(field, value):
    if value is None or value == "" or value == []:
        if field.required:
            raise ValidationException(f"{field.name} is required")
        return None
    kind = field.field_type
    try:
        if kind in ("integer", "decimal", "currency", "percentage"):
            if isinstance(value, bool):
                raise ValueError()
            number = Decimal(str(value).replace(",", ""))
            if not number.is_finite() or (kind == "integer" and number != number.to_integral_value()):
                raise ValueError()
            result = int(number) if kind == "integer" else float(number)
            if kind != "integer" and not isfinite(result):
                raise ValueError()
            return result
        if kind == "boolean":
            if isinstance(value, bool):
                return value
            if str(value).lower() in ("true", "yes", "1", "y"):
                return True
            if str(value).lower() in ("false", "no", "0", "n"):
                return False
            raise ValueError()
        if kind in ("date", "datetime"):
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return parsed.date().isoformat() if kind == "date" else parsed.isoformat()
        if kind == "multi_select":
            values = value if isinstance(value, list) else str(value).split(";")
            values = [str(v).strip() for v in values]
            if any(v not in {o.value for o in field.options} for v in values):
                raise ValueError()
            return values
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            raise ValueError()
        result = str(value).strip()
        if len(result) > 10000 or (field.required and not result):
            raise ValueError()
        if kind == "select" and result not in {o.value for o in field.options}:
            raise ValueError()
        if kind == "email":
            result = str(TypeAdapter(EmailStr).validate_python(result))
        if kind == "url" and not result.lower().startswith(("https://", "http://")):
            raise ValueError()
        return result
    except (ValueError, TypeError, InvalidOperation, OverflowError):
        raise ValidationException(f"Invalid {kind} value for {field.name}")


def validate_values(record_type, values, existing=None):
    fields = {f.id: f for f in record_type.fields if f.active}
    seen = set()
    merged = dict(existing or {})
    for item in values:
        if item.field_id not in fields or item.field_id in seen:
            raise ValidationException("Field must be active, belong to this record type, and appear only once")
        seen.add(item.field_id)
        item.value = validate_value(fields[item.field_id], item.value)
        merged[item.field_id] = item.value
    for field in fields.values():
        if field.required and merged.get(field.id) in (None, "", []):
            raise ValidationException(f"{field.name} is required")
