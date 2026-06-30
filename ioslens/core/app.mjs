// @ts-check
/**
 * Composition root — wires the iOSLENS control plane from config.
 *
 * Builds, in dependency order: the Matrix store + audit store (Postgres when
 * DATABASE_URL is set, else in-memory), the Matrix engine, the two-flow clients,
 * the resolver, the MCP tool registry, the JSON-RPC server, and the Layer-1 JWT
 * verifier. Returns everything a transport needs plus a `health()` probe.
 */
import { createHashEmbedder } from '../matrix/embeddings.mjs';
import { createMemoryStore, createPgStore } from '../matrix/store.mjs';
import { createMemoryAudit, createPgAudit } from '../core/audit.mjs';
import { createMatrix } from '../matrix/matrix.mjs';
import { createResolver } from '../core/resolver.mjs';
import { createMockEntra } from '../flows/entra.mjs';
import { createMockEthos } from '../flows/ethos.mjs';
import { createTools } from '../mcp/tools.mjs';
import { createMcpServer, PROTOCOL_VERSION } from '../mcp/server.mjs';
import { createJwtVerifier, createInsecureDevVerifier } from '../authz/jwt.mjs';

/**
 * @param {ReturnType<import('./config.mjs').loadConfig>} config
 * @param {{ entra?: any, ethos?: any }} [overrides] inject flow clients (tests/prod)
 */
export async function createApp(config, overrides = {}) {
  const embedder = createHashEmbedder({ model: config.embedding.model, dim: config.embedding.dim });

  const store = config.databaseUrl
    ? await createPgStore({ connectionString: config.databaseUrl, embedder })
    : createMemoryStore({ embedder });
  const audit = config.databaseUrl
    ? await createPgAudit({ connectionString: config.databaseUrl })
    : createMemoryAudit();

  const matrix = createMatrix(store);
  const entra = overrides.entra ?? createMockEntra();
  const ethos = overrides.ethos ?? createMockEthos();
  const resolver = createResolver({ matrix, audit, entra, ethos, activeOnly: config.activeOnly });

  const tools = createTools({ matrix, resolver, store, audit });
  const mcpServer = createMcpServer({ tools });

  const verifier =
    config.auth.mode === 'entra'
      ? createJwtVerifier({ jwksUri: config.auth.jwksUri, issuer: config.auth.issuer, audience: config.auth.audience })
      : createInsecureDevVerifier();

  const health = () => ({
    protocol: PROTOCOL_VERSION,
    store: store.kind,
    audit: audit.kind,
    auth: config.auth.mode,
    activeOnly: config.activeOnly,
    embedding: { model: embedder.model, dim: embedder.dim },
    tools: Object.keys(tools),
  });

  return { config, embedder, store, audit, matrix, entra, ethos, resolver, tools, mcpServer, verifier, health };
}
