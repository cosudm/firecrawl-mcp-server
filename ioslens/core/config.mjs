// @ts-check
/**
 * Configuration — resolved once from the environment.
 *
 * Everything has a safe pilot default so `node bin/ioslens.mjs` runs offline
 * (in-memory store, dev auth). Production sets DATABASE_URL + ENTRA_* and the
 * app upgrades to PostgreSQL/pgvector and real Entra JWT validation.
 */
import { DEFAULT_DIM, DEFAULT_MODEL } from '../matrix/embeddings.mjs';

/** @param {string|undefined} v @param {boolean} d */
function bool(v, d) {
  if (v == null) return d;
  return /^(1|true|yes|on)$/i.test(v);
}

/** @param {NodeJS.ProcessEnv} [env] */
export function loadConfig(env = process.env) {
  const tenant = env.ENTRA_TENANT_ID;
  const authMode = env.MCP_AUTH ?? (tenant && env.ENTRA_AUDIENCE ? 'entra' : 'dev');

  return {
    databaseUrl: env.DATABASE_URL || undefined,
    transport: env.MCP_TRANSPORT || 'stdio',
    http: {
      host: env.MCP_HTTP_HOST || '0.0.0.0',
      port: Number(env.MCP_HTTP_PORT || 8080),
    },
    activeOnly: bool(env.ACTIVE_ONLY, false),
    embedding: {
      model: env.EMBEDDING_MODEL || DEFAULT_MODEL,
      dim: Number(env.EMBEDDING_DIM || DEFAULT_DIM),
    },
    auth: {
      mode: authMode, // 'entra' | 'dev'
      tenant,
      audience: env.ENTRA_AUDIENCE,
      issuer: env.ENTRA_ISSUER || (tenant ? `https://login.microsoftonline.com/${tenant}/v2.0` : undefined),
      jwksUri: env.ENTRA_JWKS_URI || (tenant ? `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys` : undefined),
    },
    // stdio Layer-1: the launcher supplies a token, or dev roles for offline use.
    stdioToken: env.MCP_STDIO_TOKEN,
    devRoles: (env.MCP_DEV_ROLES || 'Compliance.Read,Compliance.Decide,Audit.Read').split(',').map((s) => s.trim()).filter(Boolean),
    devPrincipal: env.MCP_DEV_PRINCIPAL || 'dev-local',
  };
}
