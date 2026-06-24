"""Container position logic — the non-obvious rules from the PRD live here.

A container's position is *at most one of* slot / parent / freeform, or none
("benched"). Slots are unique; assigning to an occupied slot atomically bumps
the occupant to benched. Nesting is capped at 2 levels.
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models

# ---------------------------------------------------------------------------
# Grid model: a cabinet's geometry is an ordered list of bands, each a rectangle
# of equal cells. Slot addresses are an emergent property of the band list. See
# prd/layout-editor.prd ("the grid is the slots").
# ---------------------------------------------------------------------------

LETTERS = "ABCDEFGHIJKLMNOP"  # column labels; caps band width at 16

# Named presets reproduce the three Akro-Mils unit types as band lists.
PRESETS = {
    "all-narrow": [{"cols": 8, "rows": 8}],   # A1-H8  = 64 drawers
    "all-wide": [{"cols": 4, "rows": 6}],     # A1-D6  = 24 drawers
    "half-half": [{"cols": 8, "rows": 4}, {"cols": 4, "rows": 3}],  # narrow over wide = 44
}


def _validate_band(band) -> dict:
    """Coerce/validate one band dict, raising 400 on bad geometry."""
    try:
        cols = int(band["cols"])
        rows = int(band["rows"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "each band needs integer cols and rows"
        )
    if not (1 <= cols <= len(LETTERS)):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"band cols must be between 1 and {len(LETTERS)}",
        )
    if rows < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "band rows must be >= 1")
    return {"cols": cols, "rows": rows}


def addresses_for_grid(grid_spec) -> list[str]:
    """Every drawer address for a band grid, walking bands top->bottom with
    continuous row numbering and per-row column letters (A1, B1, ... then A2, ...).
    Generalizes the hard-coded scheme that used to live in seed_storage."""
    out: list[str] = []
    row = 1
    for band in grid_spec:
        for _ in range(band["rows"]):
            for c in range(band["cols"]):
                out.append(f"{LETTERS[c]}{row}")
            row += 1
    return out


def normalize_grid_spec(body: dict) -> list[dict]:
    """Resolve a request body to a validated band list. Accepts either a `preset`
    name (one of PRESETS) or an explicit `grid_spec` band list."""
    preset = body.get("preset")
    if preset is not None:
        if preset not in PRESETS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"unknown preset '{preset}'; expected one of {', '.join(PRESETS)}",
            )
        # Return a fresh copy so callers can't mutate the shared preset.
        return [dict(b) for b in PRESETS[preset]]
    spec = body.get("grid_spec")
    if not isinstance(spec, list) or not spec:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "provide a preset or a non-empty grid_spec band list",
        )
    return [_validate_band(b) for b in spec]


def slot_label(slot: models.Slot) -> str:
    """Human-readable address for a slot, e.g. 'W-B2:C3' or 'Tackle chest · drawer 3 · front'."""
    if slot.kind == "wall" and slot.bin is not None:
        # Prefer the human label (e.g. "Cabinet 1") over the code when one is set.
        return f"{slot.bin.label or slot.bin.code}:{slot.address}"
    if slot.kind == "chest" and slot.chest is not None:
        return f"{slot.chest.label} · drawer {slot.drawer_number} · {slot.box_position}"
    return f"slot {slot.id}"


def resolve_location(container: models.Container, _depth: int = 0) -> str:
    """Resolve a container's position to a human-readable location string,
    walking up the parent chain (capped at 2 levels per the PRD)."""
    if container.slot_id is not None and container.slot is not None:
        return slot_label(container.slot)
    if container.freeform_location:
        return container.freeform_location
    if container.parent_container_id is not None and container.parent is not None:
        if _depth >= 2:  # safety; nesting is capped at 2 so this is unreachable
            return f"inside {container.parent.label}"
        return f"{container.parent.label} → {resolve_location(container.parent, _depth + 1)}"
    return "benched"


def location_ref(container: models.Container) -> dict:
    """Structured counterpart to resolve_location(): a machine-readable reference
    the frontend uses to pick which tab/cabinet/drawer to open and what to flash,
    without parsing the human-readable string. Mirrors the location_ref shape in
    prd/locations.prd. Renders from existing data — no migration needed."""
    if container.slot_id is not None and container.slot is not None:
        slot = container.slot
        if slot.kind == "wall" and slot.bin is not None:
            return {
                "kind": "wall",
                "bin_id": slot.bin.id,
                "bin_code": slot.bin.code,
                "bin_label": slot.bin.label,
                "address": slot.address,
            }
        if slot.kind == "chest" and slot.chest is not None:
            return {
                "kind": "chest",
                "chest_id": slot.chest.id,
                "drawer_number": slot.drawer_number,
                "box_position": slot.box_position,
            }
    if container.freeform_location:
        return {"kind": "freeform", "text": container.freeform_location}
    if container.parent_container_id is not None and container.parent is not None:
        return {"kind": "nested", "parent_container_id": container.parent_container_id}
    return {"kind": "benched"}


def bench(container: models.Container) -> None:
    """Clear all position fields (no commit)."""
    container.slot_id = None
    container.freeform_location = None
    container.parent_container_id = None


def assign_slot(db: Session, container: models.Container, slot_id: int) -> None:
    """Assign a container to a slot, atomically bumping any current occupant to
    benched. Clears the container's other position fields. Caller commits."""
    slot = db.get(models.Slot, slot_id)
    if slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slot not found")

    occupant = (
        db.query(models.Container)
        .filter(models.Container.slot_id == slot_id, models.Container.id != container.id)
        .first()
    )
    if occupant is not None:
        occupant.slot_id = None  # bump to benched — same transaction, no double-occupancy

    bench(container)
    db.flush()  # release the unique slot_id before re-assigning
    container.slot_id = slot_id


