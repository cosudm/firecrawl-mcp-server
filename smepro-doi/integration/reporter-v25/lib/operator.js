// lib/operator.js — auth + tenant-context seam.
//
// SEAM: replace the body of requireOperator with Reporter V2.5's existing session
// verification (the same one /api/insights and /api/parse-document rely on). The
// contract the routes expect:
//   success → { ok: true,  operatorId, userId }
//   failure → { ok: false, status, error }
//
// operatorId MUST be the multi-tenant key that scopes every DOI row. Never trust an
// operatorId sent from the client — derive it from the verified session/token.

export async function requireOperator(request) {
  try {
    // EXAMPLE shape — wire to your real auth. E.g. verify a Firebase ID token, or
    // call your FastAPI /session introspection, or read a signed cookie:
    //
    //   const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    //   const claims = await verifySessionToken(token);
    //   return { ok: true, operatorId: claims.operatorId, userId: claims.uid };

    const operatorId = request.headers.get('x-operator-id'); // <-- TEMPORARY: replace with verified claim
    const userId = request.headers.get('x-user-id') || null;
    if (!operatorId) return { ok: false, status: 401, error: 'Unauthenticated or missing operator context.' };
    return { ok: true, operatorId, userId };
  } catch (err) {
    return { ok: false, status: 401, error: `Auth failed: ${err?.message || err}` };
  }
}
