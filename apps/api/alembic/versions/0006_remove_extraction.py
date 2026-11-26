"""remove AI document extraction

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-26 23:40:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0006'
down_revision: Union[str, None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f('ix_extraction_runs_status'), table_name='extraction_runs')
    op.drop_index(op.f('ix_extraction_runs_document_id'), table_name='extraction_runs')
    op.drop_table('extraction_runs')
    op.execute("DELETE FROM permissions WHERE name = 'extraction.run'")


def downgrade() -> None:
    op.create_table('extraction_runs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('document_id', sa.Integer(), nullable=False),
    sa.Column('doc_type', sa.String(length=50), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('model', sa.String(length=255), nullable=True),
    sa.Column('requested_by', sa.Integer(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('confirmed_values', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('confirmed_by', sa.Integer(), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('target', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('extracted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['confirmed_by'], ['users.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['requested_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_extraction_runs_document_id'), 'extraction_runs', ['document_id'], unique=False)
    op.create_index(op.f('ix_extraction_runs_status'), 'extraction_runs', ['status'], unique=False)
