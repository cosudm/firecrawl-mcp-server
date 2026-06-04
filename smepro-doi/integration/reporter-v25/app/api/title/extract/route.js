// app/api/title/extract/route.js
//
// Reporter V2.5 — Title document extraction (Next.js App Router).
// Mirrors the existing /api/parse-document route: accepts a multipart file upload
// OR a JSON body, hands the bytes to the Gemini extractor, and returns the
// ExtractionResult contract for the Review & Confirm UI. The model only READS the
// document; every decimal is computed later by the deterministic engine.
//
// Reuses your existing GEMINI_API_KEY — the key never reaches the browser.

import { extractWithGemini } from '@smepro/doi/engine/extractors/gemini.mjs';
import { requireOperator } from '../../../../lib/operator';

// Gemini reads PDFs natively; no Node APIs needed beyond fetch. Run on Node runtime
// (not edge) so large base64 bodies and the streamed file read are comfortable.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request) {
  // 1. Authn/z — reuse your session + operator-context guard (see lib/operator.js).
  const ctx = await requireOperator(request);
  if (!ctx.ok) return Response.json({ error: ctx.error }, { status: ctx.status });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: 'AI extraction is not configured (no GEMINI_API_KEY).' }, { status: 503 });

  // 2. Accept either a multipart upload (like /api/parse-document) or JSON.
  let input;
  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      const text = form.get('text');
      if (file && typeof file !== 'string') {
        const buf = Buffer.from(await file.arrayBuffer());
        input = { pdfBase64: buf.toString('base64'), mediaType: file.type || 'application/pdf', text: text || undefined };
      } else if (text) {
        input = { text: String(text) };
      }
    } else {
      const { text, pdfBase64, mediaType } = await request.json();
      if (pdfBase64) input = { pdfBase64, mediaType, text };
      else if (text) input = { text };
    }
  } catch {
    return Response.json({ error: 'Could not read the request body.' }, { status: 400 });
  }
  if (!input) return Response.json({ error: 'Provide a file, { pdfBase64 }, or { text }.' }, { status: 400 });

  // 3. Extract. The Gemini model returns drafted fields with per-field confidence
  //    and verbatim source snippets — never computed interests.
  try {
    const result = await extractWithGemini(input, {
      apiKey,
      model: process.env.SMEPRO_MODEL || 'gemini-2.5-flash',
    });
    // Optional: audit who extracted what, scoped to the tenant.
    // await audit({ event: 'title.extract', operatorId: ctx.operatorId, docs: result.documents.length });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: `Extraction failed: ${err?.message || err}` }, { status: 502 });
  }
}
