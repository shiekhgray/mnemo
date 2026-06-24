"""Container position logic — the non-obvious rules from the PRD live here.

A container's position is *at most one of* slot / parent / freeform, or none
("benched"). Slots are unique; assigning to an occupied slot atomically bumps
the occupant to benched. Nesting is capped at 2 levels.
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models


def slot_label(slot: models.Slot) -> str:
    """Human-readable address for a slot, e.g. 'W-B2:C3' or 'Tackle chest · drawer 3 · front'."""
    if slot.kind == "wall" and slot.bin is not None:
        return f"{slot.bin.code}:{slot.address}"
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
