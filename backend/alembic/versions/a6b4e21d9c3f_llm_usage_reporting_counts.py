"""llm usage reporting counts

Revision ID: a6b4e21d9c3f
Revises: 9a7c5e2d1f84
Create Date: 2026-05-25 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a6b4e21d9c3f"
down_revision: Union[str, None] = "9a7c5e2d1f84"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "llm_usage_daily_snapshots",
        sa.Column("cached_tokens_reported_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "llm_usage_daily_snapshots",
        sa.Column("reasoning_tokens_reported_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("llm_usage_daily_snapshots", "reasoning_tokens_reported_count")
    op.drop_column("llm_usage_daily_snapshots", "cached_tokens_reported_count")
