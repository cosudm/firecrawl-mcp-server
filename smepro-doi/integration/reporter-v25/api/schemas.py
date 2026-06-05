"""Pydantic v2 request/response models for the DOI persistence endpoints.

The DeckPayload shape is exactly what integration/serialize.mjs emits, so the Next
analyze route can forward its serialized deck verbatim. Decimals arrive as strings to
stay lossless; Pydantic parses them into Decimal.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field


class DeckRow(BaseModel):
    owner: str
    partyId: str | None = None
    type: str
    fractionLabel: str | None = None
    nri: Decimal | None = None        # tract-basis NRI (closes to 1.00000000)
    unitNri: Decimal | None = None    # unit-basis NRI (× participation factor)
    source: str | None = None


class CurativeItem(BaseModel):
    code: str
    severity: str
    title: str
    detail: str


class DeckPayload(BaseModel):
    """The serializeDeck() output forwarded from the Next analyze route."""

    project: dict[str, Any]                       # source of truth (engine input)
    unitId: str | None = None
    tract: dict[str, Any] | None = None
    basis: str = "tract"
    unitFactor: Decimal | None = None
    rows: list[DeckRow]
    totalNri: Decimal | None = None               # tract basis: 1.000000000000
    balances: bool
    summary: dict[str, Any] | None = None
    curative: list[CurativeItem] = Field(default_factory=list)


class SaveResult(BaseModel):
    projectId: str
    deckId: str
    balances: bool


class ApproveRequest(BaseModel):
    # operator/user come from the verified session, never the body.
    note: str | None = None


class ApproveResult(BaseModel):
    deckId: str
    approvedBy: str
    ledgerHash: str
