"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-06-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(64), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(128), nullable=False),
    )

    op.create_table(
        "bins",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(16), nullable=False, unique=True),
        sa.Column("label", sa.String(255)),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("wall_row", sa.Integer()),
        sa.Column("wall_col", sa.Integer()),
    )

    op.create_table(
        "chests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("num_drawers", sa.Integer(), nullable=False),
    )

    op.create_table(
        "slots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("bin_id", sa.Integer(), sa.ForeignKey("bins.id", ondelete="CASCADE")),
        sa.Column("address", sa.String(8)),
        sa.Column("chest_id", sa.Integer(), sa.ForeignKey("chests.id", ondelete="CASCADE")),
        sa.Column("drawer_number", sa.Integer()),
        sa.Column("box_position", sa.String(8)),
        sa.UniqueConstraint("bin_id", "address", name="uq_wall_slot"),
        sa.UniqueConstraint("chest_id", "drawer_number", "box_position", name="uq_chest_slot"),
    )

    op.create_table(
        "containers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("type", sa.String(16), nullable=False, server_default="other"),
        sa.Column("slot_id", sa.Integer(), sa.ForeignKey("slots.id"), unique=True),
        sa.Column("freeform_location", sa.Text()),
        sa.Column("parent_container_id", sa.Integer(), sa.ForeignKey("containers.id")),
        sa.CheckConstraint(
            "(CASE WHEN slot_id IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN freeform_location IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN parent_container_id IS NOT NULL THEN 1 ELSE 0 END) <= 1",
            name="ck_container_single_position",
        ),
    )

    op.create_table(
        "parts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(64)),
        sa.Column(
            "container_id",
            sa.Integer(),
            sa.ForeignKey("containers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=False, server_default="{}"),
        sa.Column("notes", sa.Text()),
    )
    op.create_index("ix_parts_container_id", "parts", ["container_id"])
    op.create_index("ix_parts_name", "parts", ["name"])


def downgrade() -> None:
    op.drop_table("parts")
    op.drop_table("containers")
    op.drop_table("slots")
    op.drop_table("chests")
    op.drop_table("bins")
    op.drop_table("users")
