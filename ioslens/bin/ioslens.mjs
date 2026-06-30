#!/usr/bin/env node
// @ts-check
/**
 * iOSLENS control-plane entrypoint.
 *
 *   node bin/ioslens.mjs                 # MCP server over stdio (default)
 *   MCP_TRANSPORT=http node bin/ioslens.mjs   # MCP server over HTTP
 *   node bin/ioslens.mjs --health        # print health JSON and exit
 *
 * Offline by default (in-memory Matrix + dev auth). Set DATABASE_URL and ENTRA_*
 * to run against PostgreSQL/pgvector with real Entra JWT validation.
 */
import { loadConfig } from '../core/config.mjs';
import { createApp } from '../core/app.mjs';
import { startStdio } from '../mcp/transport-stdio.mjs';
import { createHttpTransport } from '../mcp/transport-http.mjs';
import { authenticate } from '../authz/authenticate.mjs';

// Best-effort .env load (Node 20.12+). No hard dependency.
try { process.loadEnvFile?.('.env'); } catch { /* no .env — fine */ }

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const app = await createApp(config);

  if (args.includes('--health')) {
    process.stdout.write(JSON.stringify(app.health(), null, 2) + '\n');
    return;
  }
  if (args.includes('--version')) {
    process.stdout.write('ioslens 1.0.0\n');
    return;
  }

  if (config.transport === 'http') {
    const httpServer = createHttpTransport({ server: app.mcpServer, verifier: app.verifier, health: app.health });
    httpServer.listen(config.http.port, config.http.host, () => {
      process.stderr.write(`[ioslens] MCP HTTP on http://${config.http.host}:${config.http.port}/mcp (auth=${config.auth.mode}, store=${app.store.kind})\n`);
    });
    const shutdown = () => httpServer.close(() => process.exit(0));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  // stdio: establish the Layer-1 caller context once for the session.
  let ctx;
  if (config.auth.mode === 'dev') {
    ctx = { roles: config.devRoles, principal: config.devPrincipal, claims: {} };
  } else {
    if (!config.stdioToken) {
      process.stderr.write('[ioslens] stdio transport with entra auth requires MCP_STDIO_TOKEN\n');
      process.exit(1);
    }
    ctx = await authenticate(app.verifier, config.stdioToken);
  }
  process.stderr.write(`[ioslens] MCP stdio ready (auth=${config.auth.mode}, roles=[${ctx.roles?.join(',')}], store=${app.store.kind})\n`);
  await startStdio({ server: app.mcpServer, ctx });
}

main().catch((err) => {
  process.stderr.write(`[ioslens] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
