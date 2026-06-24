from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user
from app.database import get_db
from app.positions import location_ref, resolve_location

router = APIRouter(prefix="/parts", tags=["parts"], dependencies=[Depends(get_current_user)])


def parse_count(body: dict) -> tuple[int | None, bool]:
    """Resolve the (count, count_is_many) pair from a request body. "many" wins and
    forces count to NULL; an empty/absent count means unspecified."""
    if body.get("count_is_many"):
        return None, True
    raw = body.get("count")
    if raw in (None, ""):
        return None, False
    try:
        n = int(raw)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "count must be a whole number")
    if n < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "count cannot be negative")
    return n, False


def serialize(part: models.Part) -> dict:
    return {
        "id": part.id,
        "name": part.name,
        "category": part.category,
        "tags": part.tags or [],
        "notes": part.notes,
        "count": part.count,
        "count_is_many": part.count_is_many,
        "container_id": part.container_id,
        "container_label": part.container.label if part.container else None,
        "location": resolve_location(part.container) if part.container else None,
        "location_ref": location_ref(part.container) if part.container else None,
    }


def serialize_container_hit(c: models.Container) -> dict:
    """A search result for a container matched by its own label (rather than a part
    inside it) — e.g. a drawer you just labelled but haven't catalogued yet. Shaped
    like a part hit so the frontend renders it uniformly; `is_container` flags it."""
    return {
        "id": f"container-{c.id}",
        "name": c.label,
        "category": None,
        "tags": [],
        "notes": None,
        "count": None,
        "count_is_many": False,
        "container_id": c.id,
        "container_label": c.label,
        "location": resolve_location(c),
        "location_ref": location_ref(c),
        "is_container": True,
    }


@router.get("/search")
def search(q: str = Query(min_length=1), db: Session = Depends(get_db)):
    """Forgiving full-text-ish search across name + category + tags. This is the
    single most important piece of UX — fast lookup from a phone. Also matches a
    *container's* own label so an empty, not-yet-catalogued drawer is still findable."""
    like = f"%{q}%"
    parts = (
        db.query(models.Part)
        .filter(
            or_(
                models.Part.name.ilike(like),
                models.Part.category.ilike(like),
                func.array_to_string(models.Part.tags, " ").ilike(like),
            )
        )
        .order_by(models.Part.name)
        .limit(100)
        .all()
    )
    results = [serialize(p) for p in parts]

    # Containers whose own label matches, that aren't already represented by a part
    # hit above (avoids a duplicate row when a part inside it also matched).
    covered = {p.container_id for p in parts}
    containers = (
        db.query(models.Container)
        .filter(models.Container.label.ilike(like))
        .order_by(models.Container.label)
        .limit(100)
        .all()
    )
    results.extend(
        serialize_container_hit(c) for c in containers if c.id not in covered
    )
    results.sort(key=lambda r: (r["name"] or "").lower())
    return results[:100]


@router.get("/{part_id}")
def get_part(part_id: int, db: Session = Depends(get_db)):
    part = db.get(models.Part, part_id)
    if part is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Part not found")
    return serialize(part)


@router.post("", status_code=201)
def create_part(body: dict, db: Session = Depends(get_db)):
    container_id = body.get("container_id")
    if container_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "container_id is required")
    if db.get(models.Container, container_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Container not found")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "name is required")

    count, count_is_many = parse_count(body)
    part = models.Part(
        name=name,
        category=body.get("category"),
        container_id=container_id,
        tags=body.get("tags") or [],
        notes=body.get("notes"),
        count=count,
        count_is_many=count_is_many,
    )
    db.add(part)
    db.commit()
    db.refresh(part)
    return serialize(part)


@router.put("/{part_id}")
def update_part(part_id: int, body: dict, db: Session = Depends(get_db)):
    part = db.get(models.Part, part_id)
    if part is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Part not found")

    if "container_id" in body:
        if db.get(models.Container, body["container_id"]) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Container not found")
        part.container_id = body["container_id"]
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "name cannot be empty")
        part.name = name
    if "category" in body:
        part.category = body["category"]
    if "tags" in body:
        part.tags = body["tags"] or []
    if "notes" in body:
        part.notes = body["notes"]
    if "count" in body or "count_is_many" in body:
        part.count, part.count_is_many = parse_count(body)

    db.commit()
    db.refresh(part)
    return serialize(part)


@router.delete("/{part_id}", status_code=204)
def delete_part(part_id: int, db: Session = Depends(get_db)):
    part = db.get(models.Part, part_id)
    if part is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Part not found")
    db.delete(part)
    db.commit()
