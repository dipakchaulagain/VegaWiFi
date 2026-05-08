from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Request, Response, status
from jose import JWTError, jwt
import bcrypt

from backend.config import get_settings
from backend.database import get_conn, get_cursor

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 8
COOKIE_NAME = "portal_token"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(username: str, role: str) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS)
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=TOKEN_EXPIRE_HOURS * 3600,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")


def _decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    portal_token: Optional[str] = Cookie(default=None),
) -> dict:
    if not portal_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _decode_token(portal_token)


async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return current_user


async def authenticate_portal_user(username: str, password: str) -> Optional[dict]:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "SELECT username, password_hash, role FROM portal_users WHERE username = %s",
                (username,),
            )
            row = await cur.fetchone()
    if row and verify_password(password, row["password_hash"]):
        return {"username": row["username"], "role": row["role"]}
    return None
