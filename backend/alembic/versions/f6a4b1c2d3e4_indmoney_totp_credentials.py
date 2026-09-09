"""INDmoney TOTP credentials

Revision ID: f6a4b1c2d3e4
Revises: f8c1d2e3a4b5
Create Date: 2026-08-31 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a4b1c2d3e4"
down_revision: Union[str, None] = "f8c1d2e3a4b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("broker_indmoney_credentials", sa.Column("client_id_cipher", sa.Text(), nullable=True))
    op.add_column("broker_indmoney_credentials", sa.Column("mpin_cipher", sa.Text(), nullable=True))
    op.add_column("broker_indmoney_credentials", sa.Column("totp_secret_cipher", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("broker_indmoney_credentials", "totp_secret_cipher")
    op.drop_column("broker_indmoney_credentials", "mpin_cipher")
    op.drop_column("broker_indmoney_credentials", "client_id_cipher")
