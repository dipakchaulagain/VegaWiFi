from contextlib import asynccontextmanager
from typing import AsyncGenerator
import aiomysql
from backend.config import get_settings

_pool: aiomysql.Pool | None = None


async def init_pool() -> None:
    global _pool
    s = get_settings()
    _pool = await aiomysql.create_pool(
        host=s.DB_HOST,
        port=s.DB_PORT,
        db=s.DB_NAME,
        user=s.DB_USER,
        password=s.DB_PASS,
        minsize=2,
        maxsize=20,
        autocommit=True,
        charset="utf8mb4",
    )


async def close_pool() -> None:
    global _pool
    if _pool:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


@asynccontextmanager
async def get_conn() -> AsyncGenerator[aiomysql.Connection, None]:
    assert _pool is not None, "DB pool not initialised"
    async with _pool.acquire() as conn:
        yield conn


@asynccontextmanager
async def get_cursor(conn: aiomysql.Connection) -> AsyncGenerator[aiomysql.Cursor, None]:
    async with conn.cursor(aiomysql.DictCursor) as cur:
        yield cur
