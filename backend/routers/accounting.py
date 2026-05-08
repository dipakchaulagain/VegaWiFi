import csv
import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from backend.auth import get_current_user
from backend.services.radius_db import get_accounting, get_accounting_all

router = APIRouter(prefix="/api/v1/accounting", tags=["accounting"])

CSV_FIELDS = [
    "radacctid", "acctsessionid", "username", "realm", "nasipaddress",
    "calledstationid", "callingstationid", "framedipaddress",
    "acctstarttime", "acctstoptime", "acctsessiontime",
    "acctinputoctets", "acctoutputoctets", "acctterminatecause",
]


def _serialize_row(row: dict) -> dict:
    out = dict(row)
    for key in ("acctstarttime", "acctstoptime"):
        if out.get(key):
            out[key] = str(out[key])
    return out


@router.get("")
async def list_accounting(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=50, ge=1, le=200),
    username: Optional[str] = Query(default=None),
    nas_ip: Optional[str] = Query(default=None),
    ssid: Optional[str] = Query(default=None),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    total, rows = await get_accounting(
        page=page,
        per_page=per_page,
        username=username,
        nas_ip=nas_ip,
        ssid=ssid,
        from_date=from_date,
        to_date=to_date,
    )
    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [_serialize_row(r) for r in rows],
    }


@router.get("/export")
async def export_csv(
    username: Optional[str] = Query(default=None),
    nas_ip: Optional[str] = Query(default=None),
    ssid: Optional[str] = Query(default=None),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    rows = await get_accounting_all(
        username=username, nas_ip=nas_ip, ssid=ssid,
        from_date=from_date, to_date=to_date,
    )

    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"accounting_{timestamp}.csv"

    def generate():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        yield buf.getvalue()

        for row in rows:
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore")
            writer.writerow(_serialize_row(row))
            yield buf.getvalue()

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
