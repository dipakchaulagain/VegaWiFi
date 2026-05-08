from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.auth import require_admin
from backend.config import get_settings
from backend.models.policy import NasEntry, PolicyUpdate
from backend.services import radius_db
from backend.services.audit import log_action
from backend.services.config_writer import encrypt_value, write_all

router = APIRouter(prefix="/api/v1", tags=["policy"])


@router.get("/policy")
async def get_policy(current_user: dict = Depends(require_admin)):
    config = await radius_db.get_all_config()
    nas_list = await radius_db.get_nas_list()
    # Strip secrets from NAS list
    safe_nas = [
        {k: v for k, v in n.items() if k != "secret"}
        for n in nas_list
    ]
    return {
        "auth_mode": config.get("auth_mode", "db"),
        "default_simultaneous_use": int(config.get("default_simultaneous_use", 2)),
        "ldap_server": config.get("ldap_server"),
        "ldap_bind_dn": config.get("ldap_bind_dn"),
        "ldap_bind_pw": "****",
        "ldap_base_dn": config.get("ldap_base_dn"),
        "ldap_group_dn": config.get("ldap_group_dn"),
        "ldap_user_filter": config.get("ldap_user_filter"),
        "radius_shared_secret": "****",
        "nas_list": safe_nas,
    }


@router.put("/policy")
async def update_policy(
    body: PolicyUpdate,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    settings = get_settings()
    updates: dict[str, str] = {}

    if body.auth_mode is not None:
        updates["auth_mode"] = body.auth_mode
    if body.default_simultaneous_use is not None:
        updates["default_simultaneous_use"] = str(body.default_simultaneous_use)
    if body.ldap_server is not None:
        updates["ldap_server"] = body.ldap_server
    if body.ldap_bind_dn is not None:
        updates["ldap_bind_dn"] = body.ldap_bind_dn
    if body.ldap_bind_pw is not None:
        updates["ldap_bind_pw"] = encrypt_value(body.ldap_bind_pw, settings.AES_KEY)
    if body.ldap_base_dn is not None:
        updates["ldap_base_dn"] = body.ldap_base_dn
    if body.ldap_group_dn is not None:
        updates["ldap_group_dn"] = body.ldap_group_dn
    if body.ldap_user_filter is not None:
        updates["ldap_user_filter"] = body.ldap_user_filter

    if updates:
        await radius_db.set_config_bulk(updates)

    write_result = await write_all()

    await log_action(
        admin_user=current_user["sub"],
        action="policy.update",
        target="global",
        detail={k: v for k, v in updates.items() if "pw" not in k and "secret" not in k},
        ip_address=request.client.host if request.client else None,
    )

    if not write_result["success"]:
        raise HTTPException(
            status_code=500,
            detail=f"Config write failed: {write_result['stderr']}",
        )

    return {"success": True, "reload_result": write_result}


# ── NAS management ────────────────────────────────────────────────────────────

@router.get("/nas")
async def list_nas(current_user: dict = Depends(require_admin)):
    nas_list = await radius_db.get_nas_list()
    return [{k: v for k, v in n.items() if k != "secret"} for n in nas_list]


@router.post("/nas", status_code=status.HTTP_201_CREATED)
async def create_nas(
    body: NasEntry,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    nas_id = await radius_db.create_nas(
        nasname=body.nasname,
        shortname=body.shortname,
        nas_type=body.type,
        secret=body.secret,
        description=body.description,
    )
    write_result = await write_all()
    await log_action(
        admin_user=current_user["sub"],
        action="nas.create",
        target=body.shortname,
        ip_address=request.client.host if request.client else None,
    )
    if not write_result["success"]:
        raise HTTPException(status_code=500, detail=f"NAS created but config reload failed: {write_result['stderr']}")
    return {"id": nas_id, "success": True}


@router.put("/nas/{nas_id}")
async def update_nas(
    nas_id: int,
    body: NasEntry,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    await radius_db.update_nas(nas_id, body.nasname, body.shortname, body.secret, body.description)
    write_result = await write_all()
    await log_action(
        admin_user=current_user["sub"],
        action="nas.update",
        target=body.shortname,
        ip_address=request.client.host if request.client else None,
    )
    if not write_result["success"]:
        raise HTTPException(status_code=500, detail=f"NAS updated but config reload failed: {write_result['stderr']}")
    return {"success": True}


@router.delete("/nas/{nas_id}")
async def delete_nas(
    nas_id: int,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    await radius_db.delete_nas(nas_id)
    write_result = await write_all()
    await log_action(
        admin_user=current_user["sub"],
        action="nas.delete",
        target=str(nas_id),
        ip_address=request.client.host if request.client else None,
    )
    if not write_result["success"]:
        raise HTTPException(status_code=500, detail=f"NAS deleted but config reload failed: {write_result['stderr']}")
    return {"success": True}
