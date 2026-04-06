"""baseline

Revision ID: f5ed572aacd8
Revises: 
Create Date: 2026-04-06 12:02:35.156517

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f5ed572aacd8'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Baseline revision for existing deployments. Stamp current databases to this
    # revision, then generate incremental revisions for subsequent schema changes.
    pass


def downgrade() -> None:
    pass
