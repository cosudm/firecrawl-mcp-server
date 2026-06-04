// @ts-check
/**
 * Reporter IOS+ backend route factory for title extraction.
 *
 * Mount behind your existing Firebase-JWT auth + operator-context middleware so
 * the request is already authenticated and tenant-scoped. The model API key is
 * resolved server-side (Secret Manager / env) and never touches the client.
 *
 *   import express from 'express';
 *   import { createTitleExtractHandler } from './integration/backend-route.mjs';
 *   const router = express.Router();
 *   // Anthropic:
 *   router.post('/api/title/extract',
 *     requireAuth, requireOperatorContext,        // your existing middleware
 *     createTitleExtractHandler({ provider: 'claude', getApiKey: () => process.env.ANTHROPIC_API_KEY }));
 *   // Or reuse an existing Gemini key (e.g. Reporter V2.5):
 *   router.post('/api/title/extract',
 *     requireAuth, requireOperatorContext,
 *     createTitleExtractHandler({ provider: 'gemini', getApiKey: () => process.env.GEMINI_API_KEY }));
 *
 * Body: { text?: string, pdfBase64?: string, mediaType?: string }
 * Returns: ExtractionResult (engine/extraction.mjs contract) for the Review UI.
 *
 * Whichever provider is chosen, the model ONLY reads language — every decimal is
 * computed downstream by the deterministic engine, not the LLM.
 *
 * For Cloud Functions / Next.js route handlers / Fastify, the same handler works —
 * it only uses (req.body, res.status().json()). Adapt the signature if needed.
 */
import { extractWithClaude, DEFAULT_MODEL as CLAUDE_MODEL } from '../engine/extractors/claude.mjs';
import { extractWithGemini, DEFAULT_MODEL as GEMINI_MODEL } from '../engine/extractors/gemini.mjs';

const EXTRACTORS = {
  claude: { fn: extractWithClaude, model: CLAUDE_MODEL },
  gemini: { fn: extractWithGemini, model: GEMINI_MODEL },
};

/**
 * @param {{ getApiKey: (req?:any)=>(string|undefined|Promise<string|undefined>), provider?: 'claude'|'gemini', model?: string, maxTokens?: number }} cfg
 */
export function createTitleExtractHandler(cfg) {
  const provider = cfg.provider || process.env.SMEPRO_PROVIDER || 'claude';
  const extractor = EXTRACTORS[provider];
  if (!extractor) throw new Error(`createTitleExtractHandler: unknown provider "${provider}" (use 'claude' or 'gemini').`);
  const model = cfg.model || process.env.SMEPRO_MODEL || extractor.model;
  return async function titleExtractHandler(req, res) {
    try {
      const apiKey = await cfg.getApiKey(req);
      if (!apiKey) return res.status(503).json({ error: 'AI extraction is not configured (no API key).' });

      const { text, pdfBase64, mediaType } = req.body || {};
      if (!text && !pdfBase64) return res.status(400).json({ error: 'Provide { text } or { pdfBase64 }.' });

      const input = pdfBase64 ? { pdfBase64, mediaType, text } : { text };
      const result = await extractor.fn(input, { apiKey, model, maxTokens: cfg.maxTokens });

      // Audit hook (optional): record who extracted what, scoped to the tenant.
      // req.audit?.({ event: 'title.extract', operatorId: req.operatorId, docs: result.documents.length });
      return res.json(result);
    } catch (err) {
      return res.status(502).json({ error: `Extraction failed: ${String(err && err.message || err)}` });
    }
  };
}

export default createTitleExtractHandler;
