/**
 * BAL-05: `npm run sim -- --deck0 <a,b,…> --deck1 <a,b,…> [--seeds 50] [--bot easy|normal|hard]
 * [--level0 1] [--level1 1]` — a series of battles of two decks played by bots: wins, crowns,
 * fallen keeps, the average length, and the log of the first battle's plays.
 * Without decks both sides take the starting deck (CRD-01).
 * `npm run sim -- --hashes` rewrites tests/fixtures/sim-hashes.json (SIM-40) after a deliberate
 * change of the rules or the bot; `--fixtures` — tests/fixtures/sessions/*.json, battles of bots
 * recorded the way the SDK returns them (YG-21), for LocalPlatform's ?sessions=fixtures.
 */

import { writeFileSync } from 'node:fs';
import { config, type BotKind } from '../src/config';
import { STARTER_DECK } from '../src/content';
import {
  Bot,
  CARD_IDS,
  randomDeck,
  recordedBattle,
  referenceHash,
  runBattle,
  stateHash,
  TICKS_PER_SEC,
  type CardId,
  type CardLevels,
} from '../src/sim';

const argv = process.argv.slice(2);
if (argv.includes('--hashes')) {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const out = Object.fromEntries(seeds.map((s) => [String(s), referenceHash(s)]));
  writeFileSync('tests/fixtures/sim-hashes.json', `${JSON.stringify(out, null, 2)}\n`);
  console.log('sim: tests/fixtures/sim-hashes.json', out);
  process.exit(0);
}
if (argv.includes('--fixtures')) {
  const r = { rng: 77 };
  for (let i = 1; i <= 3; i++) {
    const decks: [CardId[], CardId[]] = [randomDeck(r, 1 + i), randomDeck(r, 1 + i)];
    const b0 = new Bot(0, { react: config.bots.normal, seed: i * 5 + 1 });
    const b1 = new Bot(1, { react: config.bots.normal, seed: i * 5 + 2 });
    const rec = recordedBattle(
      { seed: 500 + i, decks, playerLevels: [1, 1] },
      [(s) => b0.next(s), (s) => b1.next(s)],
      0,
    );
    const session = {
      id: `fixture-${String(i)}`,
      meta: { meta1: 100 * i, meta2: 1, meta3: 1 + i },
      player: { name: `Fixture ${String(i)}`, avatar: '' },
      timeline: rec.timeline.map((e, n) => ({
        id: String(n + 1),
        payload: e.payload,
        time: e.time,
      })),
    };
    writeFileSync(
      `tests/fixtures/sessions/fixture-${String(i)}.json`,
      `${JSON.stringify(session, null, 2)}\n`,
    );
  }
  console.log('sim: tests/fixtures/sessions/fixture-1..3.json');
  process.exit(0);
}
const opt = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
};
const seeds = Number(opt('seeds', '50'));
const bot = opt('bot', 'normal') as BotKind;
if (!(bot in config.bots)) throw new Error(`--bot: ${Object.keys(config.bots).join(', ')}`);
const deck = (name: string): CardId[] => {
  const d = opt(name, STARTER_DECK.join(',')).split(',').filter(Boolean);
  const bad = d.filter((c) => !(CARD_IDS as readonly string[]).includes(c));
  if (bad.length > 0 || d.length !== 8 || new Set(d).size !== 8) {
    throw new Error(`--${name}: 8 different cards of ${CARD_IDS.join(', ')}; got ${d.join(',')}`);
  }
  return d as CardId[];
};
const decks: [CardId[], CardId[]] = [deck('deck0'), deck('deck1')];
const levels = (side: 0 | 1): CardLevels =>
  Object.fromEntries(decks[side].map((c) => [c, Number(opt(`level${String(side)}`, '1'))]));

let wins: [number, number] = [0, 0];
let draws = 0;
let crowns = 0;
let keeps = 0;
let ticks = 0;
const log: string[] = [];
for (let seed = 1; seed <= seeds; seed++) {
  const b0 = new Bot(0, { react: config.bots[bot], seed: seed * 13 + 1 });
  const b1 = new Bot(1, { react: config.bots[bot], seed: seed * 13 + 2 });
  const res = runBattle(
    { seed, decks, cardLevels: [levels(0), levels(1)], playerLevels: [1, 1] },
    [(s) => b0.next(s), (s) => b1.next(s)],
    {
      onEvents: (events, s) => {
        if (seed !== 1) return;
        for (const e of events) {
          if (
            e.type === 'placed' ||
            e.type === 'stacked' ||
            e.type === 'spell' ||
            e.type === 'crown'
          ) {
            const t = ((s.tick - 1) / TICKS_PER_SEC).toFixed(1).padStart(6);
            log.push(`${t} s  ${JSON.stringify(e)}`);
          }
        }
      },
    },
  );
  const s = res.state;
  const w = s.result?.winner;
  if (w === 0 || w === 1) wins = w === 0 ? [wins[0] + 1, wins[1]] : [wins[0], wins[1] + 1];
  else draws += 1;
  if (Math.max(...s.crowns) > 0) crowns += 1;
  if (s.result?.reason === 'keep') keeps += 1;
  ticks += s.tick;
  if (seed === 1)
    log.unshift(`seed 1: ${JSON.stringify(s.result)}, hash ${stateHash(s).toString(16)}`);
}
const pct = (n: number): string => `${((n / seeds) * 100).toFixed(0)}%`;
console.log(`sim: ${String(seeds)} battles, bots "${bot}"`);
console.log(`  deck0 ${decks[0].join(',')} (level ${opt('level0', '1')})`);
console.log(`  deck1 ${decks[1].join(',')} (level ${opt('level1', '1')})`);
console.log(
  `  wins ${String(wins[0])} : ${String(wins[1])}, draws ${String(draws)}; with a crown ${pct(crowns)}, keep fell ${pct(keeps)}`,
);
console.log(`  average length ${(ticks / seeds / TICKS_PER_SEC).toFixed(0)} s`);
console.log(
  `\nlog of the first battle:\n${log.slice(0, 40).join('\n')}${log.length > 40 ? '\n  …' : ''}`,
);
