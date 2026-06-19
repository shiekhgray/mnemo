from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user
from app.database import get_db
from app.positions import slot_label

router = APIRouter(tags=["layout"], dependencies=[Depends(get_current_user)])


def _slot_dict(slot: models.Slot) -> dict:
    occupant = slot.container
    return {
        "id": slot.id,
        "kind": slot.kind,
        "label": slot_label(slot),
        "address": slot.address,
        "drawer_number": slot.drawer_number,
        "box_position": slot.box_position,
        "occupant_id": occupant.id if occupant else None,
        "occupant_label": occupant.label if occupant else None,
    }


@router.get("/bins")
def list_bins(db: Session = Depends(get_db)):
    bins = db.query(models.Bin).order_by(models.Bin.code).all()
    return [
        {
            "id": b.id,
            "code": b.code,
            "label": b.label,
            "type": b.type,
            "wall_row": b.wall_row,
            "wall_col": b.wall_col,
            "slots": [_slot_dict(s) for s in sorted(b.slots, key=lambda s: s.address or "")],
        }
        for b in bins
    ]


@router.get("/chests")
def list_chests(db: Session = Depends(get_db)):
    chests = db.query(models.Chest).order_by(models.Chest.label).all()
    return [
        {
            "id": ch.id,
            "label": ch.label,
            "num_drawers": ch.num_drawers,
            "slots": [
                _slot_dict(s)
                for s in sorted(
                    ch.slots, key=lambda s: (s.drawer_number or 0, s.box_position or "")
                )
            ],
        }
        for ch in chests
    ]


@router.get("/slots")
def list_slots(
    available_only: bool = Query(False),
    db: Session = Depends(get_db),
):
    """All slots, optionally only those with no current occupant. Used by the
    'assign container to slot' picker."""
    slots = db.query(models.Slot).all()
    out = [_slot_dict(s) for s in slots]
    if available_only:
        out = [s for s in out if s["occupant_id"] is None]
    # Wall slots first (they're the common case), then chest slots; each by label.
    out.sort(key=lambda s: (0 if s["kind"] == "wall" else 1, s["label"]))
    return out
