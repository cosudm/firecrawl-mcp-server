// @ts-check
/**
 * Production extraction adapter — Gemini (Google Generative Language API).
 *
 * Drop-in alternative to the Claude adapter and the offline heuristic extractor:
 * it emits the SAME ExtractionResult contract, so the Review & Confirm UI and the
 * deterministic engine are unchanged whichever extractor you wire in. Use this to
 * reuse an existing GEMINI_API_KEY (e.g. Reporter V2.5 already runs gemini-2.5-flash)
 * without adding an Anthropic dependency.
 *
 * The model ONLY reads language and emits structured fields with a source snippet
 * and a confidence per field; it does NO title math (the engine does that). It is
 * instructed to flag genuine judgment calls (NPRI fixed-vs-floating, heirship
 * intestacy, community characterization) at low confidence with needsDecision=true.
 *
 * Runs server-side (Node) or in any environment with `fetch`. Never ship an API
 * key to the browser — call this from a backend the web app talks to.
 *
 * @example
 *   import { extractWithGemini } from './extractors/gemini.mjs';
 *   const result = await extractWithGemini(rawText, { apiKey: process.env.GEMINI_API_KEY });
 *   const project = buildProjectFromExtraction(result); // from ../extraction.mjs
 */

export const DEFAULT_MODEL = 'gemini-2.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = `You are a senior oil & gas title analyst extracting structured data from raw title records (deeds, oil & gas leases, assignments, affidavits of heirship, unit designations, completion reports).

Rules:
- Extract ONLY what the text supports. Do not infer decimals or compute interests — a deterministic engine does all math downstream.
- For every field, copy the shortest verbatim "snippet" from the source that supports it, and assign a calibrated "confidence" in [0,1].
- Use exact notation as written ("1/4", "0.25", "1/5", "50%"); never convert or normalize fractions.
- Flag genuine title judgment calls with needsDecision=true and confidence <= 0.4. These ALWAYS qualify:
  * NPRI reserved as a bare fraction ("1/4 royalty") where fixed-of-8/8 vs. fraction-of-royalty is ambiguous.
  * Heirship distributions where intestacy/community-property math is required.
  * Community vs. separate property characterization.
- Classify each document's "kind" as one of: mineralConveyance, oilGasLease, assignment, orriAssignment, affidavitOfHeirship, unitDesignation, completionReport.
- Return parties once each with a stable lowercase-hyphenated id reused across documents.`;

/**
 * Gemini has no schema-constrained tool_use with union-typed values, so we pin
 * the output with responseMimeType=application/json and describe the exact shape.
 * `value` may be a string, number, array, or object exactly as the deed reads.
 */
const JSON_SHAPE = `Return ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "parties": [{ "id": "lowercase-hyphenated", "name": "string", "type": "individual" | "entity" }],
  "tract": { "name": "string", "grossAcres": number, "legal": "string", "county": "string", "state": "string" },
  "rootOwner": "party id holding 100% minerals at time zero",
  "documents": [{
    "id": "string",
    "kind": "mineralConveyance" | "oilGasLease" | "assignment" | "orriAssignment" | "affidavitOfHeirship" | "unitDesignation" | "completionReport",
    "instrument": "string",
    "kindConfidence": number,
    "title": "string",
    "sourceText": "string",
    "fields": [{
      "path": "dot-path into the draft document, e.g. \\"royalty\\", \\"reservation.quantum\\"",
      "label": "string",
      "value": "string | number | array | object, exactly as written",
      "raw": "string",
      "snippet": "verbatim supporting text",
      "confidence": number,
      "needsDecision": boolean
    }]
  }],
  "notes": ["string"]
}`;

/**
 * Build the user message parts. Accepts plain text, a PDF (base64 — Gemini reads
 * the document natively, including scanned pages via vision), or both.
 * @param {string|{text?:string, pdfBase64?:string, mediaType?:string}} input
 */
function userParts(input) {
  const inp = typeof input === 'string' ? { text: input } : (input || {});
  /** @type {any[]} */ const parts = [];
  if (inp.pdfBase64) {
    parts.push({ inlineData: { mimeType: inp.mediaType || 'application/pdf', data: inp.pdfBase64 } });
  }
  const lead = inp.pdfBase64 ? 'Extract every title instrument from the attached document.' : 'Extract every title instrument from the following records:';
  parts.push({ text: inp.text ? `${lead}\n\n${inp.text}` : lead });
  return parts;
}

/** Concatenate the text parts of the first candidate. */
function candidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

/** Tolerantly parse a JSON object, stripping any stray ```json fences. */
function parseJsonObject(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{'); const e = t.lastIndexOf('}');
    if (s !== -1 && e > s) return JSON.parse(t.slice(s, e + 1));
    throw new Error('Gemini did not return parseable JSON.');
  }
}

/**
 * @param {string|{text?:string, pdfBase64?:string, mediaType?:string}} input  Text and/or a base64 PDF.
 * @param {{ apiKey: string, model?: string, fetchImpl?: typeof fetch, maxTokens?: number }} opts
 * @returns {Promise<import('../extraction.mjs').ExtractionResult>}
 */
export async function extractWithGemini(input, opts) {
  const { apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, maxTokens = 8000 } = opts || {};
  if (!apiKey) throw new Error('extractWithGemini: apiKey is required');

  const res = await fetchImpl(`${API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${JSON_SHAPE}` }] },
      contents: [{ role: 'user', parts: userParts(input) }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: maxTokens },
    }),
  });

  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = candidateText(data);
  if (!text) throw new Error('Gemini returned an empty response.');
  const out = parseJsonObject(text);

  // Normalize to the ExtractionResult shape (default field status / needsDecision).
  for (const d of out.documents || [])
    for (const f of d.fields || []) { f.status = f.status || 'pending'; if (f.needsDecision == null) f.needsDecision = f.confidence <= 0.4; }
  return { documents: out.documents || [], parties: out.parties || [], tract: out.tract, rootOwner: out.rootOwner, notes: out.notes || [], engine: 'gemini' };
}

export default extractWithGemini;
