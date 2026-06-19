from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app import models
from app.auth import (
    ALGORITHM,
    create_access_token,
    create_refresh_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.config import settings
from app.database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter_by(username=form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(user.id),
        "token_type": "bearer",
    }


@router.post("/refresh")
def refresh(payload: dict, db: Session = Depends(get_db)):
    """Exchange a refresh token for a new access token."""
    token = payload.get("refresh_token", "")
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
    )
    try:
        data = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        if data.get("type") != "refresh":
            raise credentials_exc
        user_id = int(data["sub"])
    except (JWTError, KeyError, ValueError):
        raise credentials_exc

    user = db.get(models.User, user_id)
    if user is None:
        raise credentials_exc

    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
    }


@router.get("/me")
def me(current_user: models.User = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username}


@router.post("/change-password", status_code=204)
def change_password(
    payload: dict,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.get("current_password", ""), current_user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    new_password = payload.get("new_password", "")
    if len(new_password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be at least 8 characters")
    current_user.password_hash = hash_password(new_password)
    db.commit()
