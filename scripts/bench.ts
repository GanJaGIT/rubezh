/**
 * SIM-42: `npm run bench` — the time of one tick on a field full of buildings (70 of them) must
 * stay under 0.2 ms on an average computer. Stage 0 measures the frame of the simulation; the
 * same field gets shooting buildings in Stage 1, and the bound stays.
 */

import { performance } from 'node:perf_hooks';
import { COLS, createBattle, ROWS, step, type Building } from '../src/sim';

const LIMIT_MS = 0.2;
const TICKS = 20_000;

const s = createBattle({ seed: 1, decks: [[], []], playerLevels: [1, 1] });
const proto = s.buildings[0] as Building;
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (s.buildings.some((b) => b.x === x && b.y === y)) continue;
    s.buildings.push({ ...proto, id: s.nextId++, kind: 'cannon', x, y, side: y < 5 ? 1 : 0 });
  }
}
const n = s.buildings.length;
// Warm-up, then the measured run (the battle ends after 4 minutes: start over when it does).
let state = structuredClone(s);
const tickAll = (count: number): void => {
  for (let i = 0; i < count; i++) {
    if (state.phase === 'ended') state = structuredClone(s);
    step(state, []);
  }
};
tickAll(2000);
const started = performance.now();
tickAll(TICKS);
const ms = (performance.now() - started) / TICKS;
console.log(
  `bench: ${String(n)} buildings, ${ms.toFixed(4)} ms per tick (limit ${String(LIMIT_MS)} ms)`,
);
process.exit(ms <= LIMIT_MS ? 0 : 1);
