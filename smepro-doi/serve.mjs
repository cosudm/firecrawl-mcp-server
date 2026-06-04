// @ts-check
/** Minimal static dev server for the module build (web/ over http://localhost). */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/') urlPath = '/web/index.html';
  const filePath = join(root, normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404 Not Found');
  }
}).listen(PORT, () => console.log(`SMEPro DOI Builder (dev) → http://localhost:${PORT}`));
