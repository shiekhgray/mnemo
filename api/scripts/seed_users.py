#!/usr/bin/env python3
"""Add a user to the database.

Usage (from inside the container):
    python scripts/seed_users.py <username> <password>
"""

import sys
from pathlib import Path

# Allow imports from the app package
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.auth import hash_password
from app.database import SessionLocal
from app import models


def add_user(username: str, password: str) -> None:
    db = SessionLocal()
    try:
        existing = db.query(models.User).filter_by(username=username).first()
        if existing:
            print(f"User '{username}' already exists (id={existing.id})")
            return
        user = models.User(username=username, password_hash=hash_password(password))
        db.add(user)
        db.commit()
        db.refresh(user)
        print(f"Created user '{username}' (id={user.id})")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python scripts/seed_users.py <username> <password>")
        sys.exit(1)
    add_user(sys.argv[1], sys.argv[2])
