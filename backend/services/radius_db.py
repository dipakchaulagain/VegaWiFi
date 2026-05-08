"""All MariaDB queries against FreeRADIUS tables."""
from typing import Any, Optional

from backend.database import get_conn, get_cursor


# ── app_config helpers ────────────────────────────────────────────────────────

async def get_config(key: str) -> Optional[str]:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute("SELECT value FROM app_config WHERE `key` = %s", (key,))
            row = await cur.fetchone()
    return row["value"] if row else None


async def get_all_config() -> dict[str, str]:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute("SELECT `key`, value FROM app_config")
            rows = await cur.fetchall()
    return {r["key"]: r["value"] for r in rows}


async def set_config(key: str, value: str) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "INSERT INTO app_config (`key`, value) VALUES (%s, %s) "
                "ON DUPLICATE KEY UPDATE value = VALUES(value)",
                (key, value),
            )


async def set_config_bulk(items: dict[str, str]) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            for key, value in items.items():
                await cur.execute(
                    "INSERT INTO app_config (`key`, value) VALUES (%s, %s) "
                    "ON DUPLICATE KEY UPDATE value = VALUES(value)",
                    (key, value),
                )


# ── radcheck / radreply ───────────────────────────────────────────────────────

async def get_local_users() -> list[dict]:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                """
                SELECT DISTINCT username FROM radcheck
                WHERE attribute = 'Cleartext-Password'
                """
            )
            users = [r["username"] for r in await cur.fetchall()]

            result = []
            for uname in users:
                await cur.execute(
                    "SELECT value FROM radcheck WHERE username = %s AND attribute = 'Simultaneous-Use'",
                    (uname,),
                )
                sim = await cur.fetchone()

                await cur.execute(
                    "SELECT id FROM radcheck WHERE username = %s AND attribute = 'Auth-Type' AND value = 'Reject'",
                    (uname,),
                )
                blocked = await cur.fetchone() is not None

                await cur.execute(
                    "SELECT authdate FROM radpostauth WHERE username = %s ORDER BY id DESC LIMIT 1",
                    (uname,),
                )
                last = await cur.fetchone()

                result.append(
                    {
                        "username": uname,
                        "simultaneous_use": int(sim["value"]) if sim else 2,
                        "blocked": blocked,
                        "last_seen": str(last["authdate"]) if last else None,
                    }
                )
    return result


async def create_local_user(username: str, password: str, sim_use: int) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, 'Cleartext-Password', ':=', %s)",
                (username, password),
            )
            await cur.execute(
                "INSERT INTO radcheck (username, attribute, op, value) VALUES (%s, 'Simultaneous-Use', ':=', %s)",
                (username, str(sim_use)),
            )


async def update_local_user(username: str, password: Optional[str], sim_use: Optional[int]) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            if password is not None:
                await cur.execute(
                    "UPDATE radcheck SET value = %s WHERE username = %s AND attribute = 'Cleartext-Password'",
                    (password, username),
                )
            if sim_use is not None:
                await cur.execute(
                    "UPDATE radcheck SET value = %s WHERE username = %s AND attribute = 'Simultaneous-Use'",
                    (str(sim_use), username),
                )


async def delete_local_user(username: str) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute("DELETE FROM radcheck WHERE username = %s", (username,))
            await cur.execute("DELETE FROM radreply WHERE username = %s", (username,))


async def block_user(username: str) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "INSERT IGNORE INTO radcheck (username, attribute, op, value) "
                "VALUES (%s, 'Auth-Type', ':=', 'Reject')",
                (username,),
            )


async def unblock_user(username: str) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "DELETE FROM radcheck WHERE username = %s AND attribute = 'Auth-Type' AND value = 'Reject'",
                (username,),
            )


# ── sessions / accounting ─────────────────────────────────────────────────────

async def get_active_sessions() -> list[dict]:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                """
                SELECT radacctid, acctsessionid, username, nasipaddress, nasportid,
                       calledstationid, callingstationid, framedipaddress,
                       acctstarttime,
                       TIMESTAMPDIFF(SECOND, acctstarttime, NOW()) AS duration_seconds
                FROM radacct
                WHERE acctstoptime IS NULL
                ORDER BY acctstarttime DESC
                """
            )
            return await cur.fetchall()


async def get_session_by_id(radacctid: int) -> Optional[dict]:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "SELECT * FROM radacct WHERE radacctid = %s AND acctstoptime IS NULL",
                (radacctid,),
            )
            return await cur.fetchone()


