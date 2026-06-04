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
If you'd rather keep writes in `/api` (e.g. a `routers/land.py` endpoint), keep the
**fold + gate in the Next analyze route** (the engine is Node) and have it forward the
serialized deck to FastAPI for the DB write. FastAPI can cheaply re-check integrity
without the engine — verify `sum(row.nri) == 1` and `balances is true` — then write via
your Python DB layer. The deterministic computation stays in one place (Node); Python
owns storage + the audit ledger. Ask and I'll generate the `land.py` router + the
forwarding glue.

## Audit / compliance hooks (when you're ready)
- On landman sign-off, SHA-256 the deck and write it to `doi_decks.ledger_hash` →
  your append-only ledger, exactly like a filing.
- Store source PDF bytes in your private GCS bucket; keep only the object path in
  `title_source_files` and serve via your existing 15-min signed URLs.
