# SMEPro · DOI Builder (v0 MVP)

Turns historical oil-&-gas title records into a **Division of Interest (DOI) deck** —
the Net Revenue Interest (NRI) decimal for every stakeholder — and surfaces the
title defects a landman must cure. Built so a non-expert can drive it, with
exact math an SME can trust.

> Title-examination work product for landman/analyst review. **Not a title
> opinion or legal advice.**

---

## How to open the UI

### Option A — zero install (anyone) ✅
Open the prebuilt single file in any modern browser:

```
smepro-doi/dist/smepro-doi.html
```

Double-click it, or drag it into a browser tab. No server, no Node, no network —
it works offline and contains the whole app (engine + UI + the Benton/Morales
sample case).

### Option B — dev server (for editing)
```bash
cd smepro-doi
npm run serve        # → http://localhost:5173
```
Edit anything under `engine/` or `web/`; refresh the browser.

### Rebuild the single file after changes
```bash
npm run build        # regenerates dist/smepro-doi.html
```

---

## What's inside

| Path | Purpose |
|------|---------|
| `engine/fraction.mjs` | Exact BigInt rational arithmetic — the deck sums to **exactly** 1.00000000, never a floating-point smudge. |
| `engine/schema.mjs` | The typed **Title Project** data model (the contract the UI and future extraction bind to). |
| `engine/engine.mjs` | Deterministic chronological fold → ownership ledgers → DOI deck → curative defect rules. **All math lives here; the UI does none.** |
| `engine/extraction.mjs` | **Import pipeline:** offline heuristic extractor (raw text → draft schema with per-field source snippet + confidence) and `buildProjectFromExtraction()`. |
| `engine/extractors/claude.mjs` | **Production extraction adapter** — Claude Messages API with schema-constrained tool use + prompt caching. Same `ExtractionResult` contract as the heuristic; use for OCR'd PDFs / free-form deeds. Runs server-side (never ship the key to the browser). |
| `engine/cases/benton-morales.mjs` | The seed case (the 8 supplied instruments). |
| `engine/cases/benton-morales-source.mjs` | Raw-text version of the case, used to exercise the extractor and prefill Intake. |
| `engine/cli.mjs` | `npm run report` — prints the 5-step analysis in the terminal. |
| `web/` | Light-only, SMEPro-branded UI (design tokens in `web/styles.css`). |
| `build.mjs` | Inlines the tested engine + UI into one portable HTML file. |
| `test/` | `npm test` — proves the deck balances and reproduces the approved decimals. |

## Verify it
```bash
cd smepro-doi
npm test             # 10 tests: exact-math + Benton/Morales balance & curative
npm run report       # text version of Steps 4 & 5
```

## Design / branding
- **Official SMEPro brand system** (`web/styles.css`): the `#003070` navy palette,
  Fluent depth shadows, Segoe UI / Inter + Cascadia Code typography, and the
  4-quadrant brand mark (IOS+ · Yellow Brick Road · Universal Decoding Matrix ·
  Compliance OS) rendered as inline SVG in `web/index.html`.
- **Light-only working surfaces.** Every data/content surface is white or pale
  slate (`#F5F7FA`). The only deep-navy bands are the thin top utility strip and
  the footer — official SMEPro site chrome, not working surfaces. To make the
  chrome fully light too, flip `--utility-bg` / `--footer-accent` to a light token.
- Brand tokens live under `:root` in `web/styles.css`; the whole UI re-skins from
  there.

## Import workflow (v1)
**Intake & Extract** (left nav) → paste/load title text → **Extract** runs the
heuristic extractor → **Review & Confirm** shows every field with its source
snippet + confidence, with SME judgment calls (NPRI fixed-vs-floating, heirship
math, community characterization) flagged amber for a human decision → **Build
DOI Analysis** assembles the confirmed fields into a Title Project and runs the
engine. Nothing leaves the browser in heuristic mode.

To use the LLM extractor in a deployment, call `extractWithClaude()` from a
backend and feed its `ExtractionResult` into the same Review UI:
```js
import { extractWithClaude } from './engine/extractors/claude.mjs';
import { buildProjectFromExtraction } from './engine/extraction.mjs';
const result  = await extractWithClaude(rawText, { apiKey: process.env.ANTHROPIC_API_KEY });
const project = buildProjectFromExtraction(result); // after human confirmation
```

## Roadmap (next)
- **v1.1:** wire the Claude adapter behind a backend; PDF/OCR upload (pdf.js);
  rich editors for object fields (heir splits, ORRI carve-outs).
- **v2:** multi-tract / full-unit roll-ups, county-records ingestion, production
  & revenue overlay, attorney sign-off + certified export.
