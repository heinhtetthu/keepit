"""saved view scope (records or assets)

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-26 23:10:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('saved_views', sa.Column('scope', sa.String(length=20), server_default='records', nullable=False))
    op.create_index(op.f('ix_saved_views_scope'), 'saved_views', ['scope'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_saved_views_scope'), table_name='saved_views')
    op.drop_column('saved_views', 'scope')
