from sqlalchemy import Date, case, cast, func, select

from app.models.record import RecordValue


def field_date():
    """Safely handle malformed legacy JSON values on PostgreSQL 16+."""
    value = func.left(RecordValue.value["value"].astext, 10)
    return case((func.pg_input_is_valid(value, "date"), cast(value, Date)), else_=None)


def dated_records(field_id, start=None, end=None):
    query = select(RecordValue.record_id).where(RecordValue.field_id == field_id)
    if start is not None:
        query = query.where(field_date() >= start)
    if end is not None:
        query = query.where(field_date() <= end)
    return query
