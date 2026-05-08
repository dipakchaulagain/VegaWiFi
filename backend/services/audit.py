import json
from typing import Any, Optional

from backend.database import get_conn, get_cursor


async def log_action(
    admin_user: str,
    action: str,
    target: str,
    detail: Optional[dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                """
                INSERT INTO audit_log (admin_user, action, target, detail, ip_address)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    admin_user,
                    action,
                    target,
                    json.dumps(detail) if detail else None,
                    ip_address,
                ),
            )
