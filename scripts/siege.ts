/**
 * Siege bot tournament: how long battles last and who wins (docs/DESIGN-v2.md, sections 4 and 7).
 * npm run siege -- [battles] [levelA] [levelB]
 */

import { botActions, type BotLevel } from '../src/siege/bot';
import { BKINDS, createSiege, stepSiege, TICK_MS, type BKind } from '../src/siege/sim';

const n = Number(process.argv[2] ?? 40);
const la = (process.argv[3] ?? 'normal') as BotLevel;
const lb = (process.argv[4] ?? 'normal') as BotLevel;
const deck: BKind[] = BKINDS.filter((k) => k !== 'tesla');

const wins = [0, 0, 0];
const waves: number[] = [];
const secs: number[] = [];
const tiers = [0, 0, 0, 0, 0];
let kills = 0;
let horns = 0;
for (let i = 0; i < n; i++) {
  const st = createSiege({ seed: 1000 + i, decks: [deck, deck] });
  while (!st.result && st.tick < 20 * 60 * 20) {
    stepSiege(st, [...botActions(st, 0, la), ...botActions(st, 1, lb)]);
  }
  const w = st.result?.winner;
  wins[w === undefined || w === null ? 2 : w]++;
  waves.push(st.wave);
  secs.push((st.tick * TICK_MS) / 1000);
  for (const s of st.sides) {
    for (const b of s.cells) if (b) tiers[b.tier]++;
    kills += s.kills;
    horns += s.hornUses;
  }
}
const avg = (a: number[]): string => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
const sorted = [...secs].sort((a, b) => a - b);
console.log(`${String(n)} battles, ${la} vs ${lb}`);
console.log(`wins A/B/draw: ${wins.join(' / ')}`);
console.log(
  `end wave avg ${avg(waves)}, min ${String(Math.min(...waves))}, max ${String(Math.max(...waves))}`,
);
console.log(`length s: avg ${avg(secs)}, median ${String(sorted[Math.floor(n / 2)])}`);
console.log(`buildings at end by tier 1..4: ${tiers.slice(1).join(' / ')}`);
console.log(
  `kills per side ${(kills / n / 2).toFixed(0)}, horns per side ${(horns / n / 2).toFixed(1)}`,
);
