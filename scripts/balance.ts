/**
 * BAL-01…BAL-03: `npm run balance` — the tournament of normal bots writing docs/balance.md:
 * 1000 battles of random decks and 300 of the bot decks (BAL-01), the level tournament — decks
 * two levels up (BAL-03) — and the start levels of rare and epic cards (CRD-11).
 * `npm run balance -- --quick` — 100 battles with the invariants checked, no report: the short
 * tournament of `npm run verify` (QA-05). Cards outside the corridor are warnings, not failures.
 */

import { writeFileSync } from 'node:fs';
import botDecks from '../src/content/bot-decks.json';
import progression from '../src/content/progression.json';
import { config } from '../src/config';
import {
  Bot,
  CARD_IDS,
  CARDS,
  randomDeck,
  randomInt,
  runBattle,
  TICKS_PER_SEC,
  type BattleState,
  type CardId,
  type CardLevels,
} from '../src/sim';

const quick = process.argv.includes('--quick');
const REACT = config.bots.normal;

interface Tally {
  battles: number;
  crowned: number;
  keeps: number;
  draws: number;
  ticks: number;
  stacks: number;
  buildings: number;
  enemyHalf: number;
  invalid: number;
  broken: string[];
  plays: Map<CardId, number>;
  wins: Map<CardId, number>;
}

const tally = (): Tally => ({
  battles: 0,
  crowned: 0,
  keeps: 0,
  draws: 0,
  ticks: 0,
  stacks: 0,
  buildings: 0,
  enemyHalf: 0,
  invalid: 0,
  broken: [],
  plays: new Map(),
  wins: new Map(),
});

function battle(
  t: Tally,
  seed: number,
  decks: [CardId[], CardId[]],
  levels?: [CardLevels, CardLevels],
): BattleState {
  const b0 = new Bot(0, { react: REACT, seed: seed * 13 + 1 });
  const b1 = new Bot(1, { react: REACT, seed: seed * 13 + 2 });
  const res = runBattle(
    { seed, decks, cardLevels: levels, playerLevels: [1, 1] },
    [(s) => b0.next(s), (s) => b1.next(s)],
    { checkInvariants: quick },
  );
  const s = res.state;
  t.battles += 1;
  t.invalid += res.invalid[0] + res.invalid[1];
  t.broken.push(...res.broken);
  if (Math.max(...s.crowns) > 0) t.crowned += 1;
  if (s.result?.reason === 'keep') t.keeps += 1;
  if (s.result?.winner === null) t.draws += 1;
  t.ticks += s.tick;
  for (const side of [0, 1] as const) {
    const st = s.stats[side];
    t.stacks += st.stacks;
    t.enemyHalf += st.enemyHalf;
    // Buildings placed: every play but the spells and the stacks.
    t.buildings += st.played - st.stacks;
    for (const c of new Set(decks[side])) {
      t.plays.set(c, (t.plays.get(c) ?? 0) + 1);
      // A draw counts as half a win for both decks.
      const w = s.result?.winner;
      const score = w === side ? 1 : w === null ? 0.5 : 0;
      t.wins.set(c, (t.wins.get(c) ?? 0) + score);
    }
  }
  return s;
}

const share = (n: number, of: number): string => `${((n / Math.max(1, of)) * 100).toFixed(0)}%`;
const inside = (v: number, lo: number, hi: number): string => (v >= lo && v <= hi ? '✅' : '⚠️');

if (quick) {
  const t = tally();
  const r = { rng: 1 };
  for (let i = 0; i < 100; i++) battle(t, i + 1, [randomDeck(r), randomDeck(r)]);
  console.log(
    `balance --quick: ${String(t.battles)} battles, invalid ${String(t.invalid)}, broken invariants ${String(t.broken.length)}; with a crown ${share(t.crowned, t.battles)}, ${(t.ticks / t.battles / TICKS_PER_SEC).toFixed(0)} s`,
  );
  process.exit(t.invalid === 0 && t.broken.length === 0 ? 0 : 1);
}

const started = Date.now();
// BAL-01: random decks.
const main = tally();
const r = { rng: 2026 };
for (let i = 0; i < 1000; i++) battle(main, i + 1, [randomDeck(r), randomDeck(r)]);
// BAL-01: the bot decks of each arena against each other.
const bots = tally();
const byArena = botDecks as Record<string, CardId[][]>;
const rb = { rng: 7 };
for (let i = 0; i < 300; i++) {
  const arena = String(1 + (i % 5));
  const pool = byArena[arena] as CardId[][];
  const a = pool[randomInt(rb, pool.length)] as CardId[];
  const b = pool[randomInt(rb, pool.length)] as CardId[];
  battle(bots, 5000 + i, [[...a], [...b]]);
}
// BAL-03: the same random deck, one side two levels up.
const lv = tally();
let upWins = 0;
let upDraws = 0;
const rl = { rng: 33 };
for (let i = 0; i < 300; i++) {
  const deck = randomDeck(rl);
  const base = 1 + randomInt(rl, 5);
  const at = (n: number): CardLevels => Object.fromEntries(deck.map((c) => [c, n]));
  const up = (i % 2) as 0 | 1;
  const levels: [CardLevels, CardLevels] =
    up === 0 ? [at(base + 2), at(base)] : [at(base), at(base + 2)];
  const s = battle(lv, 8000 + i, [[...deck], [...deck]], levels);
  if (s.result?.winner === up) upWins += 1;
  else if (s.result?.winner === null) upDraws += 1;
}
// CRD-11: every card at the level it joins the collection (common 1, rare 3, epic 6).
const startLv = tally();
const rs = { rng: 44 };
const startLevels = (deck: CardId[]): CardLevels =>
  Object.fromEntries(deck.map((c) => [c, progression.startLevel[CARDS[c].rarity]]));
