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
| `engine/cases/benton-morales.mjs` | The seed case (the 8 supplied instruments). |
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

## Design / branding notes
- **Strictly light.** There is no dark theme and no dark surface; the darkest
  background token is a pale slate. This is enforced in `web/styles.css`.
- The header logo and the `--brand-*` tokens in `web/styles.css` are
  **placeholders** — drop in the official SMEPro logo file and palette hexes and
  the whole UI re-skins.

## Roadmap (next)
- **v1:** document upload → LLM extraction writing to the Title Project schema
  (confirm-as-you-go), so users stop hand-entering interests.
- **v2:** multi-tract / full-unit roll-ups, county-records ingestion, production
  & revenue overlay, attorney sign-off + certified export.
