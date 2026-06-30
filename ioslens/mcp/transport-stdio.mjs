// @ts-check
/**
 * stdio transport for the MCP server.
 *
 * A single trusted local session (the way Claude Desktop / IDE clients launch an
 * MCP server). Layer 1 authentication happens ONCE at startup: the launching
 * process supplies the caller context (validated JWT claims → roles) which is
 * applied to every request on the pipe. Newline-delimited JSON-RPC in/out.
 */

/**
 * @param {{
 *   server: { handle: (msg:any, ctx:any)=>Promise<any|null> },
 *   ctx: { roles?: string[], claims?: any, principal?: string },
 *   input?: NodeJS.ReadableStream,
 *   output?: NodeJS.WritableStream,
 * }} deps
 * @returns {Promise<void>} resolves when the input stream closes
 */
export function startStdio(deps) {
  const input = deps.input ?? process.stdin;
  const output = deps.output ?? process.stdout;

  return new Promise((resolve) => {
    let buffer = '';
    input.setEncoding('utf8');

    const writeResponse = (response) => {
      if (response !== null && response !== undefined) output.write(JSON.stringify(response) + '\n');
    };

    input.on('data', async (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); }
        catch { writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
        try { writeResponse(await deps.server.handle(msg, deps.ctx)); }
        catch (err) { writeResponse({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: String(err?.message ?? err) } }); }
      }
    });

    input.on('end', resolve);
    input.on('close', resolve);
  });
}
