// lib/persistDeck.js
//
// Forward a serialized deck from the Next analyze route to the FastAPI persistence
// endpoint (api/routers/land.py), instead of writing via Prisma. Use this when you
// want storage + the audit ledger to live in /api. The fold + balance gate still run
// in the Next route (the engine is Node); FastAPI re-checks integrity and writes.
//
// To switch: in app/api/title/analyze/route.js, replace the `prisma.$transaction(...)`
// block with:
//
//   const saved = await persistDeck(deck, { authHeader: request.headers.get('authorization') });
//   return Response.json({ ...saved, deck });

const FASTAPI_BASE = process.env.REPORTER_API_BASE || 'http://localhost:8000';

export async function persistDeck(deck, { authHeader } = {}) {
  const res = await fetch(`${FASTAPI_BASE}/api/land/title`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Forward the caller's credential so FastAPI derives the SAME verified operator.
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    body: JSON.stringify(deck), // exactly the serializeDeck() payload DeckPayload expects
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `Persist failed (${res.status})`);
  return data; // { projectId, deckId, balances }
}

export default persistDeck;
