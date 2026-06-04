// @ts-check
/**
 * Division-of-Interest engine.
 *
 * The engine is a deterministic fold over chronologically-ordered title
 * instruments. It maintains two independent ledgers — the mineral/royalty estate
 * and the leasehold/working-interest estate — because once a lease is granted the
 * royalty side (who owns the minerals) and the cost-bearing side (who owns the
 * WI) evolve separately. From the final state it derives the Division of Interest
 * (DOI) deck using exact rational arithmetic, then runs a curative rule set to
 * flag the judgment calls a human landman must confirm.
 *
 * The LLM/extraction layer is responsible for turning documents into the typed
 * schema; ALL arithmetic lives here so decimals can never be hallucinated.
 */

import { Fraction, F, sum } from './fraction.mjs';
import { validateProject } from './schema.mjs';

/**
 * @typedef {import('./schema.mjs').TitleProject} TitleProject
 * @typedef {import('./schema.mjs').TitleDocument} TitleDocument
 */

const SEVERITY = /** @type {const} */ ({ CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', INFO: 'info' });

/** @param {Map<string, Fraction>} m @param {string} k @param {Fraction} delta */
function addTo(m, k, delta) {
  const cur = m.get(k) || Fraction.ZERO;
  const next = cur.add(delta);
  if (next.isZero()) m.delete(k);
  else m.set(k, next);
}

/**
 * Build the chronological run sheet (Step 1) and the folded end state.
 * @param {TitleProject} project
 */
function foldDocuments(project) {
  const partyName = (/** @type {string} */ id) =>
    project.parties.find((p) => p.id === id)?.name || id;

  /** @type {Map<string, Fraction>} participating mineral ownership (sums to 1) */
  const minerals = new Map([[project.rootOwner, Fraction.ONE]]);
  /** @type {Array<any>} carved royalty interests */
  const npris = [];
  /** @type {any} */ let lease = null;
  /** @type {Map<string, Fraction>} working-interest ownership (sums to 1) */
  const wi = new Map();
  /** @type {Array<any>} override royalties on the leasehold */
  const orris = [];
  /** @type {any} */ let unit = null;
  /** @type {any} */ let production = null;
  /** @type {Array<any>} */ const runSheet = [];
  /** @type {Array<any>} */ const foldFlags = [];

  const docs = [...project.documents].sort((a, b) => a.date.localeCompare(b.date));

  for (const d of docs) {
    /** @type {string[]} */ const effects = [];

    switch (d.kind) {
      case 'mineralConveyance': {
        const frac = F(d.conveyMineralFraction);
        const held = minerals.get(d.grantor) || Fraction.ZERO;
        if (frac.gt(held)) {
          foldFlags.push({
            severity: SEVERITY.CRITICAL,
            code: 'OVER_CONVEYANCE',
            title: `Over-conveyance in ${d.id}`,
            detail: `${partyName(d.grantor)} conveyed ${frac.toFractionString()} mineral interest but held only ${held.toFractionString()}.`,
          });
        }
        addTo(minerals, d.grantor, frac.neg());
        addTo(minerals, d.grantee, frac);
        effects.push(`Minerals: ${frac.toFractionString()} from ${partyName(d.grantor)} → ${partyName(d.grantee)}.`);

        if (d.reservation) {
          const r = d.reservation;
          const owners = (r.owners || []).map((o) => ({ party: o.party, share: F(o.share) }));
          const ownerSum = sum(owners.map((o) => o.share));
          if (!ownerSum.eq(1)) {
            foldFlags.push({
              severity: SEVERITY.HIGH,
              code: 'NPRI_OWNER_SUM',
              title: `NPRI owner shares do not sum to 1 (${d.id})`,
              detail: `Owner shares total ${ownerSum.toFractionString()}.`,
            });
          }
          npris.push({
            id: r.id,
            quantum: F(r.quantum),
            basis: r.basis,
            ambiguous: !!r.ambiguous,
            interpretationNote: r.interpretationNote,
            appliesTo: r.appliesToMineralFraction != null ? F(r.appliesToMineralFraction) : Fraction.ONE,
            term: r.term,
            heldByProduction: false,
            owners,
            sourceDoc: d.id,
          });
          effects.push(`Reserved ${F(r.quantum).toFractionString()} ${r.basis} NPRI (${r.id}).`);
        }
        break;
      }

      case 'oilGasLease': {
        const leasedFraction = minerals.get(d.lessor) || Fraction.ZERO;
        lease = {
          id: d.id,
          lessor: d.lessor,
          lessee: d.lessee,
          royalty: F(d.royalty),
          coversMineralFraction: leasedFraction,
          pughDepthNote: d.pughDepthNote,
          noDeductionsNote: d.noDeductionsNote,
          primaryTermYears: d.primaryTermYears,
          date: d.date,
        };
        wi.clear();
        wi.set(d.lessee, Fraction.ONE);
        effects.push(`Lease granted at ${F(d.royalty).toFractionString()} royalty; 100% WI → ${partyName(d.lessee)}.`);
        break;
      }

      case 'assignment': {
        const frac = d.wiFraction != null ? F(d.wiFraction) : Fraction.ONE;
        const held = wi.get(d.assignor) || Fraction.ZERO;
        if (frac.gt(held)) {
          foldFlags.push({
            severity: SEVERITY.CRITICAL,
            code: 'OVER_ASSIGNMENT',
            title: `Over-assignment of WI in ${d.id}`,
            detail: `${partyName(d.assignor)} assigned ${frac.toFractionString()} WI but held ${held.toFractionString()}.`,
          });
        }
        addTo(wi, d.assignor, frac.neg());
        addTo(wi, d.assignee, frac);
        effects.push(`WI: ${frac.toFractionString()} from ${partyName(d.assignor)} → ${partyName(d.assignee)}.`);

        if (d.reservedOrri) {
          orris.push({ id: `${d.id}-orri`, quantum: F(d.reservedOrri.quantum), owner: d.reservedOrri.owner, sourceDoc: d.id, note: 'Reserved in assignment' });
          effects.push(`ORRI ${F(d.reservedOrri.quantum).toFractionString()} reserved by ${partyName(d.reservedOrri.owner)}.`);
        }
        // Cross-check recited (allegedly pre-existing) ORRIs against what we've actually seen.
        for (const rec of d.recitedOrri || []) {
          const exists = orris.some((o) => o.owner === rec.owner && o.quantum.eq(F(rec.quantum)));
          if (!exists) {
            foldFlags.push({
              severity: SEVERITY.HIGH,
              code: 'ORRI_RECITAL_GAP',
              title: `Recited ORRI not yet of record (${d.id})`,
              detail: `${d.id} recites a ${F(rec.quantum).toFractionString()} ORRI to ${partyName(rec.owner)} as already outstanding${rec.note ? ` ("${rec.note}")` : ''}, but no such conveyance appears at or before ${d.date}.`,
              recital: { quantum: rec.quantum, owner: rec.owner },
            });
          }
        }
        break;
      }

      case 'orriAssignment': {
        orris.push({ id: d.id, quantum: F(d.quantum), owner: d.assignee, sourceDoc: d.id, note: d.note });
        effects.push(`ORRI ${F(d.quantum).toFractionString()} conveyed ${partyName(d.assignor)} → ${partyName(d.assignee)}.`);
        break;
      }

      case 'affidavitOfHeirship': {
        const target = d.affects === 'npri'
          ? npris.find((n) => n.id === d.npriId) || npris[0]
          : null;
        const dists = d.distributions.map((x) => ({ heir: x.heir, share: F(x.share) }));
        const distSum = sum(dists.map((x) => x.share));
        if (!distSum.eq(1)) {
          foldFlags.push({
            severity: SEVERITY.HIGH,
            code: 'HEIRSHIP_SUM',
            title: `Heirship distributions do not sum to 1 (${d.id})`,
            detail: `Distributions total ${distSum.toFractionString()}.`,
          });
        }
        if (target) {
          /** @type {Map<string, Fraction>} */
          const own = new Map(target.owners.map((/** @type {any} */ o) => [o.party, o.share]));
          const decedentShare = own.get(d.decedent) || Fraction.ZERO;
          own.delete(d.decedent);
          for (const x of dists) addTo(own, x.heir, decedentShare.mul(x.share));
          target.owners = [...own.entries()].map(([party, share]) => ({ party, share }));
          effects.push(`Distributed ${partyName(d.decedent)}'s ${decedentShare.toFractionString()} NPRI share among ${dists.length} heir(s).`);
        }
        break;
      }

      case 'unitDesignation': {
        unit = { name: d.unitName, unitAcres: d.unitAcres, tractAcres: d.tractAcres, otherTracts: d.otherTracts || [] };
        effects.push(`Tract pooled into ${d.unitName} (${d.tractAcres}/${d.unitAcres} ac).`);
        break;
      }

      case 'completionReport': {
        production = { well: d.well, top: d.intervalTopFt, bottom: d.intervalBottomFt, date: d.date };
        for (const n of npris) if (n.term) n.heldByProduction = true;
        effects.push(`First production established (${d.well}); term interests held by production.`);
        break;
      }

      default:
        break;
    }

    runSheet.push({ ...d, effects });
  }

  return { minerals, npris, lease, wi, orris, unit, production, runSheet, foldFlags, partyName };
}

/**
 * Derive the DOI deck (Step 4) from folded state, with an exact balance proof.
 * @param {ReturnType<typeof foldDocuments>} state
 */
function buildDoi(state) {
  const { lease, minerals, npris, wi, orris, unit, partyName } = state;
  if (!lease) throw new Error('No oil & gas lease found — DOI requires an active lease.');

  const royalty = lease.royalty; // lessor royalty, e.g. 1/5
  /** @type {Array<any>} */ const rows = [];

  // --- Royalty estate: NPRIs carve off the top, minerals share the remainder ---
  let totalNpri = Fraction.ZERO;
  for (const n of npris) {
    const perProduction = (n.basis === 'floating' ? n.quantum.mul(royalty) : n.quantum).mul(n.appliesTo);
    totalNpri = totalNpri.add(perProduction);
    for (const o of n.owners) {
      rows.push({
        owner: partyName(o.party),
        partyId: o.party,
        type: 'Royalty (NPRI)',
        fraction: o.share,
        fractionLabel: `${o.share.toFractionString()} of ${n.quantum.toFractionString()} NPRI`,
        nri: o.share.mul(perProduction),
        source: n.sourceDoc,
      });
    }
  }

  const mineralRoyaltyPool = royalty.sub(totalNpri);
  if (mineralRoyaltyPool.sign() < 0) {
    // Fixed NPRI larger than the lease royalty — economically impossible to satisfy.
    state.foldFlags.push({
      severity: SEVERITY.CRITICAL,
      code: 'NPRI_EXCEEDS_ROYALTY',
      title: 'NPRI burden exceeds the lease royalty',
      detail: `Carved royalty (${totalNpri.toFractionString()}) is larger than the lease royalty (${royalty.toFractionString()}), leaving the mineral owners a negative royalty. The NPRI is almost certainly a "fraction OF royalty" (floating), not a fixed fraction of 8/8.`,
    });
  }
  for (const [party, mf] of minerals.entries()) {
    rows.push({
      owner: partyName(party),
      partyId: party,
      type: 'Mineral (Lessor Royalty)',
      fraction: mf,
      fractionLabel: `${mf.toFractionString()} minerals × ${mineralRoyaltyPool.toFractionString()} net royalty`,
      nri: mf.mul(mineralRoyaltyPool),
      source: lease.id,
    });
  }

  // --- Leasehold estate: ORRIs carve off the WI, the WI owners net the rest ---
  const wiGross = Fraction.ONE.sub(royalty); // 8/8 − royalty
  let totalOrri = Fraction.ZERO;
  for (const o of orris) {
    totalOrri = totalOrri.add(o.quantum);
    rows.push({
      owner: partyName(o.owner),
      partyId: o.owner,
      type: 'ORRI',
      fraction: o.quantum,
      fractionLabel: `${o.quantum.toFractionString()} of 8/8`,
      nri: o.quantum,
      source: o.sourceDoc,
    });
  }
  const wiNet = wiGross.sub(totalOrri);
  for (const [party, wf] of wi.entries()) {
    rows.push({
      owner: partyName(party),
      partyId: party,
      type: 'Working Interest (NRI)',
      fraction: wf,
      fractionLabel: `${wf.toFractionString()} WI`,
      nri: wf.mul(wiNet),
      source: lease.id,
    });
  }

  const total = sum(rows.map((r) => r.nri));
  const balances = total.eq(1);

  // Unit allocation factor (Step 4B).
  const unitFactor = unit ? new Fraction(BigInt(Math.round(unit.tractAcres * 1e6)), BigInt(Math.round(unit.unitAcres * 1e6))) : Fraction.ONE;
  for (const r of rows) r.unitNri = r.nri.mul(unitFactor);

  return {
    rows,
    royalty,
    totalNpri,
    mineralRoyaltyPool,
    wiGross,
    totalOrri,
    wiNet,
    total,
    balances,
    unit,
    unitFactor,
  };
}

/**
 * Curative / defect rules (Step 5) — the judgment calls that need a human.
 * @param {ReturnType<typeof foldDocuments>} state
 * @param {ReturnType<typeof buildDoi>} doi
 */
function runCurative(state, doi) {
  /** @type {Array<any>} */ const flags = [...state.foldFlags];
  const { lease, npris, minerals, partyName } = state;

  // 1. NPRI fixed-vs-floating interpretation risk.
  for (const n of npris) {
    if (n.ambiguous) {
      const floating = n.quantum.mul(lease.royalty).mul(n.appliesTo);
      const fixed = n.quantum.mul(n.appliesTo);
      flags.push({
        severity: SEVERITY.CRITICAL,
        code: 'NPRI_INTERPRETATION',
        title: `NPRI "fraction vs. fraction-of-royalty" ambiguity (${n.id})`,
        detail: `Reserved as "${n.quantum.toFractionString()}". Floating reading = ${floating.toDecimal()} (${floating.toFractionString()}); fixed reading = ${fixed.toDecimal()} (${fixed.toFractionString()}). Engine used the **${n.basis}** reading${n.interpretationNote ? ` — ${n.interpretationNote}` : ''}. Obtain a stipulation/correction before disbursing; impact is ${fixed.div(floating.isZero() ? Fraction.ONE : floating).toDecimal(2)}×.`,
      });
    }
  }

  // 2. WI NRI recited in an assignment vs. engine-computed net WI NRI.
  for (const d of state.runSheet) {
    if (d.kind === 'assignment' && d.statedNri != null) {
      const stated = F(d.statedNri);
      if (!stated.eq(doi.wiNet)) {
        flags.push({
          severity: SEVERITY.HIGH,
          code: 'WI_NRI_MISMATCH',
          title: `Assignment NRI recital differs from computed WI NRI (${d.id})`,
          detail: `${d.id} recites ${stated.toDecimal()} NRI, but after the ${doi.totalOrri.toDecimal()} ORRI burden the net working-interest NRI computes to ${doi.wiNet.toDecimal()}. The recited figure is the lease NRI before ORRI; pay on ${doi.wiNet.toDecimal()}.`,
        });
      }
    }
  }

  // 3. Reliance on an Affidavit of Heirship rather than probate.
  for (const d of state.runSheet) {
    if (d.kind === 'affidavitOfHeirship') {
      flags.push({
        severity: SEVERITY.MEDIUM,
        code: 'HEIRSHIP_RELIANCE',
        title: `Title relies on Affidavit of Heirship (${d.id})`,
        detail: `Heirs of ${partyName(d.decedent)} take by affidavit, not adjudication. Confirm (a) no will, (b) the interest's ${d.communityProperty ? 'community' : 'separate'} characterization, and (c) that all listed heirs are the decedent's only heirs (esp. children of the surviving spouse) before treating title as marketable.`,
      });
    }
  }

  // 4. Term NPRI expiration / held-by-production monitoring.
  for (const n of npris) {
    if (n.term) {
      flags.push({
        severity: n.heldByProduction ? SEVERITY.MEDIUM : SEVERITY.HIGH,
        code: 'TERM_NPRI',
        title: `Term NPRI maintenance (${n.id})`,
        detail: `Reserved for ${n.term.years} years${n.term.plusProduction ? ' and so long as production continues' : ''}. Currently ${n.heldByProduction ? 'held by production' : 'NOT shown as held by production'}. A cessation beyond the lease/continuous-development limits could terminate it and revert the royalty to the mineral owners.`,
      });
    }
  }

  // 5. Pugh / depth severance.
  if (lease.pughDepthNote) {
    flags.push({
      severity: SEVERITY.MEDIUM,
      code: 'PUGH_DEPTH',
      title: 'Depth severance via Pugh clause',
      detail: `${lease.pughDepthNote} Rights below the maintained interval are released/open and are NOT covered by this deck.`,
    });
  }

  // 6. Unit allocation incomplete (other tracts' ownership unknown).
  if (state.unit && (state.unit.otherTracts || []).length > 0) {
    const acres = state.unit.otherTracts.map((/** @type {any} */ t) => `${t.name} (${t.acres} ac)`).join(', ');
    flags.push({
      severity: SEVERITY.MEDIUM,
      code: 'UNIT_INCOMPLETE',
      title: 'Unit deck incomplete — other tracts unmodeled',
      detail: `This deck covers the subject tract only (participation ${doi.unitFactor.toDecimal()}). Ownership for ${acres} was not provided, so a full ${state.unit.name} well deck cannot be closed. Confirm the unit's allocation method (surface acreage assumed).`,
    });
  }

  // 7. Shared executive rights after a mineral split.
  if (minerals.size > 1) {
    flags.push({
      severity: SEVERITY.INFO,
      code: 'SHARED_EXECUTIVE',
      title: 'Executive rights are shared',
      detail: `${minerals.size} parties now own participating minerals (${[...minerals.keys()].map(partyName).join(', ')}). Any future lease, amendment, or ratification needs all executive owners; the existing producing lease is unaffected.`,
    });
  }

  // 8. Decimal-rounding disclosure.
  flags.push({
    severity: SEVERITY.INFO,
    code: 'ROUNDING',
    title: 'Decimal rounding disclosure',
    detail: 'Internal math is exact (rational). Displayed 8-place decimals are round-half-up and may differ from the exact total by ±0.00000001 per owner; the authoritative sum is exactly 1.00000000.',
  });

  const order = { critical: 0, high: 1, medium: 2, info: 3 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return flags;
}

/**
 * Run the full 5-step analysis.
 * @param {TitleProject} project
 */
export function analyzeTitleProject(project) {
  const errors = validateProject(project);
  if (errors.length) throw new Error(`Invalid Title Project:\n - ${errors.join('\n - ')}`);

  const state = foldDocuments(project);
  const doi = buildDoi(state);
  const curative = runCurative(state, doi);

  return {
    project: { name: project.name, tract: project.tract, asOfDate: project.asOfDate },
    runSheet: state.runSheet,
    ownership: {
      minerals: [...state.minerals.entries()].map(([party, f]) => ({ party, name: state.partyName(party), fraction: f })),
      npris: state.npris.map((/** @type {any} */ n) => ({
        id: n.id,
        quantum: n.quantum,
        basis: n.basis,
        owners: n.owners.map((/** @type {any} */ o) => ({ party: o.party, name: state.partyName(o.party), share: o.share })),
      })),
      wi: [...state.wi.entries()].map(([party, f]) => ({ party, name: state.partyName(party), fraction: f })),
      orris: state.orris.map((/** @type {any} */ o) => ({ id: o.id, owner: o.owner, name: state.partyName(o.owner), quantum: o.quantum })),
    },
    lease: state.lease && {
      id: state.lease.id,
      lessee: state.partyName(state.lease.lessee),
      royalty: state.lease.royalty,
      pughDepthNote: state.lease.pughDepthNote,
      noDeductionsNote: state.lease.noDeductionsNote,
    },
    unit: state.unit,
    doi,
    curative,
  };
}

export { SEVERITY };
