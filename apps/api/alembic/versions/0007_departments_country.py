"""departments master list, employee department and country

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-27 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.db.rls import grant_statements


revision: str = '0007'
down_revision: Union[str, None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('departments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name', name='uq_department_name')
    )
    op.add_column('employees', sa.Column('department', sa.String(length=100), nullable=True))
    op.add_column('employees', sa.Column('country', sa.String(length=100), nullable=True))
    # The app role reads and writes the new table (idempotent; skipped when the role is absent).
    for sql in grant_statements():
        op.execute(sql)


def downgrade() -> None:
    op.drop_column('employees', 'country')
    op.drop_column('employees', 'department')
    op.drop_table('departments')
