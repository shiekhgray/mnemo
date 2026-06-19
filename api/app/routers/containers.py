from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user
from app.database import get_db
from app.positions import apply_position, assign_slot, bench, resolve_location

router = APIRouter(
    prefix="/containers", tags=["containers"], dependencies=[Depends(get_current_user)]
)


def serialize(c: models.Container, db: Session) -> dict:
    return {
        "id": c.id,
        "label": c.label,
        "type": c.type,
        "slot_id": c.slot_id,
        "freeform_location": c.freeform_location,
        "parent_container_id": c.parent_container_id,
        "location": resolve_location(c),
        "benched": c.slot_id is None
        and c.freeform_location is None
        and c.parent_container_id is None,
        "part_count": db.query(models.Part).filter_by(container_id=c.id).count(),
    }


@router.get("")
def list_containers(db: Session = Depends(get_db)):
    containers = db.query(models.Container).order_by(models.Container.label).all()
    return [serialize(c, db) for c in containers]


@router.get("/benched")
def list_benched(db: Session = Depends(get_db)):
    """Containers with no current position — a 'where did I leave this' view and
    a worklist for bulk reorganization."""
    containers = (
        db.query(models.Container)
        .filter(
            models.Container.slot_id.is_(None),
            models.Container.freeform_location.is_(None),
            models.Container.parent_container_id.is_(None),
        )
        .order_by(models.Container.label)
        .all()
    )
    return [serialize(c, db) for c in containers]


@router.get("/{container_id}")
def get_container(container_id: int, db: Session = Depends(get_db)):
    c = db.get(models.Container, container_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Container not found")
    out = serialize(c, db)
    out["parts"] = [
        {"id": p.id, "name": p.name, "category": p.category, "tags": p.tags or []}
        for p in sorted(c.parts, key=lambda p: p.name)
    ]
    out["children"] = [
        {"id": ch.id, "label": ch.label} for ch in sorted(c.children, key=lambda ch: ch.label)
    ]
    return out


@router.get("/{container_id}/location")
def get_location(container_id: int, db: Session = Depends(get_db)):
    """Resolve a container's slot, freeform text, or parent chain to a
    human-readable location."""
    c = db.get(models.Container, container_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Container not found")
    return {"id": c.id, "label": c.label, "location": resolve_location(c)}


@router.post("", status_code=201)
def create_container(body: dict, db: Session = Depends(get_db)):
    label = (body.get("label") or "").strip()
    if not label:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "label is required")
    c = models.Container(label=label, type=body.get("type") or "other")
    db.add(c)
    db.flush()  # need an id before assigning a position
    apply_position(db, c, body)
    db.commit()
    db.refresh(c)
    return serialize(c, db)


@router.put("/{container_id}")
def update_container(container_id: int, body: dict, db: Session = Depends(get_db)):
    c = db.get(models.Container, container_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Container not found")
    if "label" in body:
        label = (body["label"] or "").strip()
        if not label:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "label cannot be empty")
        c.label = label
    if "type" in body:
        c.type = body["type"] or "other"
    apply_position(db, c, body)
    db.commit()
    db.refresh(c)
    return serialize(c, db)


@router.post("/{container_id}/assign-slot")
def assign_slot_endpoint(container_id: int, body: dict, db: Session = Depends(get_db)):
    """Assign this container to a slot, auto-bumping any current occupant to benched."""
    c = db.get(models.Container, container_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Container not found")
    slot_id = body.get("slot_id")
    if slot_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "slot_id is required")
    assign_slot(db, c, slot_id)
    db.commit()
    db.refresh(c)
    return serialize(c, db)


@router.post("/{container_id}/bench")
def bench_endpoint(container_id: int, db: Session = Depends(get_db)):
    """Explicitly bench a container (clear its position) — for deliberate reorg."""
    c = db.get(models.Container, container_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Container not found")
    bench(c)
    db.commit()
    db.refresh(c)
    return serialize(c, db)


@router.delete("/{container_id}", status_code=204)
def delete_container(container_id: int, db: Session = Depends(get_db)):
    c = db.get(models.Container, container_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Container not found")
    if c.children:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Container has nested containers; move them first"
        )
    db.delete(c)  # parts cascade-delete with the container
    db.commit()
