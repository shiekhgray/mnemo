from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app.auth import get_current_user
from app.database import get_db
from app.positions import resolve_location

router = APIRouter(prefix="/parts", tags=["parts"], dependencies=[Depends(get_current_user)])


def serialize(part: models.Part) -> dict:
    return {
        "id": part.id,
        "name": part.name,
        "category": part.category,
        "tags": part.tags or [],
        "notes": part.notes,
        "container_id": part.container_id,
        "container_label": part.container.label if part.container else None,
        "location": resolve_location(part.container) if part.container else None,
    }


@router.get("/search")
def search(q: str = Query(min_length=1), db: Session = Depends(get_db)):
    """Forgiving full-text-ish search across name + category + tags. This is the
    single most important piece of UX — fast lookup from a phone."""
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
    return [serialize(p) for p in parts]


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

    part = models.Part(
        name=name,
        category=body.get("category"),
        container_id=container_id,
        tags=body.get("tags") or [],
        notes=body.get("notes"),
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
