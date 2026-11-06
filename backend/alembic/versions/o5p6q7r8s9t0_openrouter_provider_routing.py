"""OpenRouter provider routing per saved model.

Revision ID: o5p6q7r8s9t0
Revises: h8i9j0k1l2m3
Create Date: 2026-09-14 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "o5p6q7r8s9t0"
down_revision: Union[str, None] = "h8i9j0k1l2m3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    cols = _column_names("user_llm_models")
    if "openrouter_providers_json" not in cols:
        op.add_column(
            "user_llm_models",
            sa.Column("openrouter_providers_json", sa.Text(), nullable=False, server_default="[]"),
        )
    if "openrouter_allow_fallbacks" not in cols:
        op.add_column(
            "user_llm_models",
            sa.Column("openrouter_allow_fallbacks", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        )


def downgrade() -> None:
    cols = _column_names("user_llm_models")
    if "openrouter_allow_fallbacks" in cols:
        op.drop_column("user_llm_models", "openrouter_allow_fallbacks")
    if "openrouter_providers_json" in cols:
        op.drop_column("user_llm_models", "openrouter_providers_json")
