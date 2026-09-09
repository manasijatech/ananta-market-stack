"""merge broker chat retry and INDmoney TOTP heads

Revision ID: a1b2c3d4e5f6
Revises: d4e8a1c7b902, f6a4b1c2d3e4
Create Date: 2026-08-31 10:40:00.000000
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, tuple[str, str], None] = ("d4e8a1c7b902", "f6a4b1c2d3e4")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
