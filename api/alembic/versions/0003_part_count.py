"""parts.count + parts.count_is_many: optional quantity / "many"

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-24

A lightweight quantity hint on parts. Exact tracking stays out of v1 scope, but a
part can now carry an exact `count`, or `count_is_many` ("I have plenty"), or
neither (unspecified, the default for all existing rows).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("parts", sa.Column("count", sa.Integer(), nullable=True))
    op.add_column(
        "parts",
        sa.Column(
            "count_is_many",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("parts", "count_is_many")
    op.drop_column("parts", "count")
