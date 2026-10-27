/**
 * BAL-04, ECO-05: `npm run economy` — a model player over 35 days, written to docs/economy.md:
 * the day each arena opens, the deck's card levels by day, gold earned and spent.
 *
 * The player (ECO-05): wins half the battles, plays 30 minutes a day (a battle and its windows
 * take 3.5 minutes — 8 battles), comes back 3 times a day (every 8 hours) to open chests and
 * take the free one, opens every chest it can, does 2 of the 3 daily quests, upgrades the cards
 * of its deck as soon as it can (the cheapest first), puts new cards of the arena into the deck.
 * Opponents (records, OPP-02) are matchTrophyOffset trophies above the player.
 * `--win 0.55`, `--battles 12` and `--offset 0` change the player.
 */

import { writeFileSync } from 'node:fs';
import { config } from '../src/config';
import {
  addCards,
  addCrowns,
  applyTrophies,
  awardChest,
  battleGold,
  canUpgrade,
  openChest,
  refreshFreeChest,
  startUnlock,
  takeChest,
  takeCrownChest,
  takeFreeChest,
  trophyDelta,
  unlockedCards,
  upgrade,
  upgradeCost,
  type ChestKind,
  type SaveData,
} from '../src/meta';
import { defaultSave } from '../src/meta';
import { CARDS, nextRandom, type CardId } from '../src/sim';

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1] ?? fallback) : fallback;
};
const WIN = arg('win', 0.5);
const BATTLES = arg('battles', 8);
const OFFSET = arg('offset', config.matchTrophyOffset);
const DAYS = 35;
const HOUR = 3_600_000;
const QUEST_GOLD = 2 * 45;

const save: SaveData = defaultSave();
const random = { rng: 12345 };
const opened: Record<number, number> = { 1: 1 };
const goldIn: number[] = [];
const goldUp: number[] = [];
const levelsByDay: Record<number, string> = {};
const gold = { battles: 0, chests: 0, quests: 0, upgrades: 0 };

function grant(kind: ChestKind): void {
  const c = openChest(kind, save.player.arena, random);
  save.gold += c.gold;
  gold.chests += c.gold;
  addCards(save, c.cards);
}

/** The deck: the 8 highest cards of the open arenas (new cards come in as they arrive). */
function rebuildDeck(): void {
  const have = (Object.keys(save.cards) as CardId[]).filter(
    (c) => CARDS[c].arena <= save.player.arena,
  );
  have.sort((a, b) => (save.cards[b]?.level ?? 0) - (save.cards[a]?.level ?? 0));
  save.decks[0] = have.slice(0, 8);
}

function upgradeDeck(): void {
  for (;;) {
    const can = save.decks[0].filter((c) => canUpgrade(save, c));
    if (can.length === 0) return;
    can.sort(
      (a, b) =>
        (upgradeCost(save.cards[a]?.level ?? 1)?.gold ?? 0) -
        (upgradeCost(save.cards[b]?.level ?? 1)?.gold ?? 0),
    );
    const c = can[0] as CardId;
    const cost = upgradeCost(save.cards[c]?.level ?? 1)?.gold ?? 0;
    upgrade(save, c);
    gold.upgrades += cost;
  }
}

function checkIn(now: number): void {
  for (let i = 0; i < save.chests.length; i++) {
    const type = takeChest(save, i, now);
    if (type) grant(type);
  }
  if (!save.chests.some((c) => c?.unlockStartedAt !== null && c !== null)) {
    const slot = save.chests.findIndex((c) => c !== null);
    if (slot >= 0) startUnlock(save, slot, now);
  }
  refreshFreeChest(save, now);
  while (takeFreeChest(save, now)) grant('free');
}

