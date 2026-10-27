/**
 * BAL-05: `npm run sim -- [--seeds 50] [--deck0 a,b,…] [--deck1 a,b,…]` plays a series of battles
 * and prints the results, the average length and the state hash of the first one (SIM-40).
 * Stage 0: there are no cards and no bot yet, so every battle runs its full time to a draw;
 * Stage 1 adds the bots (--bot easy|normal|hard), the card decks and an example log.
 */

import { createBattle, stateHash, step, TICKS_PER_SEC, type CardId } from '../src/sim';
import { STARTER_DECK } from '../src/content';

const argv = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
};
const seeds = Number(opt('seeds', '50'));
const deck = (name: string): CardId[] =>
  opt(name, STARTER_DECK.join(',')).split(',').filter(Boolean) as CardId[];
const decks: [CardId[], CardId[]] = [deck('deck0'), deck('deck1')];

const results = { 0: 0, 1: 0, draw: 0 };
let ticks = 0;
let firstHash = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const s = createBattle({ seed, decks, playerLevels: [1, 1] });
  while (s.phase !== 'ended') step(s, []);
  const w = s.result?.winner;
  if (w === 0 || w === 1) results[w] += 1;
  else results.draw += 1;
  ticks += s.tick;
  if (seed === 1) firstHash = stateHash(s);
}
console.log(`sim: ${String(seeds)} battles, ${decks[0].join(',')} vs ${decks[1].join(',')}`);
console.log(
  `  side 0 won ${String(results[0])}, side 1 won ${String(results[1])}, draws ${String(results.draw)}`,
);
console.log(`  average length ${(ticks / seeds / TICKS_PER_SEC).toFixed(1)} s`);
console.log(`  state hash of seed 1: ${firstHash.toString(16)}`);
