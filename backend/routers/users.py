from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.auth import require_admin
from backend.config import get_settings
from backend.models.users import BlockRequest, LocalUserCreate, LocalUserUpdate
from backend.services import ldap_client, radius_db
from backend.services.audit import log_action

router = APIRouter(prefix="/api/v1/users", tags=["users"])


# ── Local users ───────────────────────────────────────────────────────────────

@router.get("/local")
async def list_local_users(current_user: dict = Depends(require_admin)):
    return await radius_db.get_local_users()


@router.post("/local", status_code=status.HTTP_201_CREATED)
async def create_local_user(
    body: LocalUserCreate,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    existing = await radius_db.get_local_users()
    if any(u["username"] == body.username for u in existing):
        raise HTTPException(status_code=409, detail="User already exists")

    sim_use = body.simultaneous_use
    if sim_use is None:
        cfg = await radius_db.get_config("default_simultaneous_use")
        sim_use = int(cfg) if cfg else 2

    await radius_db.create_local_user(body.username, body.password, sim_use)
    await log_action(
        admin_user=current_user["sub"],
        action="user.create",
        target=body.username,
        ip_address=request.client.host if request.client else None,
    )
    return {"success": True}


@router.put("/local/{username}")
async def update_local_user(
    username: str,
    body: LocalUserUpdate,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    await radius_db.update_local_user(username, body.password, body.simultaneous_use)
    await log_action(
        admin_user=current_user["sub"],
        action="user.update",
        target=username,
        ip_address=request.client.host if request.client else None,
    )
    return {"success": True}


@router.delete("/local/{username}")
async def delete_local_user(
    username: str,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    await radius_db.delete_local_user(username)
    await log_action(
        admin_user=current_user["sub"],
        action="user.delete",
        target=username,
        ip_address=request.client.host if request.client else None,
    )
    return {"success": True}


@router.post("/local/{username}/block")
async def block_local_user(
    username: str,
    body: BlockRequest,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    await radius_db.block_user(username)
    await log_action(
        admin_user=current_user["sub"],
        action="user.block",
        target=username,
        detail={"reason": body.reason},
        ip_address=request.client.host if request.client else None,
    )
    return {"success": True}


@router.post("/local/{username}/unblock")
async def unblock_local_user(
    username: str,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    await radius_db.unblock_user(username)
    await log_action(
        admin_user=current_user["sub"],
        action="user.unblock",
        target=username,
        ip_address=request.client.host if request.client else None,
    )
    return {"success": True}


@router.get("/local/{username}/detail")
async def user_detail(username: str, current_user: dict = Depends(require_admin)):
    history = await radius_db.get_user_auth_history(username)
    sessions = await radius_db.get_user_sessions(username)
    blocked_list = await radius_db.get_local_users()
    user_row = next((u for u in blocked_list if u["username"] == username), None)

    def _ser(row):
        out = dict(row)
        for k in ("acctstarttime", "authdate"):
            if out.get(k):
                out[k] = str(out[k])
        return out

    return {
        "username": username,
        "blocked": user_row["blocked"] if user_row else False,
        "simultaneous_use": user_row["simultaneous_use"] if user_row else 2,
        "auth_history": [_ser(r) for r in history],
        "active_sessions": [_ser(s) for s in sessions],
    }


# ── LDAP users ────────────────────────────────────────────────────────────────

@router.get("/ldap")
async def list_ldap_users(current_user: dict = Depends(require_admin)):
    config = await radius_db.get_all_config()
    settings = get_settings()

    if not config.get("ldap_server"):
        raise HTTPException(status_code=400, detail="LDAP not configured")

    from backend.services.config_writer import decrypt_value
    ldap_pw = decrypt_value(config["ldap_bind_pw"], settings.AES_KEY) if config.get("ldap_bind_pw") else ""

    members = ldap_client.list_group_members(
        server_url=config["ldap_server"],
        bind_dn=config["ldap_bind_dn"],
        bind_pw=ldap_pw,
        group_dn=config["ldap_group_dn"],
        base_dn=config["ldap_base_dn"],
    )

    # Enrich with RADIUS data
    async def get_extras(username: str) -> dict:
        from backend.database import get_conn, get_cursor
        async with get_conn() as conn:
            async with get_cursor(conn) as cur:
                await cur.execute(
                    "SELECT authdate FROM radpostauth WHERE username = %s ORDER BY id DESC LIMIT 1",
                    (username,),
                )
                last = await cur.fetchone()
                await cur.execute(
                    "SELECT COUNT(*) AS cnt FROM radacct WHERE username = %s AND acctstoptime IS NULL",
                    (username,),
                )
                sessions = await cur.fetchone()
                await cur.execute(
                    "SELECT id FROM radcheck WHERE username = %s AND attribute = 'Auth-Type' AND value = 'Reject'",
                    (username,),
                )
                blocked = await cur.fetchone() is not None
        return {
            "last_seen": str(last["authdate"]) if last else None,
            "current_sessions": sessions["cnt"] if sessions else 0,
            "blocked": blocked,
        }

    result = []
    for m in members:
        extras = await get_extras(m["username"])
        result.append({**m, **extras})

    return {"group_dn": config.get("ldap_group_dn", ""), "members": result}


@router.post("/ldap/{username}/block")
async def block_ldap_user(
    username: str,
    body: BlockRequest,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    await radius_db.block_user(username)
    await log_action(
        admin_user=current_user["sub"],
        action="user.block",
        target=username,
        detail={"source": "ldap", "reason": body.reason},
        ip_address=request.client.host if request.client else None,
    )
    return {"success": True}


@router.post("/ldap/{username}/unblock")
async def unblock_ldap_user(
    username: str,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    await radius_db.unblock_user(username)
    await log_action(
        admin_user=current_user["sub"],
        action="user.unblock",
        target=username,
        detail={"source": "ldap"},
        ip_address=request.client.host if request.client else None,
    )
    return {"success": True}
