from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Department(Base, TimestampMixin):
    """Master list of departments. Employees store the department name as a
    snapshot (like business units); renaming a department updates them."""
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("name", name="uq_department_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
