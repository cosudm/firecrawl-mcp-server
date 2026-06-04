# DOI Builder → Reporter IOS+ (intelligence sidebar)

Drop-in kit to surface the Title-to-Decimal engine as a panel in the IOS+
intelligence right rail, scoped to the tract/unit/well selected on the map.

```
integration/
  doi-sidebar.mjs    framework-agnostic widget: mountDoiSidebar(el, opts)
  doi-sidebar.css    namespaced styles (.doi-sb — cannot leak into the host)
  backend-route.mjs  createTitleExtractHandler() for POST /api/title/extract
  schema.sql         operator-scoped Postgres tables
  demo.html          standalone proof (map + docked panel)
engine/              the zero-dependency calc + extraction engine (import as-is)
```

## 1. Frontend — mount the widget in the right rail
The widget is plain DOM, so it drops into React/Vue/Angular/anything. React:

```jsx
import { useEffect, useRef } from 'react';
import { mountDoiSidebar } from '@smepro/doi/integration/doi-sidebar.mjs';
import { auth } from '../firebase';

export function TitlePanel({ selected /* {label, sublabel, unitId} from the map */ }) {
  const ref = useRef(null);
  const sb  = useRef(null);

  useEffect(() => {
    sb.current = mountDoiSidebar(ref.current, {
      context: selected,
      // authenticated call to YOUR backend — key stays server-side:
      extract: async (payload) => {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/api/title/extract', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json()).error || res.statusText);
        return res.json();
      },
      onDeckBuilt: (analysis, project) => saveTitleProject({ project, analysis, unitId: selected?.unitId }),
    });
    return () => sb.current.destroy();
  }, []);

  // map selection changes → rescope the panel
  useEffect(() => { sb.current?.setContext(selected); }, [selected]);

  return <div ref={ref} style={{ height: '100%' }} />;
}
```

Also load `doi-sidebar.css` once (import or `<link>`). Widget API:
`setContext(ctx)`, `loadProject(project)`, `getResult()`, `destroy()`.

## 2. Backend — one authenticated route
```js
import { createTitleExtractHandler } from '@smepro/doi/integration/backend-route.mjs';
router.post('/api/title/extract',
  requireAuth, requireOperatorContext,           // your existing middleware
  express.json({ limit: '32mb' }),               // PDFs are base64
  createTitleExtractHandler({ getApiKey: () => process.env.ANTHROPIC_API_KEY }));
```
- The Anthropic key is read from your Secret Manager / env — **never** sent to the client. (This is why moving here removes the local-key headaches.)
- `extractWithClaude` already accepts a base64 PDF and reads it natively (incl. scanned pages), so the same route handles text and PDF.

## 3. Persistence + compliance
- Run `schema.sql` as a migration (operator-scoped tables + optional RLS).
- In `onDeckBuilt`, store `project` (source of truth) and the computed deck; the
  deck is always re-derivable by re-running `analyzeTitleProject(project)`.
- **Gate:** make `analysis.doi.balances === true` a check in your "Yellow Brick
  Road" pipeline before a deck can be approved/disbursed.
- **Audit:** on landman sign-off, hash the deck (SHA-256) and commit it to your
  append-only ledger, exactly like a filing — `doi_decks.ledger_hash`.
- Source PDFs: store bytes in your private GCS bucket; keep only the object path
  + serve via your existing 15-min signed URLs.

## 4. Map integration (the contextual hook)
On a tract/unit/well click, pass `{ label, sublabel, unitId }` to `setContext`.
Load an existing saved deck with `loadProject(project)` so the panel opens on the
DOI tab for that unit. Production volume × the NRI decimal = owner revenue
allocation — the natural tie-in to Reporter's production reporting.

## Notes
- The engine has **zero runtime dependencies** and is pure ES modules — no build
  step required to consume it server-side or in the bundler you already use.
- All title math is deterministic and lives in `engine/` (decks sum to exactly
  `1.00000000`). The widget/host never compute decimals.
- `npm test` (26 tests) covers the engine, extraction round-trip, the Claude
  adapter (mocked), and the server route.