for (let i = 0; i < 300; i++) {
  const d0 = randomDeck(rs);
  const d1 = randomDeck(rs);
  battle(startLv, 9000 + i, [d0, d1], [startLevels(d0), startLevels(d1)]);
}

const sec = (t: Tally): number => t.ticks / t.battles / TICKS_PER_SEC;
const crowned = main.crowned / main.battles;
const keeps = main.keeps / main.battles;
const rate = (t: Tally, c: CardId): number =>
  (t.wins.get(c) ?? 0) / Math.max(1, t.plays.get(c) ?? 0);
const outside = CARD_IDS.filter((c) => rate(main, c) < 0.44 || rate(main, c) > 0.56);
const upRate = (upWins + upDraws / 2) / lv.battles;

const lines: string[] = [
  '# Баланс: турнир ботов',
  '',
  `Отчёт \`npm run balance\` (BAL-01…BAL-03, CRD-11). Боты «средние» (решение раз в ${String(REACT)} тиков), уровни карт 1, если не сказано иное. Ничья засчитывается колодам как половина победы. Время прогона — ${String(Math.round((Date.now() - started) / 1000))} с.`,
  '',
  '## BAL-01: 1000 боёв случайных колод',
  '',
  '| Показатель | Цель | Сейчас | |',
  '|---|---|---|---|',
  `| Бои хотя бы с одной короной | ≥ 70% | ${share(main.crowned, main.battles)} | ${crowned >= 0.7 ? '✅' : '⚠️'} |`,
  `| Бои, где пала крепость | 10–30% | ${share(main.keeps, main.battles)} | ${inside(keeps, 0.1, 0.3)} |`,
  `| Средняя длительность | 150–220 с | ${sec(main).toFixed(0)} с | ${inside(sec(main), 150, 220)} |`,
  `| Ничьи | — | ${share(main.draws, main.battles)} | |`,
  `| Наложений за бой (обе стороны) | наблюдение | ${(main.stacks / main.battles).toFixed(1)} | |`,
  `| Построек на чужой половине | наблюдение | ${share(main.enemyHalf, main.buildings)} | |`,
  `| Недопустимых действий ботов | 0 | ${String(main.invalid)} | ${main.invalid === 0 ? '✅' : '⚠️'} |`,
  '',
  '### Доля побед колод с картой (коридор 0,44–0,56)',
  '',
  '| Карта | Порох | Редкость | Доля побед | Боёв | |',
  '|---|---|---|---|---|---|',
  ...[...CARD_IDS]
    .sort((a, b) => rate(main, b) - rate(main, a))
    .map(
      (c) =>
        `| ${c} | ${String(CARDS[c].cost)} | ${CARDS[c].rarity} | ${rate(main, c).toFixed(2)} | ${String(main.plays.get(c) ?? 0)} | ${inside(rate(main, c), 0.44, 0.56)} |`,
    ),
  '',
  outside.length > 0
    ? `Вне коридора: ${outside.map((c) => `${c} (${rate(main, c).toFixed(2)})`).join(', ')}.`
    : 'Все карты в коридоре.',
  '',
  '## BAL-01: 300 боёв колод ботов (bot-decks.json, внутри одной арены)',
  '',
  `С короной — ${share(bots.crowned, bots.battles)}, крепость пала — ${share(bots.keeps, bots.battles)}, средняя длительность — ${sec(bots).toFixed(0)} с, ничьих — ${share(bots.draws, bots.battles)}.`,
  '',
  '## BAL-03: турнир уровней (300 боёв, та же колода, у одной стороны +2 уровня)',
  '',
  `Колода на 2 уровня выше набирает ${(upRate * 100).toFixed(0)}% (цель 65–80%) ${inside(upRate, 0.65, 0.8)}. Побед ${String(upWins)}, ничьих ${String(upDraws)}.`,
  '',
  '## CRD-11: карты на уровне, с которым приходят в коллекцию (обычные 1, редкие 3, эпические 6)',
  '',
  '| Редкость | Средняя доля побед колод с картой |',
  '|---|---|',
  ...(['common', 'rare', 'epic'] as const).map((rar) => {
    const cs = CARD_IDS.filter((c) => CARDS[c].rarity === rar);
    const avg = cs.reduce((n, c) => n + rate(startLv, c), 0) / cs.length;
    return `| ${rar} | ${avg.toFixed(2)} |`;
  }),
  '',
  'Карты на стартовом уровне редкости:',
  '',
  ...[...CARD_IDS]
    .sort((a, b) => rate(startLv, b) - rate(startLv, a))
    .map((c) => `- ${c} (${CARDS[c].rarity}): ${rate(startLv, c).toFixed(2)}`),
  '',
];
writeFileSync('docs/balance.md', lines.join('\n'));
console.log(lines.slice(4, 14).join('\n'));
console.log(
  outside.length > 0
    ? `WARN outside the corridor: ${outside.join(', ')}`
    : 'all cards in the corridor',
);
console.log(`BAL-03: +2 levels win ${(upRate * 100).toFixed(0)}%`);
console.log('balance: docs/balance.md');
