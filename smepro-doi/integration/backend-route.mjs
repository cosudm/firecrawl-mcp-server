// @ts-check
/**
 * Reporter IOS+ backend route factory for title extraction.
 *
 * Mount behind your existing Firebase-JWT auth + operator-context middleware so
 * the request is already authenticated and tenant-scoped. The Anthropic key is
 * resolved server-side (Secret Manager / env) and never touches the client.
 *
 *   import express from 'express';
 *   import { createTitleExtractHandler } from './integration/backend-route.mjs';
 *   const router = express.Router();
 *   router.post('/api/title/extract',
 *     requireAuth, requireOperatorContext,        // your existing middleware
 *     createTitleExtractHandler({ getApiKey: () => process.env.ANTHROPIC_API_KEY }));
 *
 * Body: { text?: string, pdfBase64?: string, mediaType?: string }
 * Returns: ExtractionResult (engine/extraction.mjs contract) for the Review UI.
 *
 * For Cloud Functions / Fastify, the same handler works — it only uses
 * (req.body, res.status().json()). Adapt the signature if your runtime differs.
 */
import { extractWithClaude, DEFAULT_MODEL } from '../engine/extractors/claude.mjs';

/**
 * @param {{ getApiKey: (req?:any)=>(string|undefined|Promise<string|undefined>), model?: string, maxTokens?: number }} cfg
 */
export function createTitleExtractHandler(cfg) {
  const model = cfg.model || process.env.SMEPRO_MODEL || DEFAULT_MODEL;
  return async function titleExtractHandler(req, res) {
    try {
      const apiKey = await cfg.getApiKey(req);
      if (!apiKey) return res.status(503).json({ error: 'AI extraction is not configured (no API key).' });

      const { text, pdfBase64, mediaType } = req.body || {};
      if (!text && !pdfBase64) return res.status(400).json({ error: 'Provide { text } or { pdfBase64 }.' });

      const input = pdfBase64 ? { pdfBase64, mediaType, text } : { text };
      const result = await extractWithClaude(input, { apiKey, model, maxTokens: cfg.maxTokens });

      // Audit hook (optional): record who extracted what, scoped to the tenant.
      // req.audit?.({ event: 'title.extract', operatorId: req.operatorId, docs: result.documents.length });
      return res.json(result);
    } catch (err) {
      return res.status(502).json({ error: `Extraction failed: ${String(err && err.message || err)}` });
    }
  };
}

export default createTitleExtractHandler;
