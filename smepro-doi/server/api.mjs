// @ts-check
/**
 * SMEPro DOI Builder — extraction backend.
 *
 * Serves the web app AND the extraction API from one origin (so the browser calls
 * `/api/extract` with no CORS and no key on the client). The ANTHROPIC_API_KEY
 * lives only here, server-side.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node server/api.mjs      # → http://localhost:8787
 *
 * Endpoints:
 *   GET  /api/health  → { ok, hasKey, model }
 *   POST /api/extract → body { text } | { pdfBase64, mediaType } → ExtractionResult
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { extractWithClaude, DEFAULT_MODEL } from '../engine/extractors/claude.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // project root (smepro-doi/)
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const MAX_BODY = 32 * 1024 * 1024; // 32 MB cap (PDFs)

/** Read and JSON-parse a request body with a hard size limit. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; /** @type {Buffer[]} */ const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

/**
 * @param {{ extractor?: typeof extractWithClaude, apiKey?: string, model?: string, root?: string }} [config]
 * @returns {http.Server}
 */
export function createApiServer(config = {}) {
  const extractor = config.extractor || extractWithClaude;
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = config.model || process.env.SMEPRO_MODEL || DEFAULT_MODEL;
  const root = config.root || ROOT;

  return http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];

    // --- API ---
    if (url === '/api/health') return send(res, 200, { ok: true, hasKey: !!apiKey, model, engine: 'claude' });

    if (url === '/api/extract') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      if (!apiKey) return send(res, 503, { error: 'AI extraction is not configured on the server (set ANTHROPIC_API_KEY).' });
      let body;
      try { body = await readJson(req); } catch (e) { return send(res, 413, { error: String(e.message || e) }); }
      if (!body.text && !body.pdfBase64) return send(res, 400, { error: 'Provide { text } or { pdfBase64 }.' });
      try {
        const result = await extractor(body.pdfBase64 ? { pdfBase64: body.pdfBase64, mediaType: body.mediaType, text: body.text } : { text: body.text }, { apiKey, model });
        return send(res, 200, result);
      } catch (e) {
        return send(res, 502, { error: `Extraction failed: ${String(e.message || e)}` });
      }
    }

    // --- Static files (the app) ---
    const rel = url === '/' ? '/web/index.html' : url;
    const filePath = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404 Not Found');
    }
  });
}

// Run directly: ANTHROPIC_API_KEY=... node server/api.mjs
// Cross-platform "is main module" check (Windows paths use backslashes/drive letters).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = Number(process.env.PORT) || 8787;
  const server = createApiServer();
  server.listen(PORT, () => {
    const keyed = !!process.env.ANTHROPIC_API_KEY;
    console.log(`SMEPro DOI Builder API → http://localhost:${PORT}`);
    console.log(`  app:    http://localhost:${PORT}/`);
    console.log(`  AI key: ${keyed ? 'configured ✓' : 'NOT set — /api/extract will return 503 (heuristic extractor still works offline)'}`);
  });
}
