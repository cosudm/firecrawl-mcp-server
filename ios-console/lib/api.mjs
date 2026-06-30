// @ts-check
/**
 * REST API for the IOS+ Management Console. Pure function of (Store) → handler,
 * so the test suite can exercise it without binding a socket.
 *
 * Returns a handler: (method, pathname, query, body) => { status, json }
 * Unknown routes return { status: 404 }. Handlers never throw for client input;
 * they return a 4xx with an { error } body instead.
 */
export function createApi(store) {
  /** @param {string} m @param {string} p */
  return function handle(m, p, query = {}, body = null) {
    const seg = p.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const J = (status, json) => ({ status, json });

    // /api/health
    if (m === 'GET' && p === '/api/health')
      return J(200, { ok: true, service: 'ios-console', backend: 'memory', time: new Date().toISOString() });

    // /api/dashboard
    if (m === 'GET' && p === '/api/dashboard') return J(200, store.dashboard());

    // /api/obligations ...
    if (seg[0] === 'obligations') {
      if (m === 'GET' && seg.length === 1)
        return J(200, { items: store.listObligations(query) });
      if (m === 'GET' && seg.length === 2) {
        const o = store.getObligation(seg[1]);
        return o ? J(200, o) : J(404, { error: 'not_found' });
      }
      if (m === 'POST' && seg.length === 3 && seg[2] === 'run-check') {
        const o = store.runCheck(seg[1], body || {});
        return o ? J(200, o) : J(404, { error: 'not_found' });
      }
      if (m === 'POST' && seg.length === 3 && seg[2] === 'accept') {
        const o = store.acceptReview(seg[1]);
        return o ? J(200, o) : J(404, { error: 'not_found' });
      }
    }

    // /api/discoveries ...
    if (seg[0] === 'discoveries') {
      if (m === 'GET' && seg.length === 1)
        return J(200, { items: store.listDiscoveries(query) });
      if (m === 'POST' && seg.length === 3 && seg[2] === 'promote') {
        const r = store.promoteDiscovery(seg[1]);
        return r ? J(200, r) : J(404, { error: 'not_found' });
      }
      if (m === 'POST' && seg.length === 3 && seg[2] === 'reject') {
        const r = store.rejectDiscovery(seg[1]);
        return r ? J(200, r) : J(404, { error: 'not_found' });
      }
    }

    // /api/monitors ...
    if (seg[0] === 'monitors') {
      if (m === 'GET' && seg.length === 1) return J(200, { items: store.listMonitors() });
      if (m === 'POST' && seg.length === 3 && seg[2] === 'toggle') {
        const r = store.toggleMonitor(seg[1]);
        return r ? J(200, r) : J(404, { error: 'not_found' });
      }
    }

    // /api/projects ...
    if (seg[0] === 'projects') {
      if (m === 'GET' && seg.length === 1) return J(200, { items: store.listProjects() });
      if (m === 'GET' && seg.length === 2) {
        const pr = store.getProject(seg[1]);
        return pr ? J(200, pr) : J(404, { error: 'not_found' });
      }
      if (m === 'POST' && seg.length === 3 && seg[2] === 'approve') {
        const r = store.approveProject(seg[1]);
        if (r.error === 'not_found') return J(404, r);
        if (r.error) return J(409, r); // balance / critical-curative gate
        return J(200, r);
      }
      if (m === 'POST' && seg.length === 4 && seg[2] === 'curative') {
        const c = store.resolveCurative(seg[1], seg[3], body || {});
        return c ? J(200, c) : J(404, { error: 'not_found' });
      }
    }

    // /api/admin/reset
    if (m === 'POST' && p === '/api/admin/reset') { store.reset(); return J(200, { ok: true }); }

    return J(404, { error: 'no_route', path: p });
  };
}
