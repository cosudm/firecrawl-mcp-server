"""Land / Title persistence router (Reporter V2.5 FastAPI backend).

Mount in your app:

    from fastapi import FastAPI
    from .routers import land
    app.include_router(land.router)

Design: the DETERMINISTIC fold + balance gate happen in the Next analyze route (the
engine is Node). This router OWNS storage + the audit ledger. It does NOT redo title
math — it trusts the `balances` flag computed upstream but defends in depth with a
cheap arithmetic re-check (total closes to 1, and rows sum within the disclosed
rounding tolerance) before writing anything authoritative.
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..audit import deck_ledger_hash
from ..deps import Operator, get_db, get_operator
from ..models import DoiCurative, DoiDeck, TitleProject
from ..schemas import ApproveRequest, ApproveResult, DeckPayload, SaveResult

router = APIRouter(prefix="/api/land/title", tags=["land", "title"])

_ONE = Decimal("1")
_ROW_TOLERANCE = Decimal("0.00000001")  # round-half-up disclosure: ±1e-8 per owner


def _verify_integrity(payload: DeckPayload) -> None:
    """Cheap, engine-free defense in depth. The authoritative check already ran in Node."""
    if not payload.balances:
        raise HTTPException(status_code=409, detail="Deck does not balance to 1.00000000; cannot persist.")
    # Tract-basis total is exact (12-place) from the engine — must be exactly 1.
    if payload.totalNri is not None and payload.totalNri != _ONE:
        raise HTTPException(
            status_code=409,
            detail=f"totalNri is {payload.totalNri}, expected 1.000000000000.",
        )
    # Rows are displayed at 8 places (round-half-up), so allow ±1e-8 per owner.
    nri_values = [r.nri for r in payload.rows if r.nri is not None]
    if nri_values:
        row_sum = sum(nri_values, Decimal(0))
        if abs(row_sum - _ONE) > _ROW_TOLERANCE * max(len(nri_values), 1):
            raise HTTPException(status_code=409, detail=f"Row NRI sum {row_sum} is outside rounding tolerance of 1.0.")


@router.post("", response_model=SaveResult, status_code=201)
async def save_title(
    payload: DeckPayload,
    op: Operator = Depends(get_operator),
    db: AsyncSession = Depends(get_db),
) -> SaveResult:
    """Persist a confirmed project + its computed deck + curative items, atomically."""
    _verify_integrity(payload)

    project = TitleProject(
        operator_id=op.operator_id,
        name=payload.project.get("name", "Title Project"),
        tract=payload.tract or payload.project.get("tract") or {},
        unit_id=payload.unitId,
        project=payload.project,
        balances=payload.balances,
        created_by=op.user_id,
    )
    db.add(project)
    await db.flush()  # assigns project.id within the transaction

    deck = DoiDeck(
        operator_id=op.operator_id,
        project_id=project.id,
        basis=payload.basis,
        unit_factor=payload.unitFactor,
        rows=[r.model_dump(mode="json") for r in payload.rows],
        total_nri=payload.totalNri if payload.totalNri is not None else Decimal(0),
        balances=payload.balances,
    )
    db.add(deck)

    for c in payload.curative:
        db.add(
            DoiCurative(
                operator_id=op.operator_id,
                project_id=project.id,
                code=c.code,
                severity=c.severity,
                title=c.title,
                detail=c.detail,
            )
        )

    await db.commit()
    return SaveResult(projectId=str(project.id), deckId=str(deck.id), balances=payload.balances)


@router.get("/{project_id}")
async def get_title(
    project_id: str,
    op: Operator = Depends(get_operator),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Fetch a project with its latest deck + open curative, scoped to the tenant."""
    project = await db.get(TitleProject, project_id)
    if project is None or project.operator_id != op.operator_id:
        raise HTTPException(status_code=404, detail="Title project not found.")

    decks = (
        await db.execute(
            select(DoiDeck)
            .where(DoiDeck.project_id == project.id, DoiDeck.operator_id == op.operator_id)
            .order_by(DoiDeck.created_at.desc())
        )
    ).scalars().all()
    curative = (
        await db.execute(
            select(DoiCurative).where(
                DoiCurative.project_id == project.id, DoiCurative.operator_id == op.operator_id
            )
        )
    ).scalars().all()

    latest = decks[0] if decks else None
    return {
        "projectId": str(project.id),
        "name": project.name,
        "unitId": project.unit_id,
        "balances": project.balances,
        "project": project.project,
        "deck": None
        if latest is None
        else {
            "deckId": str(latest.id),
            "basis": latest.basis,
            "unitFactor": str(latest.unit_factor) if latest.unit_factor is not None else None,
            "totalNri": str(latest.total_nri),
            "balances": latest.balances,
            "rows": latest.rows,
            "approvedBy": latest.approved_by,
            "ledgerHash": latest.ledger_hash,
        },
        "curative": [
            {"id": str(c.id), "code": c.code, "severity": c.severity, "title": c.title, "status": c.status}
            for c in curative
        ],
    }


@router.post("/decks/{deck_id}/approve", response_model=ApproveResult)
async def approve_deck(
    deck_id: str,
    body: ApproveRequest,  # noqa: ARG001 — reserved for an approval note
    op: Operator = Depends(get_operator),
    db: AsyncSession = Depends(get_db),
) -> ApproveResult:
    """Landman sign-off: gate on balance, stamp approver, and write the ledger hash."""
    deck = await db.get(DoiDeck, deck_id)
    if deck is None or deck.operator_id != op.operator_id:
        raise HTTPException(status_code=404, detail="Deck not found.")
    if not deck.balances:
        raise HTTPException(status_code=409, detail="Cannot approve an unbalanced deck.")

    ledger_hash = deck_ledger_hash(
        project_id=str(deck.project_id),
        basis=deck.basis,
        rows=deck.rows,
        total_nri=deck.total_nri,
        unit_factor=deck.unit_factor,
    )
    deck.approved_by = op.user_id or op.operator_id
    deck.ledger_hash = ledger_hash
    from sqlalchemy import func

    deck.approved_at = func.now()
    await db.commit()
    # TODO: also append (deck_id, ledger_hash, approved_by, ts) to your WORM ledger here.
    return ApproveResult(deckId=str(deck.id), approvedBy=deck.approved_by, ledgerHash=ledger_hash)
