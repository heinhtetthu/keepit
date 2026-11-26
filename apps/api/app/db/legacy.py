"""Columns that let a future ETL import (from the old Renewly and AssetWise
databases) be re-run safely and keep old ids traceable. Unused at runtime."""
from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column


class LegacyMixin:
    legacy_source: Mapped[str | None] = mapped_column(String(20))
    legacy_id: Mapped[str | None] = mapped_column(String(255))


def legacy_unique(table: str) -> UniqueConstraint:
    return UniqueConstraint("legacy_source", "legacy_id", name=f"uq_{table}_legacy")
