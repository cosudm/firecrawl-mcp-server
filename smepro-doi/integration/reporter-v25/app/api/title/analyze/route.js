// app/api/title/analyze/route.js
//
// Reporter V2.5 — fold a confirmed TitleProject into a Division of Interest deck
// and persist it. This is where the DETERMINISTIC engine runs (Node), so the
// balance gate is enforced server-side and the LLM is nowhere near the math.
//
// Flow:
//   confirmed project ─► analyzeTitleProject() ─► serializeDeck() ─► Prisma write
//                                              └─► balances === true gate
//
// Body: { project: TitleProject, unitId?: string, basis?: 'tract'|'unit',
//         requireBalanced?: boolean (default true) }
// Returns: { projectId, deckId, deck } where deck is the serialized, JSON-safe payload.

import { analyzeTitleProject } from '@smepro/doi/engine/engine.mjs';
import { serializeDeck } from '@smepro/doi/integration/serialize.mjs';
import { prisma } from '../../../../lib/prisma';
import { requireOperator } from '../../../../lib/operator';

export const runtime = 'nodejs';

export async function POST(request) {
  const ctx = await requireOperator(request);
  if (!ctx.ok) return Response.json({ error: ctx.error }, { status: ctx.status });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  const { project, unitId = null, basis = 'tract', requireBalanced = true } = body || {};
  if (!project) return Response.json({ error: 'Provide { project }.' }, { status: 400 });

  // 1. Deterministic fold. validateProject throws on a malformed project → 422.
  let analysis;
  try {
    analysis = analyzeTitleProject(project);
  } catch (err) {
    return Response.json({ error: `Title project did not validate: ${err?.message || err}` }, { status: 422 });
  }

  // 2. JSON-safe deck (Fraction → fixed-place decimal strings; no math redone here).
  const deck = serializeDeck(analysis, project, { unitId, basis });

  // 3. The gate: a deck that does not close to exactly 1.00000000 cannot be saved
  //    as authoritative. Surface it so the "Yellow Brick Road" pipeline can block.
  if (requireBalanced && !deck.balances) {
    return Response.json(
      { error: 'Deck does not balance to 1.00000000; resolve curative items before saving.', deck },
      { status: 409 },
    );
  }

  // 4. Persist atomically, scoped to the tenant. Project JSON is the source of
  //    truth; the deck + curative are computed snapshots that hang off it.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const titleProject = await tx.titleProject.create({
        data: {
          operatorId: ctx.operatorId,
          name: project.name || 'Title Project',
          tract: deck.tract ?? {},
          unitId,
          project,
          balances: deck.balances,
          createdBy: ctx.userId,
        },
      });

      const savedDeck = await tx.doiDeck.create({
        data: {
          operatorId: ctx.operatorId,
          projectId: titleProject.id,
          basis: deck.basis,
          unitFactor: deck.unitFactor,
          rows: deck.rows,
          totalNri: deck.totalNri ?? '0',
          balances: deck.balances,
        },
      });

      if (deck.curative.length) {
        await tx.doiCurative.createMany({
          data: deck.curative.map((c) => ({
            operatorId: ctx.operatorId,
            projectId: titleProject.id,
            code: c.code,
            severity: c.severity,
            title: c.title,
            detail: c.detail,
          })),
        });
      }

      return { projectId: titleProject.id, deckId: savedDeck.id };
    });

    return Response.json({ ...result, deck });
  } catch (err) {
    return Response.json({ error: `Could not save deck: ${err?.message || err}` }, { status: 500 });
  }
}