def swap_slot(
    db: Session,
    container: models.Container,
    target_slot_id: int,
    expected_source_slot_id: int | None = None,
) -> None:
    """Trade a placed container's slot with the occupant of ``target_slot_id``.

    Unlike :func:`assign_slot` (which *bumps* an occupant to benched), a swap is
    symmetric: the dragged container takes the target slot and the target's
    occupant takes the dragged container's old slot — neither benched. This is the
    right semantics for a drag-onto-occupied gesture ("trade places"), where a
    silent bump-to-benched would be a surprise. Caller commits.

    Like ``assign_slot``, the unique ``containers.slot_id`` column means we must
    clear both slots and ``flush()`` before re-assigning, so uniqueness is never
    tripped mid-swap.
    """
    source_slot_id = container.slot_id
    if source_slot_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Container is not in a slot; use assign-slot to place it",
        )
    # Guard against a stale board: the client computed this swap against a view of
    # the wall that may have moved under it. Reject rather than swap the wrong pair.
    if expected_source_slot_id is not None and source_slot_id != expected_source_slot_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Container has moved since the board was loaded — refresh and retry",
        )
    if target_slot_id == source_slot_id:
        return  # dropped onto itself — no-op

    target = db.get(models.Slot, target_slot_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Slot not found")

    occupant = (
        db.query(models.Container)
        .filter(
            models.Container.slot_id == target_slot_id,
            models.Container.id != container.id,
        )
        .first()
    )
    if occupant is None:
        # Target turned out to be empty (e.g. its occupant was moved meanwhile) —
        # degrade to an ordinary move rather than failing the gesture.
        container.slot_id = None
        db.flush()
        container.slot_id = target_slot_id
        return

    container.slot_id = None
    occupant.slot_id = None
    db.flush()  # release both unique slot_ids before cross-assigning
    container.slot_id = target_slot_id
    occupant.slot_id = source_slot_id


def assign_parent(db: Session, container: models.Container, parent_id: int) -> None:
    """Nest a container inside a parent. Enforces the 2-level cap. Caller commits."""
    if parent_id == container.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A container cannot be its own parent")
    parent = db.get(models.Container, parent_id)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Parent container not found")
    if parent.parent_container_id is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nesting is capped at 2 levels — the chosen parent already has a parent",
        )
    if container.children:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This container has children, so it cannot itself be nested",
        )
    bench(container)
    container.parent_container_id = parent_id


def set_freeform(container: models.Container, text: str) -> None:
    bench(container)
    container.freeform_location = text


def apply_position(db: Session, container: models.Container, data: dict) -> None:
    """Apply a position from a create/update payload. Accepts at most one of
    slot_id / parent_container_id / freeform_location. A position key present but
    null/empty means 'bench'. If no position key is present, leave as-is."""
    keys = [k for k in ("slot_id", "parent_container_id", "freeform_location") if k in data]
    if not keys:
        return
    if len(keys) > 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Provide at most one of slot_id, parent_container_id, freeform_location",
        )
    key = keys[0]
    value = data[key]
    if value in (None, ""):
        bench(container)
    elif key == "slot_id":
        assign_slot(db, container, value)
    elif key == "parent_container_id":
        assign_parent(db, container, value)
    else:
        set_freeform(container, value)


# ---------------------------------------------------------------------------
# Fixture (Bin / Chest / Slot) management for the GUI layout editor.
# prd/layout-editor.prd: editing a unit means reconciling its set of slots, and a
# displaced occupant is bumped to benched (never deleted) — the same contract as
# reseed_wall.py and the "assign to an occupied slot bumps the occupant" rule.
# ---------------------------------------------------------------------------


