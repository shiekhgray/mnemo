#!/usr/bin/env python3
"""Seed the physical storage layout: the 12 wall bins (and their drawer-slots)
plus any drawer chests.

The wall layout below is the real one, parsed from wall_photos/ (see docs/WALL.md):
one wall, 3 columns x 4 rows of units. Edit WALL_LAYOUT and CHESTS to match reality,
then run (from inside the api container):

    python scripts/seed_storage.py

Re-running is safe: existing bins/chests (matched by code/label) are skipped. To
REPLACE the existing wall (e.g. swapping the old placeholder for this one) without
double-creating, use scripts/reseed_wall.py instead.

Bin types and their drawer grids (addressed spreadsheet-style, col letter + row):
    all-narrow : cols A-H x rows 1-8  = 64 drawers
    all-wide   : cols A-D x rows 1-6  = 24 drawers
    half-half  : narrow cols A-H rows 1-4 (top) + wide cols A-D rows 5-7 (bottom) = 44
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app import models

LETTERS = "ABCDEFGHIJKLMNOP"


def addresses_for(bin_type: str) -> list[str]:
    """Generate every drawer address for a bin of the given type."""
    if bin_type == "all-narrow":
        return [f"{LETTERS[c]}{r}" for r in range(1, 9) for c in range(8)]
    if bin_type == "all-wide":
        return [f"{LETTERS[c]}{r}" for r in range(1, 7) for c in range(4)]
    if bin_type == "half-half":
        top = [f"{LETTERS[c]}{r}" for r in range(1, 5) for c in range(8)]    # narrow A1-H4
        bottom = [f"{LETTERS[c]}{r}" for r in range(5, 8) for c in range(4)]  # wide A5-D7
        return top + bottom
    raise ValueError(f"unknown bin type: {bin_type}")


# Real wall, parsed from wall_photos/ and confirmed by Graham (2026-06-24); recorded in
# docs/WALL.md. ONE wall of 12 Akro-Mils units in a 3-col x 4-row grid (wall_row 1..4
# top->bottom, wall_col 1..3 left->right). Units are numbered 1..12 in reading order
# (left->right, top->bottom) regardless of how full they are — the formerly-"Blue Unit"
# and "Empty" cells are just numbered cabinets now (Cabinet 6 has 2 filled drawers whose
# contents aren't logged yet).
#
# (code, type, wall_row, wall_col, label)
WALL_LAYOUT = [
    ("C1",  "all-wide",   1, 1, "Cabinet 1"),
    ("C2",  "all-wide",   1, 2, "Cabinet 2"),
    ("C3",  "half-half",  1, 3, "Cabinet 3"),
    ("C4",  "half-half",  2, 1, "Cabinet 4"),
    ("C5",  "all-wide",   2, 2, "Cabinet 5"),
    ("C6",  "half-half",  2, 3, "Cabinet 6"),    # has 2 filled drawers (contents TBD)
    ("C7",  "all-narrow", 3, 1, "Cabinet 7"),
    ("C8",  "all-narrow", 3, 2, "Cabinet 8"),
    ("C9",  "all-narrow", 3, 3, "Cabinet 9"),
    ("C10", "all-wide",   4, 1, "Cabinet 10"),
    ("C11", "all-wide",   4, 2, "Cabinet 11"),
    ("C12", "all-narrow", 4, 3, "Cabinet 12"),
]

# (label, num_drawers) — each drawer gets a 'front' and 'back' tackle-box slot.
CHESTS = [
    ("Tackle chest", 5),
]


def seed_bins(db) -> None:
    for code, btype, row, col, label in WALL_LAYOUT:
        if db.query(models.Bin).filter_by(code=code).first():
            print(f"bin {code} exists, skipping")
            continue
        b = models.Bin(code=code, type=btype, wall_row=row, wall_col=col, label=label or None)
        db.add(b)
        db.flush()
        for addr in addresses_for(btype):
            db.add(models.Slot(kind="wall", bin_id=b.id, address=addr))
        print(f"created bin {code} ({btype}) with {len(addresses_for(btype))} slots")


def seed_chests(db) -> None:
    for label, num_drawers in CHESTS:
        if db.query(models.Chest).filter_by(label=label).first():
            print(f"chest '{label}' exists, skipping")
            continue
        ch = models.Chest(label=label, num_drawers=num_drawers)
        db.add(ch)
        db.flush()
        for n in range(1, num_drawers + 1):
            for pos in ("front", "back"):
                db.add(models.Slot(kind="chest", chest_id=ch.id, drawer_number=n, box_position=pos))
        print(f"created chest '{label}' with {num_drawers * 2} slots")


if __name__ == "__main__":
    db = SessionLocal()
    try:
        seed_bins(db)
        seed_chests(db)
        db.commit()
        print("done")
    finally:
        db.close()
