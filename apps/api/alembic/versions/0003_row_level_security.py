"""Row-level security on renewal records + least-privileged app role.

Revision ID: 0003
Revises: 0002
"""
from alembic import op

from app.core.config import get_settings
from app.db.rls import disable_statements, enable_statements, grant_statements, role_statements

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    password = get_settings().APP_DB_PASSWORD
    if password:
        for sql in role_statements(password):
            op.execute(sql)
    for sql in enable_statements() + grant_statements():
        op.execute(sql)


def downgrade() -> None:
    for sql in disable_statements():
        op.execute(sql)
