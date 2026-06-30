#!/usr/bin/env node
// @ts-check
/**
 * IOS+ Management Console — HTTP server (zero runtime dependencies).
 *
 *   node server.mjs            # http://localhost:8090
 *   PORT=9000 node server.mjs
 *
 * Serves the SPA from public/ and the JSON API from lib/api.mjs over an in-memory,
 * file-snapshotted store. No build step, no database required.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './lib/store.mjs';
import { createApi } from './lib/api.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const PORT = Number(process.env.PORT) || 8090;

const store = new Store();
const api = createApi(store);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length });
  res.end(buf);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return null; }
}

async function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // prevent path traversal
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, safe);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback → index.html
    try {
      const data = await readFile(join(PUBLIC, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(data);
    } catch { res.writeHead(404); res.end('not found'); }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    const query = Object.fromEntries(url.searchParams.entries());
    const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : null;
    try {
      const { status, json } = api(req.method || 'GET', pathname, query, body);
      return sendJson(res, status, json);
    } catch (err) {
      return sendJson(res, 500, { error: 'internal', message: String(err && err.message || err) });
    }
  }
  return serveStatic(res, pathname);
});

// Only listen when run directly (tests import the api/store without a socket).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(PORT, () => {
    console.log(`IOS+ Management Console → http://localhost:${PORT}`);
    console.log(`  obligations: ${store.state.obligations.length} · monitors: ${store.state.monitors.length} · DOI decks: ${store.state.projects.length}`);
  });
}

export { server, store, api };
