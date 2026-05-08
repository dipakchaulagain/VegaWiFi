from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.auth import authenticate_portal_user, clear_auth_cookie, create_token, set_auth_cookie
from backend.services.audit import log_action

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
limiter = Limiter(key_func=get_remote_address)


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, response: Response):
    user = await authenticate_portal_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_token(user["username"], user["role"])
    set_auth_cookie(response, token)
    await log_action(
        admin_user=user["username"],
        action="auth.login",
        target=user["username"],
        ip_address=request.client.host if request.client else None,
    )
    return {"username": user["username"], "role": user["role"]}


@router.post("/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
    return {"success": True}
