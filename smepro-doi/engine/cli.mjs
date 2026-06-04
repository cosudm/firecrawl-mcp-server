// @ts-check
/** Terminal report — prints the full 5-step analysis for the seed case. */
import { analyzeTitleProject } from './engine.mjs';
import { bentonMorales } from './cases/benton-morales.mjs';

const r = analyzeTitleProject(bentonMorales);
const line = (c = '─') => console.log(c.repeat(78));

console.log(`\n  ${r.project.name}`);
console.log(`  ${r.project.tract.legal}\n`);

line('═');
console.log('  STEP 4 · DIVISION OF INTEREST DECK (tract basis, 8/8)');
line();
console.log('  ' + 'Owner'.padEnd(34) + 'Type'.padEnd(14) + 'NRI'.padStart(14));
for (const row of [...r.doi.rows].sort((a, b) => b.nri.toNumber() - a.nri.toNumber())) {
  const t = row.type.replace('Working Interest (NRI)', 'WI').replace('Mineral (Lessor Royalty)', 'Mineral').replace('Royalty (NPRI)', 'NPRI');
  console.log('  ' + row.owner.slice(0, 33).padEnd(34) + t.padEnd(14) + row.nri.toDecimal(8).padStart(14));
}
line();
console.log('  ' + 'TOTAL'.padEnd(48) + r.doi.total.toDecimal(8).padStart(14) + (r.doi.balances ? '  ✓' : '  ✗ UNBALANCED'));
console.log(`  Unit factor: ${r.doi.unitFactor.toFractionString()} (${r.doi.unitFactor.toDecimal(8)})\n`);

line('═');
console.log(`  STEP 5 · CURATIVE & DEFECTS (${r.curative.length})`);
line();
for (const c of r.curative) {
  console.log(`  [${c.severity.toUpperCase()}] ${c.title}`);
  console.log(`     ${c.detail.replace(/\*\*/g, '')}\n`);
}
