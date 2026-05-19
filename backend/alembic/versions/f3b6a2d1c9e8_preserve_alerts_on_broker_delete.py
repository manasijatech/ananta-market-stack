"""preserve alerts on broker delete

Revision ID: f3b6a2d1c9e8
Revises: f2a8c91d4e70
Create Date: 2026-05-19 13:05:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "f3b6a2d1c9e8"
down_revision: Union[str, None] = "f2a8c91d4e70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def _replace_account_fk(table_name: str) -> None:
    with op.batch_alter_table(
        table_name,
        recreate="always",
        naming_convention=NAMING_CONVENTION,
    ) as batch_op:
        batch_op.drop_constraint(
            f"fk_{table_name}_account_id_broker_accounts",
            type_="foreignkey",
        )
        batch_op.create_foreign_key(
            f"fk_{table_name}_account_id_broker_accounts",
            "broker_accounts",
            ["account_id"],
            ["id"],
            ondelete="SET NULL",
        )


def upgrade() -> None:
    for table_name in (
        "alert_workflows",
        "live_symbol_subscriptions",
        "user_alert_notifications",
        "broker_notifications",
    ):
        _replace_account_fk(table_name)


def downgrade() -> None:
    # Do not reintroduce destructive account cascades on alert/workflow data.
    pass
