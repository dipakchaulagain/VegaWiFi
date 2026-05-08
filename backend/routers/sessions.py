from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.auth import require_admin
from backend.services import radius_db
from backend.services.audit import log_action
from backend.services.coa_sender import disconnect_session

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])


def _serialize(row: dict) -> dict:
    out = dict(row)
    if out.get("acctstarttime"):
        out["acctstarttime"] = str(out["acctstarttime"])
    return out


@router.get("/active")
async def list_active_sessions(current_user: dict = Depends(require_admin)):
    rows = await radius_db.get_active_sessions()
    return [_serialize(r) for r in rows]


@router.delete("/{radacctid}")
async def disconnect(
    radacctid: int,
    request: Request,
    current_user: dict = Depends(require_admin),
):
    session = await radius_db.get_session_by_id(radacctid)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    # Look up NAS secret
    nas_list = await radius_db.get_nas_list()
    nas = next((n for n in nas_list if n["nasname"] == session["nasipaddress"]), None)
    if not nas:
        raise HTTPException(status_code=400, detail=f"No NAS config found for {session['nasipaddress']}")

    success = disconnect_session(
        nas_ip=session["nasipaddress"],
        nas_secret=nas["secret"],
        session_id=session["acctsessionid"],
        username=session["username"],
    )

    if not success:
        raise HTTPException(status_code=502, detail="CoA Disconnect-NAK or timeout from NAS")

    await log_action(
        admin_user=current_user["sub"],
        action="session.disconnect",
        target=session["username"],
        detail={"radacctid": radacctid, "session_id": session["acctsessionid"]},
        ip_address=request.client.host if request.client else None,
    )
    return {"success": True}
