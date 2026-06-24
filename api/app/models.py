from sqlalchemy import (
    ARRAY, CheckConstraint, Column, ForeignKey, Integer, JSON, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, nullable=False)
    password_hash = Column(String(128), nullable=False)


class Bin(Base):
    """A wall-mounted Acro Mills bin: a grid of drawer-slots at one wall position.

    A bin only defines *available slots* — the drawers (containers) themselves
    track which slot they currently occupy.
    """
    __tablename__ = "bins"

    id = Column(Integer, primary_key=True)
    code = Column(String(16), unique=True, nullable=False)  # e.g. "W-B2"
    label = Column(String(255))
    type = Column(String(16), nullable=False)  # all-narrow | all-wide | half-half | custom
    # The grid as an ordered list of bands, each a rectangle of equal cells:
    # [{"cols": N, "rows": M}, ...]. The slot addresses are an emergent property of
    # this (see positions.addresses_for_grid); persisted because reconstructing bands
    # from addresses alone is lossy. `type` is now only a preset hint / label.
    grid_spec = Column(JSON)
    wall_row = Column(Integer)  # row in the wall grid (1-based, top->bottom)
    wall_col = Column(Integer)  # col in the wall grid (1-based, left->right)

    slots = relationship("Slot", back_populates="bin", cascade="all, delete-orphan")

    __table_args__ = (
        # One cabinet per wall cell. Postgres allows multiple NULLs, so unplaced
        # bins are unaffected; placement edits can't silently collide.
        UniqueConstraint("wall_row", "wall_col", name="uq_bin_wall_cell"),
    )


class Chest(Base):
    """A drawer chest. Each numbered drawer fits two tackle boxes end-to-end
    (a 'front' and a 'back' slot)."""
    __tablename__ = "chests"

    id = Column(Integer, primary_key=True)
    label = Column(String(255), nullable=False)
    num_drawers = Column(Integer, nullable=False)

    slots = relationship("Slot", back_populates="chest", cascade="all, delete-orphan")


class Slot(Base):
    """A unique physical position that exactly one container may occupy.

    Either a wall-bin drawer-slot (bin_id + address like "C3") or a chest slot
    (chest_id + drawer_number + box_position front/back).
    """
    __tablename__ = "slots"

    id = Column(Integer, primary_key=True)
    kind = Column(String(8), nullable=False)  # wall | chest

    # wall slots
    bin_id = Column(Integer, ForeignKey("bins.id", ondelete="CASCADE"))
    address = Column(String(8))  # column letter + row number, e.g. "C3"

    # chest slots
    chest_id = Column(Integer, ForeignKey("chests.id", ondelete="CASCADE"))
    drawer_number = Column(Integer)
    box_position = Column(String(8))  # front | back

    bin = relationship("Bin", back_populates="slots")
    chest = relationship("Chest", back_populates="slots")
    container = relationship("Container", back_populates="slot", uselist=False)

    __table_args__ = (
        UniqueConstraint("bin_id", "address", name="uq_wall_slot"),
        UniqueConstraint("chest_id", "drawer_number", "box_position", name="uq_chest_slot"),
    )


class Container(Base):
    """The central abstraction: anything that physically holds parts. The stable
    unit of tracking — when it moves, you update one record and its contents follow.

    Position is *at most one of* slot_id / parent_container_id / freeform_location.
    None of them set = "benched" (no known position).
    """
    __tablename__ = "containers"

    id = Column(Integer, primary_key=True)
    label = Column(String(255), nullable=False)
    type = Column(String(16), nullable=False, default="other")
    # wall_drawer | tackle_box | printed_box | freeform | other

    # unique: one container per slot. ON DELETE SET NULL so removing a slot (e.g.
    # shrinking/deleting a unit) benches the occupant rather than erroring — the
    # helpers in positions.py also bench explicitly, this is defence in depth.
    slot_id = Column(
        Integer,
        ForeignKey("slots.id", ondelete="SET NULL", name="fk_containers_slot"),
        unique=True,
    )
    freeform_location = Column(Text)
    parent_container_id = Column(Integer, ForeignKey("containers.id"))

    slot = relationship("Slot", back_populates="container")
    parent = relationship("Container", remote_side=[id], back_populates="children")
    children = relationship("Container", back_populates="parent")
    parts = relationship("Part", back_populates="container", cascade="all, delete-orphan")

    __table_args__ = (
        # Defence in depth — the API also enforces this. At most one position set.
        CheckConstraint(
            "(CASE WHEN slot_id IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN freeform_location IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN parent_container_id IS NOT NULL THEN 1 ELSE 0 END) <= 1",
            name="ck_container_single_position",
        ),
    )


class Part(Base):
    """An individual catalogued item. Always lives in exactly one container."""
    __tablename__ = "parts"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    category = Column(String(64))  # freeform; see suggested list in the web UI
    container_id = Column(Integer, ForeignKey("containers.id", ondelete="CASCADE"), nullable=False)
    tags = Column(ARRAY(String), nullable=False, default=list)
    notes = Column(Text)

    container = relationship("Container", back_populates="parts")
