"""DB session + auth/tenant dependencies.

SEAMS — replace both with Reporter V2.5's existing wiring:
  * get_db        → reuse your app's async sessionmaker (don't open a second engine).
  * get_operator  → reuse the SAME session verification /api/insights uses; it MUST
                    return a verified operator_id. Never trust an operator id from the
                    request body or an unverified header.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import AsyncIterator

from fastapi import Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# --- DB session (example; prefer reusing Reporter's engine/sessionmaker) -------------
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://localhost/reporter")
_engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
_SessionLocal = async_sessionmaker(_engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with _SessionLocal() as session:
        yield session


# --- Operator context (TENANT KEY) ---------------------------------------------------
@dataclass
class Operator:
    operator_id: str
    user_id: str | None = None


async def get_operator(
    # TEMPORARY placeholder transport — swap for your verified session/token.
    x_operator_id: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> Operator:
    # EXAMPLE — wire to real auth, e.g.:
    #   claims = await verify_session(request)            # your existing verifier
    #   return Operator(operator_id=claims.operator_id, user_id=claims.uid)
    if not x_operator_id:
        raise HTTPException(status_code=401, detail="Unauthenticated or missing operator context.")
    return Operator(operator_id=x_operator_id, user_id=x_user_id)
