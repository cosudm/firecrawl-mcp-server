// @ts-check
/**
 * Production extraction adapter — Claude (Anthropic Messages API).
 *
 * Drop-in alternative to the offline heuristic extractor: same ExtractionResult
 * contract, so the Review & Confirm UI and the deterministic engine are unchanged.
 * Use this for OCR'd PDFs and free-form deeds where regex heuristics fall short.
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
 *   import { extractWithClaude } from './extractors/claude.mjs';
 *   const result = await extractWithClaude(rawText, { apiKey: process.env.ANTHROPIC_API_KEY });
 *   const project = buildProjectFromExtraction(result); // from ../extraction.mjs
 */

export const DEFAULT_MODEL = 'claude-opus-4-8';

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

/** Tool schema mirrors the ExtractionResult contract in ../extraction.mjs. */
export const EXTRACTION_TOOL = {
  name: 'emit_title_extraction',
  description: 'Return the structured extraction of all title documents found in the text.',
  input_schema: {
    type: 'object',
    required: ['documents', 'parties'],
    properties: {
      parties: {
        type: 'array',
        items: {
          type: 'object', required: ['id', 'name', 'type'],
          properties: {
            id: { type: 'string', description: 'stable lowercase-hyphenated id' },
            name: { type: 'string' },
            type: { type: 'string', enum: ['individual', 'entity'] },
          },
        },
      },
      tract: {
        type: 'object',
        properties: {
          name: { type: 'string' }, grossAcres: { type: 'number' },
          legal: { type: 'string' }, county: { type: 'string' }, state: { type: 'string' },
        },
      },
      rootOwner: { type: 'string', description: 'party id holding 100% minerals at time zero' },
      documents: {
        type: 'array',
        items: {
          type: 'object', required: ['id', 'kind', 'title', 'fields'],
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', enum: ['mineralConveyance', 'oilGasLease', 'assignment', 'orriAssignment', 'affidavitOfHeirship', 'unitDesignation', 'completionReport'] },
            instrument: { type: 'string' },
            kindConfidence: { type: 'number' },
            title: { type: 'string' },
            sourceText: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object', required: ['path', 'label', 'value', 'confidence'],
                properties: {
                  path: { type: 'string', description: 'dot-path into the draft document, e.g. "royalty", "reservation.quantum"' },
                  label: { type: 'string' },
                  value: { description: 'string | number | object as written' },
                  raw: { type: 'string' },
                  snippet: { type: 'string', description: 'verbatim supporting text' },
                  confidence: { type: 'number' },
                  needsDecision: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
      notes: { type: 'array', items: { type: 'string' } },
    },
  },
};

/**
 * Build the user message content. Accepts plain text, a PDF (base64 — Claude reads
 * the document natively, including scanned pages via vision), or both.
 * @param {string|{text?:string, pdfBase64?:string, mediaType?:string}} input
 */
function userContent(input) {
  const inp = typeof input === 'string' ? { text: input } : (input || {});
  /** @type {any[]} */ const blocks = [];
  if (inp.pdfBase64) {
    blocks.push({ type: 'document', source: { type: 'base64', media_type: inp.mediaType || 'application/pdf', data: inp.pdfBase64 } });
  }
  const lead = inp.pdfBase64 ? 'Extract every title instrument from the attached document.' : 'Extract every title instrument from the following records:';
  blocks.push({ type: 'text', text: inp.text ? `${lead}\n\n${inp.text}` : lead });
  return blocks;
}

/**
 * @param {string|{text?:string, pdfBase64?:string, mediaType?:string}} input  Text and/or a base64 PDF.
 * @param {{ apiKey: string, model?: string, fetchImpl?: typeof fetch, maxTokens?: number }} opts
 * @returns {Promise<import('../extraction.mjs').ExtractionResult>}
 */
export async function extractWithClaude(input, opts) {
  const { apiKey, model = DEFAULT_MODEL, fetchImpl = fetch, maxTokens = 8000 } = opts || {};
  if (!apiKey) throw new Error('extractWithClaude: apiKey is required');

  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // Cache the static system prompt + tool schema across documents in a batch.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [{ ...EXTRACTION_TOOL, cache_control: { type: 'ephemeral' } }],
      tool_choice: { type: 'tool', name: EXTRACTION_TOOL.name },
      messages: [{ role: 'user', content: userContent(input) }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const toolUse = (data.content || []).find((b) => b.type === 'tool_use' && b.name === EXTRACTION_TOOL.name);
  if (!toolUse) throw new Error('Model did not return the extraction tool call.');

  const out = toolUse.input;
  // Normalize to the ExtractionResult shape (default field status).
  for (const d of out.documents || [])
    for (const f of d.fields || []) { f.status = f.status || 'pending'; if (f.needsDecision == null) f.needsDecision = f.confidence <= 0.4; }
  return { documents: out.documents || [], parties: out.parties || [], tract: out.tract, rootOwner: out.rootOwner, notes: out.notes || [], engine: 'claude' };
}

export default extractWithClaude;
