// @ts-check
/**
 * The iOSLENS MCP server — JSON-RPC 2.0 dispatch with two-layer authorization.
 *
 * Transport-agnostic: `handle(message, ctx)` takes a parsed JSON-RPC message and
 * an already-authenticated caller context (`ctx.roles`, `ctx.claims`,
 * `ctx.principal`) and returns the JSON-RPC response (or null for
 * notifications). Layer 1 authentication (validate the JWT) is the transport's
 * job; this dispatcher enforces Layer 1 RBAC (App Role → tool) and then runs the
 * handler, which computes the Layer 2 Matrix boundary.
 *
 * Implements: initialize, notifications/initialized, tools/list, tools/call,
 * ping. Self-contained — no MCP SDK dependency, so the protocol surface is fixed
 * and auditable.
 */
import { authorizeTool } from '../authz/approles.mjs';
import { AuthError } from '../authz/jwt.mjs';

export const PROTOCOL_VERSION = '2025-06-18';

/** JSON-RPC error helper. */
function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}
function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/**
 * @param {{ tools: Record<string, { description: string, inputSchema: any, handler: Function }>, serverInfo?: { name: string, version: string } }} deps
 */
export function createMcpServer(deps) {
  const serverInfo = deps.serverInfo ?? { name: 'ioslens', version: '1.0.0' };

  const toolList = () =>
    Object.entries(deps.tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema }));

  /**
   * Dispatch one JSON-RPC message.
   * @param {any} msg parsed JSON-RPC request/notification
   * @param {{ roles?: string[], claims?: any, principal?: string }} [ctx]
   * @returns {Promise<any|null>} response object, or null for notifications
   */
  async function handle(msg, ctx = {}) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg?.id, -32600, 'Invalid Request');
    }
    const { id, method, params } = msg;
    const isNotification = id === undefined;

    try {
      switch (method) {
        case 'initialize':
          return rpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo,
          });

        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null; // notifications get no response

        case 'ping':
          return rpcResult(id, {});

        case 'tools/list':
          return rpcResult(id, { tools: toolList() });

        case 'tools/call': {
          const name = params?.name;
          const args = params?.arguments ?? {};
          const tool = deps.tools[name];
          if (!tool) return rpcError(id, -32602, `unknown tool: ${name}`);

          // Layer 1 RBAC — App Role gate. No role → rejected before handler runs.
          authorizeTool(name, ctx.roles ?? []);

          // Layer 2 — the handler resolves the governed answer against the Matrix.
          const data = await tool.handler(args, ctx);
          return rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            structuredContent: data,
            isError: false,
          });
        }

        default:
          return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      if (isNotification) return null;
      if (err instanceof AuthError) {
        return rpcError(id, -32001, err.message, { status: err.status });
      }
      // Tool-execution errors surface as a tools/call result with isError, per MCP.
      if (method === 'tools/call') {
        return rpcResult(id, { content: [{ type: 'text', text: String(err?.message ?? err) }], isError: true });
      }
      return rpcError(id, -32603, String(err?.message ?? err));
    }
  }

  return { handle, toolList, serverInfo, PROTOCOL_VERSION };
}
