"""Deterministic deck hashing for the append-only audit ledger.

The hash must be reproducible from the stored data, so we canonicalize: sorted keys,
no insignificant whitespace, UTF-8. Hash the deck snapshot the landman signed off on
(rows + totals + basis), bound to the project id — exactly like fingerprinting a
filing. Store it in doi_decks.ledger_hash and commit it to your WORM ledger.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def deck_ledger_hash(*, project_id: str, basis: str, rows: list, total_nri: Any, unit_factor: Any = None) -> str:
    """SHA-256 over the canonical deck snapshot. Same inputs → same hash, forever."""
    payload = {
        "projectId": str(project_id),
        "basis": basis,
        "unitFactor": str(unit_factor) if unit_factor is not None else None,
        "totalNri": str(total_nri),
        "rows": rows,
    }
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()
