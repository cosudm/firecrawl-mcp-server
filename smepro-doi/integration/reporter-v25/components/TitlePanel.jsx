'use client';
// components/TitlePanel.jsx
//
// Reporter V2.5 — mounts the DOI intelligence sidebar in the right rail and binds
// it to the map. Pass the current map selection in via `selected`; on save it POSTs
// the confirmed TitleProject to /api/title/analyze, where the SERVER re-runs the
// deterministic engine (the client-side deck is never trusted for persistence).
//
// Usage in your dashboard (page.js), driven by the same polygon selection you
// already feed the insights pipeline:
//
//   import { TitlePanel } from '@/components/TitlePanel';
//   <TitlePanel selected={selectedFeature && {
//     label:    selectedFeature.name,        // e.g. "Section 14, Block A"
//     sublabel: selectedFeature.county,
//     unitId:   selectedFeature.unitId,
//   }} />
//
// Also import the widget CSS once (e.g. in app/layout.js):
//   import '@smepro/doi/integration/doi-sidebar.css';

import { useEffect, useRef } from 'react';
import { mountDoiSidebar } from '@smepro/doi/integration/doi-sidebar.mjs';

export function TitlePanel({ selected, onSaved }) {
  const ref = useRef(null);
  const sb = useRef(null);
  const sel = useRef(selected);
  sel.current = selected; // keep latest selection for the save closure

  useEffect(() => {
    sb.current = mountDoiSidebar(ref.current, {
      context: sel.current,

      // Extraction → your authenticated Next route (Gemini key stays server-side).
      extract: async (payload) => {
        const res = await fetch('/api/title/extract', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include', // send the session cookie your auth uses
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
        return res.json();
      },

      // Save → POST the PROJECT only; the server re-analyzes authoritatively and
      // enforces the balance gate before persisting.
      onDeckBuilt: async (_analysis, project) => {
        const res = await fetch('/api/title/analyze', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project, unitId: sel.current?.unitId ?? null }),
          credentials: 'include',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || res.statusText);
        onSaved?.(data); // { projectId, deckId, deck }
      },
    });
    return () => sb.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Map selection changes → rescope the panel to the clicked tract/unit/well.
  useEffect(() => { sb.current?.setContext(selected); }, [selected]);

  return <div ref={ref} style={{ height: '100%' }} />;
}

export default TitlePanel;
