// @ts-check
/**
 * Streamable-HTTP transport for the MCP server (§05, §06.4).
 *
 * This is the controlled inbound path Copilot/agents reach within Lamar's
 * boundary. Every POST /mcp carries an Entra bearer JWT; the transport runs
 * Layer 1 authentication (validate the JWT locally against Entra's JWKS over
 * outbound 443 — never an inbound call to Entra) before dispatching. A failed
 * validation returns 401/403 before any tool code runs.
 *
 *   GET  /healthz → liveness + backend kinds
 *   POST /mcp     → one JSON-RPC request, one JSON-RPC response
 */
import http from 'node:http';
import { authenticate } from '../authz/authenticate.mjs';
import { AuthError } from '../authz/jwt.mjs';

const MAX_BODY = 4 * 1024 * 1024; // 4 MB

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */ const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new AuthError('payload too large', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function bearer(req) {
  const h = req.headers['authorization'];
  const v = Array.isArray(h) ? h[0] : h;
  if (!v || !/^bearer /i.test(v)) return undefined;
  return v.slice(7).trim() || undefined;
}

/**
 * @param {{
 *   server: { handle: (msg:any, ctx:any)=>Promise<any|null> },
 *   verifier: import('../authz/jwt.mjs').JwtVerifier,
 *   health?: () => any,
 * }} deps
 * @returns {http.Server}
 */
export function createHttpTransport(deps) {
  return http.createServer(async (req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (url === '/healthz' || url === '/health') {
      return send(res, 200, { ok: true, service: 'ioslens-mcp', ...(deps.health ? deps.health() : {}) });
    }

    if (url !== '/mcp' && url !== '/') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

    // Layer 1 — authenticate the bearer JWT locally (egress-only).
    let ctx;
    try {
      ctx = await authenticate(deps.verifier, bearer(req));
    } catch (err) {
      const status = err instanceof AuthError ? err.status : 401;
      return send(res, status, { jsonrpc: '2.0', id: null, error: { code: -32001, message: String(err?.message ?? err), data: { status } } });
    }

    let msg;
    try { msg = await readJson(req); }
    catch (err) {
      const status = err instanceof AuthError ? err.status : 400;
      return send(res, status, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    // Batch support: array of messages.
    if (Array.isArray(msg)) {
      const responses = (await Promise.all(msg.map((m) => deps.server.handle(m, ctx)))).filter(Boolean);
      return send(res, 200, responses);
    }

    const response = await deps.server.handle(msg, ctx);
    if (response === null) { res.writeHead(202); return res.end(); } // notification
    return send(res, 200, response);
  });
}
