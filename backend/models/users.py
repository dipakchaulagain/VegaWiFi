from typing import Optional
from pydantic import BaseModel, Field


class LocalUserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=6)
    simultaneous_use: Optional[int] = Field(None, ge=1, le=10)


class LocalUserUpdate(BaseModel):
    password: Optional[str] = Field(None, min_length=6)
    simultaneous_use: Optional[int] = Field(None, ge=1, le=10)


class BlockRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=255)


class LocalUserResponse(BaseModel):
    username: str
    simultaneous_use: int
    blocked: bool
    last_seen: Optional[str] = None


class LdapUserResponse(BaseModel):
    username: str
    display_name: Optional[str] = None
    email: Optional[str] = None
    distinguished_name: Optional[str] = None
    current_sessions: int = 0
    last_seen: Optional[str] = None
    blocked: bool = False
