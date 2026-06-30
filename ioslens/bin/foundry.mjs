#!/usr/bin/env node
// @ts-check
/**
 * Foundry monitor entrypoint — polls regulatory sources and enqueues proposed
 * Matrix changes (pending, proposed_by=Foundry). It can never publish; a human
 * Matrix.Admin approves via the MCP `matrix.publish` tool.
 *
 *   node bin/foundry.mjs --once                 # one polling cycle, then exit
 *   FOUNDRY_INTERVAL_MS=3600000 node bin/foundry.mjs   # poll hourly
 *
 * Sources are loaded from the module at FOUNDRY_SOURCES (default-exporting an
 * array of { regimeCode, fetchProposals }). With none configured the monitor
 * runs as a no-op so the wiring is verifiable without external feeds.
 */
import { loadConfig } from '../core/config.mjs';
import { createHashEmbedder } from '../matrix/embeddings.mjs';
import { createMemoryStore, createPgStore } from '../matrix/store.mjs';
import { createFoundryMonitor } from '../foundry/monitor.mjs';

try { process.loadEnvFile?.('.env'); } catch { /* no .env */ }

async function loadSources() {
  const path = process.env.FOUNDRY_SOURCES;
  if (!path) return [];
  const mod = await import(path);
  const sources = mod.default ?? mod.sources;
  if (!Array.isArray(sources)) throw new Error(`${path} must default-export an array of sources`);
  return sources;
}

async function main() {
  const config = loadConfig();
  const embedder = createHashEmbedder({ model: config.embedding.model, dim: config.embedding.dim });
  const store = config.databaseUrl
    ? await createPgStore({ connectionString: config.databaseUrl, embedder })
    : createMemoryStore({ embedder });

  const sources = await loadSources();
  const monitor = createFoundryMonitor({ store, sources, logger: (m) => process.stderr.write(`[foundry] ${m}\n`) });

  if (!sources.length) process.stderr.write('[foundry] no sources configured (set FOUNDRY_SOURCES); running as no-op\n');

  if (process.argv.includes('--once') || !process.env.FOUNDRY_INTERVAL_MS) {
    const result = await monitor.runOnce();
    process.stdout.write(JSON.stringify({ enqueued: result.enqueued.length, skipped: result.skipped, errors: result.errors }, null, 2) + '\n');
    return;
  }

  const intervalMs = Number(process.env.FOUNDRY_INTERVAL_MS);
  process.stderr.write(`[foundry] polling ${sources.length} source(s) every ${intervalMs}ms\n`);
  const stop = monitor.start(intervalMs);
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
}

main().catch((err) => {
  process.stderr.write(`[foundry] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