const start = 1_800_000_000_000;
for (let day = 1; day <= DAYS; day++) {
  const dayStart = start + (day - 1) * 24 * HOUR;
  const goldBefore = save.gold;
  const upBefore = gold.upgrades;
  checkIn(dayStart);
  for (let b = 0; b < BATTLES; b++) {
    const won = nextRandom(random) < WIN;
    const outcome = won ? 'win' : 'loss';
    const delta = trophyDelta(outcome, save.player.trophies, save.player.trophies + OFFSET);
    const arena = applyTrophies(save.player, delta);
    if (arena) opened[arena] = day;
    const g = battleGold(outcome, save.player.arena);
    save.gold += g;
    gold.battles += g;
    if (won) awardChest(save, random);
    addCrowns(save, won ? 2 : 1, day);
    if (takeCrownChest(save, day)) grant('crown');
  }
  save.gold += QUEST_GOLD;
  gold.quests += QUEST_GOLD;
  checkIn(dayStart + 8 * HOUR);
  checkIn(dayStart + 16 * HOUR);
  rebuildDeck();
  upgradeDeck();
  goldIn.push(save.gold - goldBefore + (gold.upgrades - upBefore));
  goldUp.push(gold.upgrades - upBefore);
  if ([1, 3, 5, 7, 14, 21, 28, 35].includes(day)) {
    const lv = save.decks[0].map((c) => save.cards[c]?.level ?? 1);
    const avg = lv.reduce((a, b) => a + b, 0) / Math.max(1, lv.length);
    levelsByDay[day] =
      `| ${String(day)} | ${String(save.player.trophies)} | ${String(save.player.arena)} | ${avg.toFixed(1)} | ${String(save.player.level)} | ${String(save.gold)} | ${String(unlockedCards(save.player.arena).filter((c) => save.cards[c]).length)} |`;
  }
}

const target: Record<number, string> = { 2: '1', 3: '3–5', 4: '—', 5: '21–28' };
const ok = (arena: number): string => {
  const d = opened[arena];
  if (d === undefined) return '⚠️ не открылась';
  if (arena === 2) return d <= 1 ? '✅' : '⚠️';
  if (arena === 3) return d >= 3 && d <= 5 ? '✅' : '⚠️';
  if (arena === 5) return d >= 21 && d <= 28 ? '✅' : '⚠️';
  return '';
};
const lines = [
  '# Экономика: модель игрока',
  '',
  `Отчёт \`npm run economy\` (BAL-04, ECO-05). Игрок: ${String(Math.round(WIN * 100))}% побед, ${String(BATTLES)} боёв в день (30 минут), заходит 3 раза в день, соперники на ${String(OFFSET)} кубков выше (OPP-02), 2 задания в день, все бесплатные и коронные сундуки, прокачка колоды при первой возможности.`,
  '',
  '## Открытие арен',
  '',
  '| Арена | День открытия | Цель ECO-05 | |',
  '|---|---|---|---|',
  ...[2, 3, 4, 5].map(
    (a) =>
      `| ${String(a)} | ${opened[a] !== undefined ? String(opened[a]) : `> ${String(DAYS)}`} | ${target[a] ?? ''} | ${ok(a)} |`,
  ),
  '',
  '## По дням',
  '',
  '| День | Кубки | Арена | Ср. уровень колоды | Уровень игрока | Золото на руках | Открытых карт в коллекции |',
  '|---|---|---|---|---|---|---|',
  ...Object.values(levelsByDay),
  '',
  '## Золото за 35 дней',
  '',
  `Бои — ${String(gold.battles)}, сундуки — ${String(gold.chests)}, задания — ${String(gold.quests)}; потрачено на прокачку — ${String(gold.upgrades)}. В среднем в день: получено ${String(Math.round(goldIn.reduce((a, b) => a + b, 0) / DAYS))}, потрачено ${String(Math.round(goldUp.reduce((a, b) => a + b, 0) / DAYS))}.`,
  '',
];
writeFileSync('docs/economy.md', lines.join('\n'));
console.log(lines.slice(4, 20).join('\n'));
console.log('economy: docs/economy.md');
