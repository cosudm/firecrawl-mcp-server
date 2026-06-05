// @ts-check
/**
 * Build a single, dependency-free HTML file (dist/smepro-doi.html) that anyone can
 * open by double-clicking — no server, no install, works offline and over file://.
 *
 * One source of truth: we inline the SAME tested engine modules used by the test
 * suite, stripping only `import`/`export` keywords so they share one module scope.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFile(join(root, p), 'utf8');

/** Strip ES module syntax so files can be concatenated into one scope. */
function deModule(src) {
  return src
    .replace(/^\s*import\s+[^\n;]+;?\s*$/gm, '')      // drop import lines
    .replace(/^\s*export\s+default\s+[^\n;]+;?\s*$/gm, '') // drop `export default <named>;` (named decl already in scope)
    .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '')    // drop `export { ... }`
    .replace(/^(\s*)export\s+(class|function|const|let|var)\b/gm, '$1$2'); // export decl → decl
}

const [fraction, schema, engine, extraction, benton, bentonSrc, app, css] = await Promise.all([
  read('engine/fraction.mjs'),
  read('engine/schema.mjs'),
  read('engine/engine.mjs'),
  read('engine/extraction.mjs'),
  read('engine/cases/benton-morales.mjs'),
  read('engine/cases/benton-morales-source.mjs'),
  read('web/app.js'),
  read('web/styles.css'),
]);

const bundledModule = [
  '/* ---- engine/fraction.mjs ---- */', deModule(fraction),
  '/* ---- engine/schema.mjs ---- */',   deModule(schema),
  '/* ---- engine/engine.mjs ---- */',   deModule(engine),
  '/* ---- engine/extraction.mjs ---- */', deModule(extraction),
  '/* ---- engine/cases/benton-morales.mjs ---- */', deModule(benton),
  '/* ---- engine/cases/benton-morales-source.mjs ---- */', deModule(bentonSrc),
  '/* ---- web/app.js ---- */',          deModule(app),
].join('\n\n');

const templateHtml = await read('web/index.html');

// Reuse the exact header/markup from index.html, but inline CSS + JS and drop the
// module loader (everything is already in scope).
const head = templateHtml
  .replace('<link rel="stylesheet" href="/web/styles.css" />', `<style>\n${css}\n</style>`)
  .replace(/<script type="module">[\s\S]*?<\/script>/, `<script type="module">\n${bundledModule}\n</script>`);

const out = join(root, 'dist', 'smepro-doi.html');
await writeFile(out, head, 'utf8');
console.log(`Built single-file app → ${out}`);
console.log(`Size: ${(Buffer.byteLength(head) / 1024).toFixed(1)} KB`);
