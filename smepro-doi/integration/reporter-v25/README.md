# DOI → Reporter V2.5 (Next.js 16 App Router + Prisma)

Paste-ready wiring for the Reporter V2.5 stack, in the order to build it. Everything
here imports the kit as `@smepro/doi/*` — add the dependency (or a path alias to the
`smepro-doi/` folder) and you're consuming the same zero-dependency engine the tests
cover.

```
reporter-v25/
  prisma-doi.prisma                       1. data model → paste into prisma/schema.prisma
  app/api/title/extract/route.js          3. Gemini extraction (multipart or JSON)
  app/api/title/analyze/route.js          4. deterministic fold + balance gate + persist
  components/TitlePanel.jsx               5. right-rail widget, bound to the map
  lib/prisma.js                           Prisma client singleton (or reuse yours)
  lib/operator.js                         auth/tenant seam — WIRE THIS to your session
```
(2. is the serializer, `integration/serialize.mjs`, shared by the kit.)

## Build order

### 1. Data model
Paste the models from `prisma-doi.prisma` into your existing `prisma/schema.prisma`
(reuse the datasource/generator already there), then:
```bash
npx prisma migrate dev --name doi_title_engine
npx prisma generate
```
Tables map to the same snake_case names as `integration/schema.sql`.

### 2. Wire the auth seam
Open `lib/operator.js` and replace the placeholder with Reporter's real session
verification — the same guard `/api/insights` and `/api/parse-document` use. It must
return a verified `operatorId` (the tenant key). **Never** trust an operatorId from
the client. Until this is wired, the routes are not safe to expose.

### 3 & 4. Drop in the two routes
`app/api/title/extract/route.js` and `app/api/title/analyze/route.js` go straight
under your App Router. Set `GEMINI_API_KEY` (already in your env) in the server
runtime. Extraction reuses that key server-side; **decimals are computed only in the
analyze route by the deterministic engine**, never by the model.

### 5. Mount the panel
Import `doi-sidebar.css` once in `app/layout.js`, then render `<TitlePanel />` in the
intelligence right rail, fed by the same polygon selection you pass the insights
pipeline in `page.js`. On a tract/unit/well click, the panel rescopes; on save it
POSTs the confirmed project and the server returns the persisted, balanced deck.

## The data flow (and where the trust boundary sits)
```
upload ─► /api/title/extract ─► Gemini reads doc ─► ExtractionResult (drafts + confidence)
                                                         │  human confirms/edits in the widget
confirmed project ─► /api/title/analyze ─► analyzeTitleProject() ─► deck (sums to 1.00000000)
                                           │  balances===true gate
                                           └─► Prisma: title_projects + doi_decks + doi_curative
```
- The client widget computes a preview deck for display, but **persistence re-runs the
  engine server-side** from the project JSON — the client deck is never stored.
- `requireBalanced` (default true) makes `/api/title/analyze` return `409` if the deck
  doesn't close to exactly `1.00000000`. Treat that as a hard gate in the "Yellow Brick
  Road" pipeline before a deck can be approved/disbursed.

## Alternative: persist in FastAPI instead of the Next route
A complete FastAPI backend is included under `api/` if you'd rather keep writes in
`/api`. The **fold + balance gate stay in the Next analyze route** (the engine is
Node); FastAPI owns storage + the audit ledger and re-checks integrity without the
engine.

```
api/
  models.py          SQLAlchemy models (same tables as schema.sql / the Prisma model)
  schemas.py         Pydantic v2 — DeckPayload == the serializeDeck() output
  deps.py            get_db + get_operator SEAMS (wire to your engine + session auth)
  audit.py           deterministic SHA-256 ledger hash (canonical JSON)
  routers/land.py    POST /api/land/title · GET /…/{id} · POST /…/decks/{id}/approve
```

Mount it:
```python
from .routers import land
app.include_router(land.router)
```

To switch the Next route from Prisma to forwarding, replace the `prisma.$transaction`
block in `app/api/title/analyze/route.js` with `lib/persistDeck.js`:
```js
import { persistDeck } from '../../../../lib/persistDeck';
const saved = await persistDeck(deck, { authHeader: request.headers.get('authorization') });
return Response.json({ ...saved, deck });
```
`persistDeck` POSTs the serialized deck verbatim (it matches `DeckPayload`) to
`REPORTER_API_BASE/api/land/title`, forwarding the caller's credential so FastAPI
derives the **same** verified operator. Integrity defense-in-depth in `land.py`:
`balances is true`, `totalNri == 1.000000000000` (exact), and the displayed rows sum
to 1 within the disclosed ±1e-8/owner rounding tolerance — else `409`, no write.

`POST /api/land/title/decks/{id}/approve` is the landman sign-off: it gates on balance,
stamps the approver, and writes a reproducible `ledger_hash` over the canonical deck
snapshot (drop your WORM-ledger append where the `TODO` marks it).

> Pick **one** persistence path — Prisma (default) *or* FastAPI — not both, so there's
> a single writer per deck.

## Audit / compliance hooks (when you're ready)
- On landman sign-off, SHA-256 the deck and write it to `doi_decks.ledger_hash` →
  your append-only ledger, exactly like a filing.
- Store source PDF bytes in your private GCS bucket; keep only the object path in
  `title_source_files` and serve via your existing 15-min signed URLs.
