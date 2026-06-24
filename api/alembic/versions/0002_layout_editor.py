"""storage layout editor: bins.grid_spec, unique wall cell, slot FK on-delete

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-24

Supports GUI-managed storage (prd/layout-editor.prd):
  - bins.grid_spec (JSON band list), back-filled from the existing `type` preset.
  - UNIQUE(wall_row, wall_col) so placement can't silently collide.
  - containers.slot_id FK -> ON DELETE SET NULL so removing a slot benches its
    occupant instead of erroring.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Preset -> band list. Kept in sync with app.positions.PRESETS; duplicated here so
# the migration is self-contained and stable even if the app code later changes.
PRESETS = {
    "all-narrow": [{"cols": 8, "rows": 8}],
    "all-wide": [{"cols": 4, "rows": 6}],
    "half-half": [{"cols": 8, "rows": 4}, {"cols": 4, "rows": 3}],
}


def upgrade() -> None:
    op.add_column("bins", sa.Column("grid_spec", sa.JSON()))

    # Back-fill grid_spec for existing bins from their preset type.
    bins = sa.table(
        "bins", sa.column("id", sa.Integer), sa.column("type", sa.String),
        sa.column("grid_spec", sa.JSON),
    )
    conn = op.get_bind()
    for btype, spec in PRESETS.items():
        conn.execute(
            bins.update().where(bins.c.type == btype).values(grid_spec=spec)
        )

    op.create_unique_constraint("uq_bin_wall_cell", "bins", ["wall_row", "wall_col"])

    # Re-create the containers.slot_id FK with ON DELETE SET NULL. The 0001 FK was
    # unnamed; Postgres autogenerates "containers_slot_id_fkey".
    op.drop_constraint("containers_slot_id_fkey", "containers", type_="foreignkey")
    op.create_foreign_key(
        "fk_containers_slot", "containers", "slots",
        ["slot_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_containers_slot", "containers", type_="foreignkey")
    op.create_foreign_key(
        "containers_slot_id_fkey", "containers", "slots", ["slot_id"], ["id"],
    )
    op.drop_constraint("uq_bin_wall_cell", "bins", type_="unique")
    op.drop_column("bins", "grid_spec")
