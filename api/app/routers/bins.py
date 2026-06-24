from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user
from app.database import get_db
from app.positions import (
    PRESETS,
    delete_bin,
    delete_chest,
    move_bin,
    next_bin_code,
    normalize_grid_spec,
    reconcile_bin_slots,
    reconcile_chest_slots,
    slot_label,
)

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


def _bin_dict(b: models.Bin) -> dict:
    return {
        "id": b.id,
        "code": b.code,
        "label": b.label,
        "type": b.type,
        "grid_spec": b.grid_spec,
        "wall_row": b.wall_row,
        "wall_col": b.wall_col,
        "slots": [_slot_dict(s) for s in sorted(b.slots, key=lambda s: s.address or "")],
    }


def _chest_dict(ch: models.Chest) -> dict:
    return {
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


# --- reads ------------------------------------------------------------------


@router.get("/bins")
def list_bins(db: Session = Depends(get_db)):
    bins = db.query(models.Bin).order_by(models.Bin.code).all()
    return [_bin_dict(b) for b in bins]


@router.get("/chests")
def list_chests(db: Session = Depends(get_db)):
    chests = db.query(models.Chest).order_by(models.Chest.label).all()
    return [_chest_dict(ch) for ch in chests]


@router.get("/presets")
def list_presets():
    """The named grid presets the layout editor's quick-pick offers. The band list
    is the same shape the create/update endpoints accept as `grid_spec`."""
    return [{"name": name, "grid_spec": spec} for name, spec in PRESETS.items()]


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


# --- cabinet (Bin) CRUD -----------------------------------------------------


def _wall_cell(body: dict) -> tuple:
    """Pull (wall_row, wall_col) from a body, requiring both-or-neither."""
    row = body.get("wall_row")
    col = body.get("wall_col")
    if (row is None) != (col is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "wall_row and wall_col must be set together"
        )
    return row, col


@router.post("/bins", status_code=201)
def create_bin(body: dict, db: Session = Depends(get_db)):
    """Create a cabinet from a preset name or an explicit band `grid_spec`, generate
    its slots, and optionally place it on the wall. Code auto-generates ('C{n}') but
    an explicit `code` can override it."""
    grid_spec = normalize_grid_spec(body)
    btype = body.get("preset") or "custom"
    label = (body.get("label") or "").strip() or None
    row, col = _wall_cell(body)

    if row is not None:
        clash = db.query(models.Bin).filter_by(wall_row=row, wall_col=col).first()
        if clash is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"wall cell ({row}, {col}) is already occupied by {clash.code}",
            )

    code = (body.get("code") or "").strip() or next_bin_code(db)
    if db.query(models.Bin).filter_by(code=code).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"bin code '{code}' already exists")

    b = models.Bin(
        code=code, label=label, type=btype, grid_spec=grid_spec,
        wall_row=row, wall_col=col,
    )
    db.add(b)
    db.flush()  # need an id before generating slots
    reconcile_bin_slots(db, b, grid_spec)
    db.commit()
    db.refresh(b)
    return _bin_dict(b)


@router.put("/bins/{bin_id}")
def update_bin(bin_id: int, body: dict, db: Session = Depends(get_db)):
    """Edit a cabinet's label and/or grid. Re-shaping reconciles slots in place:
    surviving addresses keep their occupant, removed ones bump it to benched. The
    {added, removed, bumped} counts come back under `reconcile` for the UI's
    blast-radius confirm."""
    b = db.get(models.Bin, bin_id)
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cabinet not found")

    if "label" in body:
        b.label = (body["label"] or "").strip() or None

    reconcile = None
    if "preset" in body or "grid_spec" in body:
        grid_spec = normalize_grid_spec(body)
        b.grid_spec = grid_spec
        b.type = body.get("preset") or "custom"
        reconcile = reconcile_bin_slots(db, b, grid_spec)

    db.commit()
    db.refresh(b)
    out = _bin_dict(b)
    if reconcile is not None:
        out["reconcile"] = reconcile
    return out


@router.post("/bins/{bin_id}/move")
def move_bin_endpoint(bin_id: int, body: dict, db: Session = Depends(get_db)):
    """Place a cabinet at wall cell (wall_row, wall_col). If another cabinet is
    already there, the two swap cells. Pass nulls to unplace it."""
    b = db.get(models.Bin, bin_id)
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cabinet not found")
    row, col = _wall_cell(body)
    move_bin(db, b, row, col)
    db.commit()
    db.refresh(b)
    return _bin_dict(b)


@router.delete("/bins/{bin_id}")
def delete_bin_endpoint(bin_id: int, db: Session = Depends(get_db)):
    """Delete a cabinet, benching any drawers in its slots first (never deleting a
    container). Returns how many were bumped."""
    b = db.get(models.Bin, bin_id)
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cabinet not found")
    bumped = delete_bin(db, b)
    db.commit()
    return {"deleted": bin_id, "bumped": bumped}


# --- chest CRUD -------------------------------------------------------------


def _require_drawer_count(body: dict) -> int:
    raw = body.get("num_drawers")
    if raw is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "num_drawers is required")
    try:
        return int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "num_drawers must be an integer")


@router.post("/chests", status_code=201)
def create_chest(body: dict, db: Session = Depends(get_db)):
    """Create a chest from a label and drawer count; each drawer generates a
    front+back slot."""
    label = (body.get("label") or "").strip()
    if not label:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "label is required")
    num = _require_drawer_count(body)

    ch = models.Chest(label=label, num_drawers=num)
    db.add(ch)
    db.flush()
    reconcile_chest_slots(db, ch, num)  # validates num >= 1
    db.commit()
    db.refresh(ch)
    return _chest_dict(ch)


@router.put("/chests/{chest_id}")
def update_chest(chest_id: int, body: dict, db: Session = Depends(get_db)):
    """Edit a chest's label and/or drawer count. Reducing the count bumps the
    occupants of removed drawers to benched (reported under `reconcile`)."""
    ch = db.get(models.Chest, chest_id)
    if ch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chest not found")

    if "label" in body:
        label = (body["label"] or "").strip()
        if not label:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "label cannot be empty")
        ch.label = label

    reconcile = None
    if "num_drawers" in body:
        num = _require_drawer_count(body)
        ch.num_drawers = num
        reconcile = reconcile_chest_slots(db, ch, num)

    db.commit()
    db.refresh(ch)
    out = _chest_dict(ch)
    if reconcile is not None:
        out["reconcile"] = reconcile
    return out


@router.delete("/chests/{chest_id}")
def delete_chest_endpoint(chest_id: int, db: Session = Depends(get_db)):
    """Delete a chest, benching any boxes in its slots first. Returns how many were
    bumped."""
    ch = db.get(models.Chest, chest_id)
    if ch is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chest not found")
    bumped = delete_chest(db, ch)
    db.commit()
    return {"deleted": chest_id, "bumped": bumped}
