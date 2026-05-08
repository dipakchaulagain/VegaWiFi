from typing import Optional
from pydantic import BaseModel, Field


class SetupPayload(BaseModel):
    # Step 1
    auth_mode: str = Field(..., pattern="^(db|ldap|hybrid)$")

    # Step 2 — required if auth_mode != db
    ldap_server: Optional[str] = None
    ldap_bind_dn: Optional[str] = None
    ldap_bind_pw: Optional[str] = None
    ldap_base_dn: Optional[str] = None
    ldap_group_dn: Optional[str] = None
    ldap_user_filter: str = "(&(objectClass=user)(sAMAccountName=%u))"

    # Step 3
    radius_shared_secret: str = Field(..., min_length=8)
    nas_ip: str = Field(..., description="Huawei AC IP address")
    nas_shortname: str = Field(..., max_length=32)
    nas_description: Optional[str] = None

    # Step 4
    eap_cert_path: Optional[str] = None  # None means generate self-signed

    # Step 5
    admin_username: str = Field(..., min_length=3, max_length=64)
    admin_password: str = Field(..., min_length=8)

    def requires_ldap(self) -> bool:
        return self.auth_mode in ("ldap", "hybrid")


class LdapTestRequest(BaseModel):
    ldap_server: str
    ldap_bind_dn: str
    ldap_bind_pw: str
    ldap_base_dn: str
