#!/usr/bin/env node
// @ts-check
/**
 * Build dist/ios-console.html — a single, self-contained file you can double-click
 * open in any browser (no server, no install). It inlines the CSS + app, and runs
 * the SAME StoreCore + REST handler in the browser against a seed snapshot that is
 * computed here in Node (so the DOI deck is the real engine output, not a mock).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeed } from './lib/seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');
const stripExports = (s) => s.replace(/^export\s+/gm, '');

const html = read('public/index.html');
const css = read('public/styles.css');
const app = read('public/app.js');
const core = stripExports(read('lib/store-core.mjs'));
const apiSrc = stripExports(read('lib/api.mjs'));
const seed = buildSeed();

// In-browser bootstrap: build a store + handler and expose window.IOS_API so app.js
// talks to it instead of fetch(). No persistence in the file build.
const bootstrap = `
${core}
${apiSrc}
const __SEED__ = ${JSON.stringify(seed)};
const __clone = () => JSON.parse(JSON.stringify(__SEED__));
const __store = new StoreCore(__clone(), { seedFn: __clone });
window.IOS_API = createApi(__store);
`;

const out = html
  .replace('<link rel="stylesheet" href="/styles.css" />', `<style>\n${css}\n</style>`)
  .replace(
    '<script type="module" src="/app.js"></script>',
    `<script type="module">\n${bootstrap}\n</script>\n<script type="module">\n${app}\n</script>`
  )
  // make the single file obviously offline-capable in its title
  .replace('<title>IOS+ Management Console</title>', '<title>IOS+ Management Console (offline build)</title>');

mkdirSync(join(HERE, 'dist'), { recursive: true });
const dest = join(HERE, 'dist', 'ios-console.html');
writeFileSync(dest, out);
const kb = (out.length / 1024).toFixed(0);
console.log(`Built dist/ios-console.html (${kb} KB) — open it directly in a browser.`);