async def get_accounting(
    page: int,
    per_page: int,
    username: Optional[str] = None,
    nas_ip: Optional[str] = None,
    ssid: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> tuple[int, list[dict]]:
    where_clauses = []
    params: list[Any] = []

    if username:
        where_clauses.append("username LIKE %s")
        params.append(f"%{username}%")
    if nas_ip:
        where_clauses.append("nasipaddress = %s")
        params.append(nas_ip)
    if ssid:
        where_clauses.append("calledstationid LIKE %s")
        params.append(f"%{ssid}%")
    if from_date:
        where_clauses.append("acctstarttime >= %s")
        params.append(from_date)
    if to_date:
        where_clauses.append("acctstarttime <= %s")
        params.append(to_date)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    offset = (page - 1) * per_page

    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(f"SELECT COUNT(*) AS total FROM radacct {where_sql}", params)
            total = (await cur.fetchone())["total"]

            await cur.execute(
                f"""
                SELECT radacctid, acctsessionid, username, realm, nasipaddress,
                       calledstationid, callingstationid, framedipaddress,
                       acctstarttime, acctstoptime, acctsessiontime,
                       acctinputoctets, acctoutputoctets, acctterminatecause
                FROM radacct {where_sql}
                ORDER BY acctstarttime DESC
                LIMIT %s OFFSET %s
                """,
                params + [per_page, offset],
            )
            rows = await cur.fetchall()

    return total, rows


async def get_accounting_all(
    username: Optional[str] = None,
    nas_ip: Optional[str] = None,
    ssid: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
):
    """Generator-friendly: returns all rows matching filters (for CSV export)."""
    _, rows = await get_accounting(
        page=1,
        per_page=100000,
        username=username,
        nas_ip=nas_ip,
        ssid=ssid,
        from_date=from_date,
        to_date=to_date,
    )
    return rows


# ── NAS ───────────────────────────────────────────────────────────────────────

async def get_nas_list() -> list[dict]:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute("SELECT id, nasname, shortname, type, secret, description FROM nas")
            return await cur.fetchall()


async def create_nas(nasname: str, shortname: str, nas_type: str, secret: str, description: Optional[str]) -> int:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "INSERT INTO nas (nasname, shortname, type, secret, description) VALUES (%s, %s, %s, %s, %s)",
                (nasname, shortname, nas_type, secret, description),
            )
            return cur.lastrowid


async def update_nas(nas_id: int, nasname: str, shortname: str, secret: str, description: Optional[str]) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "UPDATE nas SET nasname = %s, shortname = %s, secret = %s, description = %s WHERE id = %s",
                (nasname, shortname, secret, description, nas_id),
            )


async def delete_nas(nas_id: int) -> None:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute("DELETE FROM nas WHERE id = %s", (nas_id,))


# ── dashboard ─────────────────────────────────────────────────────────────────

async def get_dashboard_summary() -> dict:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "SELECT COUNT(*) AS cnt FROM radacct WHERE acctstoptime IS NULL"
            )
            active = (await cur.fetchone())["cnt"]

            await cur.execute(
                "SELECT COUNT(*) AS cnt FROM radpostauth WHERE authdate >= DATE_SUB(NOW(), INTERVAL 1 HOUR)"
            )
            attempts = (await cur.fetchone())["cnt"]

            await cur.execute(
                "SELECT COUNT(*) AS cnt FROM radpostauth "
                "WHERE authdate >= DATE_SUB(NOW(), INTERVAL 1 HOUR) AND reply = 'Access-Reject'"
            )
            failures = (await cur.fetchone())["cnt"]

            await cur.execute(
                "SELECT COUNT(DISTINCT username) AS cnt FROM radcheck "
                "WHERE attribute = 'Auth-Type' AND value = 'Reject'"
            )
            blocked = (await cur.fetchone())["cnt"]

            await cur.execute(
                """
                SELECT username, nasipaddress, calledstationid, acctstarttime,
                       TIMESTAMPDIFF(SECOND, acctstarttime, NOW()) AS duration_seconds
                FROM radacct WHERE acctstoptime IS NULL
                ORDER BY acctstarttime DESC LIMIT 10
                """
            )
            recent = await cur.fetchall()

    return {
        "active_sessions": active,
        "auth_attempts_last_hour": attempts,
        "failed_auths_last_hour": failures,
        "blocked_users": blocked,
        "recent_sessions": recent,
    }


async def get_user_auth_history(username: str) -> list[dict]:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                "SELECT id, username, pass, reply, authdate FROM radpostauth "
                "WHERE username = %s ORDER BY id DESC LIMIT 20",
                (username,),
            )
            return await cur.fetchall()


async def get_user_sessions(username: str) -> list[dict]:
    async with get_conn() as conn:
        async with get_cursor(conn) as cur:
            await cur.execute(
                """
                SELECT radacctid, acctsessionid, nasipaddress, calledstationid,
                       framedipaddress, acctstarttime,
                       TIMESTAMPDIFF(SECOND, acctstarttime, NOW()) AS duration_seconds
                FROM radacct WHERE username = %s AND acctstoptime IS NULL
                """,
                (username,),
            )
            return await cur.fetchall()
