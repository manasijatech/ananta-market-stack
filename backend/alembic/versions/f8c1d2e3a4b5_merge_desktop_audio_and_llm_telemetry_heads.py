"""merge desktop audio and llm telemetry heads

Revision ID: f8c1d2e3a4b5
Revises: b8d3c2a1f901, e2b8f4c9a1d3
Create Date: 2026-07-03 15:05:00.000000

"""

from typing import Sequence, Union


revision: str = "f8c1d2e3a4b5"
down_revision: Union[str, tuple[str, str], None] = ("b8d3c2a1f901", "e2b8f4c9a1d3")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
