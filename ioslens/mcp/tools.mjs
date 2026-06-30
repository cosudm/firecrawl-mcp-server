// @ts-check
/**
 * The MCP tool registry — the agent-facing surface of iOSLENS (§05).
 *
 * Five tools, each gated by an App Role (Layer 1, see approles.mjs) and answered
 * against the Matrix boundary (Layer 2). Handlers receive (args, ctx) where ctx
 * carries the validated caller claims/roles. Every governed answer is traceable
 * to its Matrix source and, for decisions, to an immutable audit record.
 */

/**
 * @param {{
 *   matrix: { lookup: (i:any)=>Promise<any> },
 *   resolver: { resolve: (r:any)=>Promise<any> },
 *   store: import('../matrix/store.mjs').MatrixStore,
 *   audit: import('../core/audit.mjs').AuditStore,
 * }} deps
 */
export function createTools(deps) {
  const codesSchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: { system: { type: 'string', enum: ['CIP', 'SOC', 'NAICS', 'SIC'] }, value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
  };

  /** @type {Record<string, { description: string, inputSchema: any, handler: (args:any, ctx:any)=>Promise<any> }>} */
  const tools = {
    'compliance.read': {
      description:
        'Layer-1 Compliance.Read. Deterministic Matrix lookup: resolve classification codes through CIP↔SOC↔NAICS↔SIC crosswalks, return the obligation set, regime references, citations, and version ids. Read-only; records nothing.',
      inputSchema: {
        type: 'object',
        properties: {
          codes: codesSchema,
          jurisdiction: { type: 'string' },
          query: { type: 'string', description: 'free-text query for semantic fallback when no exact code match exists' },
        },
        additionalProperties: false,
      },
      async handler(args) {
        const r = await deps.matrix.lookup({ codes: args.codes ?? [], jurisdiction: args.jurisdiction, query: args.query });
        return {
          matched: r.matched,
          inputCodes: r.inputCodes.map((c) => `${c.system} ${c.value}`),
          expandedCodes: r.expandedCodes.map((c) => `${c.system} ${c.value}`),
          scopes: r.scopes,
          regimes: r.regimeRefs,
          obligations: r.obligations.map((o) => ({ id: o.obligation.id, name: o.obligation.name, regime: o.regime.code, citation: o.obligation.citation, scope: o.scope })),
          citations: r.citations,
          versionIds: r.versionIds,
        };
      },
    },

    'compliance.decide': {
      description:
        'Layer-1 Compliance.Decide. Run a full governed decision for a subject: gather identity (Entra) + live context (Ethos) + rules (Matrix), compute the boundary, and persist an immutable audit record (pointers only). Returns the decision, rationale, and trace id.',
      inputSchema: {
        type: 'object',
        properties: {
          subjectRef: { type: 'string', description: 'Entra object-id pointer; defaults to the caller (oid claim)' },
          codes: codesSchema,
          requestedScope: { type: 'string' },
          jurisdiction: { type: 'string' },
          query: { type: 'string' },
          activeOnly: { type: 'boolean', description: 'restrict to the pilot-active regimes (FERPA, THECB, SACSCOC)' },
        },
        additionalProperties: false,
      },
      async handler(args, ctx) {
        const subjectRef = args.subjectRef ?? (ctx?.claims?.oid ? `entra:obj:${ctx.claims.oid}` : undefined);
        if (!subjectRef) throw new Error('subjectRef is required (no oid claim on caller)');
        return deps.resolver.resolve({ subjectRef, codes: args.codes, requestedScope: args.requestedScope, jurisdiction: args.jurisdiction, query: args.query, activeOnly: args.activeOnly });
      },
    },

    'matrix.propose': {
      description:
        'Layer-1 Matrix.Propose. Submit a proposed Matrix change into the change_queue (status pending). Cannot publish — a Matrix.Admin must approve. This is the path Foundry and human stewards use; nothing auto-applies.',
      inputSchema: {
        type: 'object',
        properties: {
          regimeCode: { type: 'string' },
          summary: { type: 'string' },
          payload: { type: 'object' },
        },
        required: ['regimeCode', 'summary'],
        additionalProperties: false,
      },
      async handler(args, ctx) {
        const proposed_by = ctx?.principal ?? 'unknown';
        return deps.store.enqueueChange({ regime_code: args.regimeCode, summary: args.summary, payload: args.payload ?? {}, proposed_by });
      },
    },

    'matrix.publish': {
      description:
        'Layer-1 Matrix.Admin. Approve a queued change and publish a new Matrix version with the approver recorded. The approval authority of §04. Separation of duties: this role cannot also propose under least privilege policy.',
      inputSchema: {
        type: 'object',
        properties: {
          changeId: { type: 'string' },
          regimeCode: { type: 'string', description: 'required when no changeId (publish a version directly)' },
        },
        additionalProperties: false,
      },
      async handler(args, ctx) {
        const approver = ctx?.principal ?? 'unknown';
        let regimeCode = args.regimeCode;
        if (args.changeId) {
          const change = await deps.store.getChange(args.changeId);
          if (!change) throw new Error(`change ${args.changeId} not found`);
          if (change.status !== 'pending') throw new Error(`change ${args.changeId} is ${change.status}, not pending`);
          await deps.store.reviewChange(args.changeId, { status: 'approved', reviewed_by: approver, reviewed_at: new Date().toISOString() });
          regimeCode = change.regime_code;
        }
        if (!regimeCode) throw new Error('regimeCode or changeId required');
        const version = await deps.store.publishVersion({ regime_code: regimeCode, approver });
        return { published: version, changeId: args.changeId ?? null };
      },
    },

    'audit.read': {
      description:
        'Layer-1 Audit.Read. Read immutable governance decisions from the append-only audit store, by trace id, decision id, or subject pointer. For accreditors and reviewers. Returns pointers and rationale, never source records.',
      inputSchema: {
        type: 'object',
        properties: {
          traceId: { type: 'string' },
          decisionId: { type: 'string' },
          subjectRef: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000 },
        },
        additionalProperties: false,
      },
      async handler(args) {
        const records = await deps.audit.query({ traceId: args.traceId, decisionId: args.decisionId, subjectRef: args.subjectRef, limit: args.limit });
        return { count: records.length, records };
      },
    },
  };

  return tools;
}
