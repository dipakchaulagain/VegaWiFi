"""
Setup wizard — unauthenticated but only active while setup_complete = 0.
"""
from fastapi import APIRouter, HTTPException, Request, Response, status

from backend.auth import create_token, hash_password, set_auth_cookie
from backend.models.setup import LdapTestRequest, SetupPayload
from backend.services import ldap_client
from backend.services.audit import log_action
from backend.services.config_writer import encrypt_value, write_all
from backend.services.radius_db import (
    create_nas,
    get_config,
    set_config,
    set_config_bulk,
)
from backend.database import get_conn, get_cursor
from backend.config import get_settings

router = APIRouter(prefix="/api/v1/setup", tags=["setup"])


async def _require_setup_incomplete():
    done = await get_config("setup_complete")
    if done == "1":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Setup already complete")


@router.get("/status")
async def setup_status():
    done = await get_config("setup_complete")
    return {"setup_complete": done == "1"}


@router.post("/test-ldap")
async def test_ldap_connection(body: LdapTestRequest):
    await _require_setup_incomplete()
    result = ldap_client.test_connection(body.ldap_server, body.ldap_bind_dn, body.ldap_bind_pw)
    if not result["success"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result.get("error", "LDAP test failed"))
    return result


@router.post("/generate-eap-cert")
async def generate_eap_cert():
    """Run easy-rsa to generate a self-signed CA + server cert for EAP-PEAP."""
    await _require_setup_incomplete()
    import subprocess
    from pathlib import Path

    easy_rsa_dir = Path("/opt/portal/easy-rsa")
    pki_dir = easy_rsa_dir / "pki"

    try:
        if not easy_rsa_dir.exists():
            easy_rsa_dir.mkdir(parents=True, exist_ok=True)

        # Copy easy-rsa scripts
        subprocess.run(
            ["cp", "-r", "/usr/share/easy-rsa/.", str(easy_rsa_dir)],
            check=True, capture_output=True, timeout=30,
        )

        env = {
            "EASYRSA_BATCH": "1",
            "EASYRSA_REQ_CN": "FreeRADIUS-CA",
            "EASYRSA_PKI": str(pki_dir),
            "PATH": "/usr/bin:/bin",
        }

        subprocess.run(
            [str(easy_rsa_dir / "easyrsa"), "init-pki"],
            check=True, capture_output=True, timeout=60, env=env, cwd=str(easy_rsa_dir),
        )
        subprocess.run(
            [str(easy_rsa_dir / "easyrsa"), "build-ca", "nopass"],
            check=True, capture_output=True, timeout=120, env=env, cwd=str(easy_rsa_dir),
        )
        subprocess.run(
            [str(easy_rsa_dir / "easyrsa"), "gen-req", "radius-server", "nopass"],
            check=True, capture_output=True, timeout=60, env=env, cwd=str(easy_rsa_dir),
        )
        subprocess.run(
            [str(easy_rsa_dir / "easyrsa"), "sign-req", "server", "radius-server"],
            check=True, capture_output=True, timeout=120, env=env, cwd=str(easy_rsa_dir),
        )

        cert_path = str(pki_dir / "issued" / "radius-server.crt")
        return {"success": True, "cert_path": cert_path, "pki_dir": str(pki_dir)}

    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"easy-rsa failed: {exc.stderr.decode() if exc.stderr else str(exc)}",
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@router.post("/init")
async def init_setup(body: SetupPayload, request: Request, response: Response):
    await _require_setup_incomplete()
    settings = get_settings()

    # Validate LDAP if needed
    if body.requires_ldap():
        if not all([body.ldap_server, body.ldap_bind_dn, body.ldap_bind_pw, body.ldap_base_dn]):
            raise HTTPException(status_code=400, detail="LDAP fields required for selected auth mode")

        result = ldap_client.test_connection(body.ldap_server, body.ldap_bind_dn, body.ldap_bind_pw)
        if not result["success"]:
            raise HTTPException(
                status_code=400,
                detail=f"LDAP connection test failed: {result.get('error', 'Unknown error')}",
            )

    # Encrypt sensitive fields
    enc_secret = encrypt_value(body.radius_shared_secret, settings.AES_KEY)
    enc_ldap_pw = encrypt_value(body.ldap_bind_pw, settings.AES_KEY) if body.ldap_bind_pw else ""

    # Persist configuration
    config_entries: dict[str, str] = {
        "auth_mode": body.auth_mode,
        "radius_shared_secret": enc_secret,
        "default_simultaneous_use": "2",
    }

    if body.ldap_server:
        config_entries["ldap_server"] = body.ldap_server
    if body.ldap_bind_dn:
        config_entries["ldap_bind_dn"] = body.ldap_bind_dn
    if enc_ldap_pw:
        config_entries["ldap_bind_pw"] = enc_ldap_pw
    if body.ldap_base_dn:
        config_entries["ldap_base_dn"] = body.ldap_base_dn
    if body.ldap_group_dn:
        config_entries["ldap_group_dn"] = body.ldap_group_dn
    if body.ldap_user_filter:
        config_entries["ldap_user_filter"] = body.ldap_user_filter
    if body.eap_cert_path:
        config_entries["eap_cert_path"] = body.eap_cert_path

    await set_config_bulk(config_entries)

    # Create NAS entry
    await create_nas(
        nasname=body.nas_ip,
        shortname=body.nas_shortname,
        nas_type="other",
        secret=body.radius_shared_secret,
        description=body.nas_description,
    )

    # Write FreeRADIUS configs
    write_result = await write_all()
    if not write_result["success"]:
        raise HTTPException(
            status_code=500,
            detail=f"FreeRADIUS config write failed: {write_result['stderr']}",
        )

    # Create admin portal user
    pw_hash = hash_password(body.admin_password)
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "INSERT INTO portal_users (username, password_hash, role) VALUES (%s, %s, 'admin') "
                "ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)",
                (body.admin_username, pw_hash),
            )

    # Mark setup complete
    await set_config("setup_complete", "1")

    # Auto-login
    token = create_token(body.admin_username, "admin")
    set_auth_cookie(response, token)

    await log_action(
        admin_user=body.admin_username,
        action="setup.init",
        target="system",
        detail={"auth_mode": body.auth_mode, "nas_ip": body.nas_ip},
        ip_address=request.client.host if request.client else None,
    )

    return {"success": True}
