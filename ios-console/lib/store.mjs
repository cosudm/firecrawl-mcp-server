// @ts-check
/**
 * Node store — wraps the pure StoreCore with seed loading + JSON-file snapshot.
 *
 * Default backend is in-memory, seeded from lib/seed.mjs and snapshotted to
 * ./.data/state.json so mutations survive restarts (the MVP runs with zero infra).
 * Set CONSOLE_STATE_FILE to relocate the snapshot, or IOS_NO_PERSIST=1 to disable.
 * The compliance_* / doi_* schema maps 1:1, so a Postgres backend can replace this
 * behind the same StoreCore method surface.
 *
 * @typedef {import('./store-core.mjs').StoreCore} ConsoleStateOwner
 * @typedef {{obligations:any[],scan_history:any[],discoveries:any[],monitors:any[],projects:any[],activity:any[]}} ConsoleState
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoreCore } from './store-core.mjs';
import { buildSeed } from './seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(HERE, '..', '.data', 'state.json');

export class Store extends StoreCore {
  /** @param {{ file?: string, persist?: boolean, clock?: () => string }} [opts] */
  constructor(opts = {}) {
    const file = opts.file ?? process.env.CONSOLE_STATE_FILE ?? DEFAULT_FILE;
    const persist = opts.persist ?? process.env.IOS_NO_PERSIST !== '1';
    let initial = buildSeed();
    if (persist && existsSync(file)) {
      try { initial = JSON.parse(readFileSync(file, 'utf8')); } catch { /* corrupt → seed */ }
    }
    super(initial, {
      clock: opts.clock,
      seedFn: buildSeed,
      save: persist ? (state) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(state, null, 2)); } : null,
    });
  }
}
