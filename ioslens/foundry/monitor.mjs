// @ts-check
/**
 * Foundry monitor (§04, "Population & currency"; §02 "Foundry MCP, optional").
 *
 * Foundry monitors regulatory sources and writes PROPOSED changes into the
 * Matrix `change_queue`. Nothing auto-applies: every proposal lands as `pending`
 * with `proposed_by = Foundry`, and a human Matrix.Admin must approve it via the
 * `matrix.publish` tool before a new Matrix version is cut. This module is the
 * write side of that contract — deliberately incapable of publishing.
 *
 * Sources are pluggable and injectable, so the monitor is fully testable offline
 * and indifferent to whether a source is a web feed, a file watcher, or a
 * preview MCP. Re-runs are de-duplicated against the current pending queue so a
 * standing source does not enqueue the same proposal twice.
 */

/**
 * @typedef {Object} FoundrySource
 * @property {string} regimeCode
 * @property {string} [name]
 * @property {() => Promise<{ summary: string, payload?: any }[]>} fetchProposals
 */

/**
 * @param {{
 *   store: import('../matrix/store.mjs').MatrixStore,
 *   sources: FoundrySource[],
 *   proposedBy?: string,
 *   logger?: (msg: string) => void,
 * }} deps
 */
export function createFoundryMonitor(deps) {
  const proposedBy = deps.proposedBy ?? 'Foundry';
  const log = deps.logger ?? (() => {});

  /** Key a proposal for de-duplication against the pending queue. */
  const key = (regimeCode, summary) => `${regimeCode}::${summary}`;

  /**
   * Poll every source once and enqueue any new proposals.
   * @returns {Promise<{ enqueued: any[], skipped: number, errors: { source: string, error: string }[] }>}
   */
  async function runOnce() {
    const pending = await deps.store.listChanges('pending');
    const seen = new Set(pending.map((c) => key(c.regime_code, c.summary)));
    const enqueued = [];
    let skipped = 0;
    /** @type {{ source: string, error: string }[]} */ const errors = [];

    for (const source of deps.sources) {
      let proposals;
      try {
        proposals = await source.fetchProposals();
      } catch (err) {
        errors.push({ source: source.name ?? source.regimeCode, error: String(err?.message ?? err) });
        continue;
      }
      for (const p of proposals) {
        const k = key(source.regimeCode, p.summary);
        if (seen.has(k)) { skipped++; continue; }
        seen.add(k);
        const rec = await deps.store.enqueueChange({ regime_code: source.regimeCode, summary: p.summary, payload: p.payload ?? {}, proposed_by: proposedBy });
        enqueued.push(rec);
        log(`Foundry queued ${source.regimeCode}: ${p.summary} (${rec.id})`);
      }
    }
    return { enqueued, skipped, errors };
  }

  /**
   * Run on a fixed interval. Returns a stop() function. Errors per cycle are
   * swallowed (and logged) so a transient source failure never kills the loop.
   * @param {number} intervalMs
   */
  function start(intervalMs) {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try { await runOnce(); } catch (err) { log(`Foundry cycle error: ${err?.message ?? err}`); }
    };
    const handle = setInterval(tick, intervalMs);
    if (typeof handle.unref === 'function') handle.unref();
    tick(); // run immediately
    return () => { stopped = true; clearInterval(handle); };
  }

  return { runOnce, start };
}

/**
 * Build a source from an HTTP feed: fetch a URL and map its body to proposals.
 * Injectable `fetchImpl` + `parse` keep it offline-testable.
 * @param {{ regimeCode: string, name?: string, url: string, parse: (body: any) => { summary: string, payload?: any }[], fetchImpl?: typeof fetch, headers?: Record<string,string> }} opts
 * @returns {FoundrySource}
 */
export function createWebFeedSource(opts) {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    regimeCode: opts.regimeCode,
    name: opts.name ?? opts.url,
    async fetchProposals() {
      const res = await doFetch(opts.url, { headers: opts.headers });
      if (!res.ok) throw new Error(`feed ${opts.url} failed: ${res.status}`);
      const ct = res.headers?.get?.('content-type') ?? '';
      const body = ct.includes('json') ? await res.json() : await res.text();
      return opts.parse(body);
    },
  };
}
