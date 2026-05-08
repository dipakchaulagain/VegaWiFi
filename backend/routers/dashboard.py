from fastapi import APIRouter, Depends

from backend.auth import get_current_user
from backend.services.radius_db import get_dashboard_summary

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get("/summary")
async def summary(current_user: dict = Depends(get_current_user)):
    data = await get_dashboard_summary()
    # Convert datetime objects to strings for JSON
    for session in data.get("recent_sessions", []):
        if session.get("acctstarttime"):
            session["acctstarttime"] = str(session["acctstarttime"])
    return data
