from typing import Optional, List
from pydantic import BaseModel, Field


class NasEntry(BaseModel):
    id: Optional[int] = None
    nasname: str = Field(..., description="NAS IP address")
    shortname: str = Field(..., max_length=32)
    type: str = "other"
    secret: str = Field(..., min_length=8)
    description: Optional[str] = None


class NasResponse(BaseModel):
    id: int
    nasname: str
    shortname: str
    type: str
    description: Optional[str] = None
    # secret deliberately omitted


class PolicyUpdate(BaseModel):
    auth_mode: Optional[str] = Field(None, pattern="^(db|ldap|hybrid)$")
    default_simultaneous_use: Optional[int] = Field(None, ge=1, le=10)
    ldap_server: Optional[str] = None
    ldap_bind_dn: Optional[str] = None
    ldap_bind_pw: Optional[str] = None  # plaintext — will be encrypted
    ldap_base_dn: Optional[str] = None
    ldap_group_dn: Optional[str] = None
    ldap_user_filter: Optional[str] = None


class PolicyResponse(BaseModel):
    auth_mode: str
    default_simultaneous_use: int
    ldap_server: Optional[str] = None
    ldap_bind_dn: Optional[str] = None
    ldap_bind_pw: str = "****"
    ldap_base_dn: Optional[str] = None
    ldap_group_dn: Optional[str] = None
    ldap_user_filter: Optional[str] = None
    radius_shared_secret: str = "****"
    nas_list: List[NasResponse] = []
