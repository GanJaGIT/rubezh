/**
 * SIM-42: `npm run bench` — one tick on a field filled with buildings (70: every cell), all
 * of them shooting, with banners, domes and healers among them — under 0.2 ms on an average
 * computer. Hit points are huge so nothing falls during the run.
 */

import { performance } from 'node:perf_hooks';
import { COLS, createBattle, ROWS, stats, step, type Building, type CardId } from '../src/sim';

const LIMIT_MS = 0.2;
const TICKS = 20_000;
const MIX: CardId[] = [
  'cannon',
  'archers',
  'mortar',
  'banner',
  'ice',
  'healer',
  'ballista',
  'dome',
  'watch',
  'catapult',
];

const s = createBattle({ seed: 1, decks: [[], []], playerLevels: [1, 1] });
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (s.buildings.some((b) => b.x === x && b.y === y)) continue;
    const kind = MIX[(x + y * COLS) % MIX.length] as CardId;
    const b: Building = {
      id: s.nextId++,
      side: y < ROWS / 2 ? 1 : 0,
      kind,
      x,
      y,
      hp: 1e12,
      maxHp: 1e12,
      stars: 1,
      level: 1,
      cooldown: 0,
      slowTicks: 0,
    };
    s.buildings.push(b);
  }
}
for (const b of s.buildings) {
  b.maxHp = 1e12;
  b.hp = 1e12;
}
const n = s.buildings.length;
const shooters = s.buildings.filter((b) => stats(b.kind, 1, 1).dmg > 0).length;
// The battle ends after 4 minutes: start over from a copy when it does.
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
  `bench: ${String(n)} buildings (${String(shooters)} shooting), ${ms.toFixed(4)} ms per tick (limit ${String(LIMIT_MS)} ms) — ${ms <= LIMIT_MS ? 'OK' : 'SLOW'}`,
);
process.exit(ms <= LIMIT_MS ? 0 : 1);