def _bench_slot_occupants(db: Session, slot_ids: list[int]) -> int:
    """Bench (clear slot_id of) every container sitting in the given slots, and
    flush so the slots are free to delete. Returns how many were bumped."""
    if not slot_ids:
        return 0
    occupants = (
        db.query(models.Container)
        .filter(models.Container.slot_id.in_(slot_ids))
        .all()
    )
    for c in occupants:
        c.slot_id = None
    db.flush()
    return len(occupants)


def reconcile_bin_slots(db: Session, bin: models.Bin, grid_spec: list[dict]) -> dict:
    """Make ``bin``'s wall slots match ``grid_spec`` (which is also stored on the
    bin by the caller). Address-stable: surviving addresses keep their slot and its
    occupant; only genuinely removed addresses bump their occupant to benched.
    Returns {added, removed, bumped} counts. Caller commits."""
    desired = set(addresses_for_grid(grid_spec))
    existing = {s.address: s for s in bin.slots}

    remove = [s for addr, s in existing.items() if addr not in desired]
    bumped = _bench_slot_occupants(db, [s.id for s in remove])
    for s in remove:
        db.delete(s)
    db.flush()

    add = desired - set(existing)
    for addr in add:
        db.add(models.Slot(kind="wall", bin_id=bin.id, address=addr))
    db.flush()
    return {"added": len(add), "removed": len(remove), "bumped": bumped}


def reconcile_chest_slots(db: Session, chest: models.Chest, num_drawers: int) -> dict:
    """Make ``chest``'s slots match ``num_drawers`` (each drawer has a front+back
    slot). Same bump-don't-delete contract as reconcile_bin_slots. Caller commits."""
    if num_drawers < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "num_drawers must be >= 1")
    desired = {(n, pos) for n in range(1, num_drawers + 1) for pos in ("front", "back")}
    existing = {(s.drawer_number, s.box_position): s for s in chest.slots}

    remove = [s for key, s in existing.items() if key not in desired]
    bumped = _bench_slot_occupants(db, [s.id for s in remove])
    for s in remove:
        db.delete(s)
    db.flush()

    add = desired - set(existing)
    for n, pos in add:
        db.add(models.Slot(kind="chest", chest_id=chest.id, drawer_number=n, box_position=pos))
    db.flush()
    return {"added": len(add), "removed": len(remove), "bumped": bumped}


def move_bin(db: Session, bin: models.Bin, row, col) -> None:
    """Place ``bin`` at wall cell (row, col). If another bin already occupies that
    cell, the two **swap** cells (symmetric, like swap_slot for drawers) — never
    blocked. The unique (wall_row, wall_col) constraint means we clear both cells
    and flush before re-assigning. Caller commits."""
    src_row, src_col = bin.wall_row, bin.wall_col
    if (src_row, src_col) == (row, col):
        return  # no-op

    occupant = None
    if row is not None and col is not None:
        occupant = (
            db.query(models.Bin)
            .filter(
                models.Bin.wall_row == row,
                models.Bin.wall_col == col,
                models.Bin.id != bin.id,
            )
            .first()
        )

    bin.wall_row = bin.wall_col = None
    if occupant is not None:
        occupant.wall_row = occupant.wall_col = None
    db.flush()  # release both cells before re-assigning

    bin.wall_row, bin.wall_col = row, col
    if occupant is not None:
        occupant.wall_row, occupant.wall_col = src_row, src_col


def next_bin_code(db: Session) -> str:
    """Auto-generate a unique bin code 'C{n}' past the highest existing C-number."""
    highest = 0
    for (code,) in db.query(models.Bin.code).all():
        if code and code[0] == "C" and code[1:].isdigit():
            highest = max(highest, int(code[1:]))
    return f"C{highest + 1}"


def delete_bin(db: Session, bin: models.Bin) -> int:
    """Bench every occupant of ``bin``'s slots, then delete the bin (its slots
    cascade). A removed unit must never strand a container — only clear its
    position. Returns how many containers were bumped. Caller commits."""
    bumped = _bench_slot_occupants(db, [s.id for s in bin.slots])
    db.delete(bin)
    db.flush()
    return bumped


def delete_chest(db: Session, chest: models.Chest) -> int:
    """Bench every occupant of ``chest``'s slots, then delete the chest (its slots
    cascade). Same don't-strand contract as delete_bin. Returns how many containers
    were bumped. Caller commits."""
    bumped = _bench_slot_occupants(db, [s.id for s in chest.slots])
    db.delete(chest)
    db.flush()
    return bumped
