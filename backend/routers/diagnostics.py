import asyncio
import subprocess
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.auth import require_admin
from backend.config import get_settings
from backend.services import ldap_client, radius_db
from backend.services.config_writer import decrypt_value

router = APIRouter(prefix="/api/v1/diagnostics", tags=["diagnostics"])


class TestAuthRequest(BaseModel):
    username: str
    password: str


class TestLdapRequest(BaseModel):
    use_saved: bool = True
    ldap_server: str = ""
    ldap_bind_dn: str = ""
    ldap_bind_pw: str = ""


@router.post("/test-auth")
async def test_auth(body: TestAuthRequest, current_user: dict = Depends(require_admin)):
    config = await radius_db.get_all_config()
    settings = get_settings()

    radius_secret = ""
    if config.get("radius_shared_secret"):
        try:
            radius_secret = decrypt_value(config["radius_shared_secret"], settings.AES_KEY)
        except Exception:
            raise HTTPException(status_code=500, detail="Could not decrypt RADIUS secret")

    cmd = [
        "radtest",
        body.username,
        body.password,
        "127.0.0.1",
        "0",
        radius_secret,
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=15,
        )
        output = result.stdout + result.stderr
        passed = "Access-Accept" in output
        return {"success": passed, "output": output}
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="radtest binary not found")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="radtest timed out")


@router.post("/test-ldap")
async def test_ldap(body: TestLdapRequest, current_user: dict = Depends(require_admin)):
    if body.use_saved:
        config = await radius_db.get_all_config()
        settings = get_settings()

        if not config.get("ldap_server"):
            raise HTTPException(status_code=400, detail="LDAP not configured")

        ldap_pw = decrypt_value(config["ldap_bind_pw"], settings.AES_KEY) if config.get("ldap_bind_pw") else ""
        result = ldap_client.test_connection(config["ldap_server"], config["ldap_bind_dn"], ldap_pw)

        member_count = 0
        sample_members = []
        if result["success"]:
            members = ldap_client.list_group_members(
                server_url=config["ldap_server"],
                bind_dn=config["ldap_bind_dn"],
                bind_pw=ldap_pw,
                group_dn=config.get("ldap_group_dn", ""),
                base_dn=config.get("ldap_base_dn", ""),
            )
            member_count = len(members)
            sample_members = members[:5]

        return {**result, "member_count": member_count, "sample_members": sample_members}
    else:
        result = ldap_client.test_connection(body.ldap_server, body.ldap_bind_dn, body.ldap_bind_pw)
        return result


@router.get("/log-stream")
async def log_stream(current_user: dict = Depends(require_admin)):
    settings = get_settings()
    log_path = settings.FR_LOG

    async def generate() -> AsyncGenerator[str, None]:
        try:
            # Send last 200 lines on connect
            try:
                with open(log_path, "r", errors="replace") as f:
                    lines = f.readlines()
                    for line in lines[-200:]:
                        yield f"data: {line.rstrip()}\n\n"
            except FileNotFoundError:
                yield f"data: [Log file not found: {log_path}]\n\n"
                return

            # Tail new lines
            with open(log_path, "r", errors="replace") as f:
                f.seek(0, 2)  # seek to end
                while True:
                    line = f.readline()
                    if line:
                        yield f"data: {line.rstrip()}\n\n"
                    else:
                        await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            return

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
