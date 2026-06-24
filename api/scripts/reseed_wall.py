#!/usr/bin/env python3
"""One-off: replace the wall bins with the real layout in seed_storage.WALL_LAYOUT
(parsed from wall_photos/ -- see docs/WALL.md).

seed_storage.py only *adds* bins (it skips ones that already exist), so it can't
swap the old placeholder wall for the real one. This script does the swap safely
against the live DB:

  1. Detach every container currently sitting on a wall slot, remembering its
     (bin label, address).
  2. Delete all wall Bins (their slots cascade away). Chests are left alone.
  3. Seed the real WALL_LAYOUT fresh.
  4. Re-home each detached container onto the new bin that has the same label and
     the same drawer address (e.g. the Cabinet 1 pilot, which was on placeholder
     bin "Cabinet 1"/W-A3, lands back in the new "Cabinet 1"/C1 at the same cell).
     Anything without a matching new slot falls back to a freeform location named
     after its old bin, so no container is ever orphaned.

Run inside the api container:

    python scripts/reseed_wall.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app import models
from seed_storage import WALL_LAYOUT, addresses_for


def main(db) -> None:
    wall_slot_ids = {s.id for s in db.query(models.Slot).filter_by(kind="wall")}

    # 1. Detach containers from wall slots, remembering where they were.
    detached = []  # (bin_label_or_code, address, container)
    for c in db.query(models.Container).filter(models.Container.slot_id.in_(wall_slot_ids)).all():
        key = (c.slot.bin.label or c.slot.bin.code, c.slot.address)
        c.slot_id = None
        detached.append((key[0], key[1], c))
    db.flush()
    print(f"detached {len(detached)} container(s) from wall slots")

    # 2. Drop the old wall bins (slots cascade).
    old_bins = db.query(models.Bin).all()
    for b in old_bins:
        db.delete(b)
    db.flush()
    print(f"deleted {len(old_bins)} old wall bin(s) and their slots")

    # 3. Seed the real layout.
    for code, btype, row, col, label in WALL_LAYOUT:
        b = models.Bin(code=code, type=btype, wall_row=row, wall_col=col, label=label or None)
        db.add(b)
        db.flush()
        addrs = addresses_for(btype)
        for addr in addrs:
            db.add(models.Slot(kind="wall", bin_id=b.id, address=addr))
        print(f"created {code} ({label}) {btype} -- {len(addrs)} slots")
    db.flush()

    # 4. Re-home detached containers by (label, address); freeform fallback.
    new_slots = {
        (s.bin.label or s.bin.code, s.address): s
        for s in db.query(models.Slot).filter_by(kind="wall")
    }
    rehomed = freeformed = 0
    for label, address, c in detached:
        slot = new_slots.get((label, address))
        if slot is not None:
            c.slot_id = slot.id
            rehomed += 1
        else:
            c.freeform_location = label
            freeformed += 1
    print(f"re-homed {rehomed} container(s) to matching new slots; "
          f"{freeformed} fell back to freeform")


if __name__ == "__main__":
    db = SessionLocal()
    try:
        main(db)
        db.commit()
        print("done")
    finally:
        db.close()
