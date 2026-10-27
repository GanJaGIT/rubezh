/**
 * The battle numbers from src/content/*.json turned into the simulation's units: ticks (SIM-01)
 * and thousandths (SIM-04). Content changes only in the JSON (§0); the code reads it here.
 */

import { config } from '../config';
import battle from '../content/battle.json';
import cards from '../content/cards.json';
import progression from '../content/progression.json';
import towers from '../content/towers.json';
import type { BuildingKind, CardId, Side } from './types';

export const COLS = 7;
export const ROWS = 10;
export const CELLS = COLS * ROWS;
export const TICKS_PER_SEC = 1000 / config.tickMs;
/** SIM-04: one unit (of elixir, of hit points) is 1000. */
export const UNIT = 1000;

export const secToTicks = (sec: number): number => Math.round(sec * TICKS_PER_SEC);

export type Rarity = 'common' | 'rare' | 'epic';

/** §3.12: the effects of a card. */
export type Effect =
  | { type: 'buffDamage'; value: number }
  | { type: 'reduceDamage'; value: number }
  | { type: 'heal'; perSecond: number }
  | { type: 'elixir'; everySec: number }
  | { type: 'zone'; radius: number }
  | { type: 'splash'; ratio: number }
  | { type: 'slow'; ratio: number; sec: number }
  | { type: 'line'; length: number };

/** §3.12, SIM-21: a spell — its area, its anchor and what it does to whom. */
export interface SpellDef {
  area: [number, number];
  /** "corner": the cell played is the top left one (fireball); "center": the middle one. */
  anchor: 'corner' | 'center';
  heal?: number;
  dmg?: number;
  /** Damage to the keep and the towers. */
  towerDmg?: number;
  /** Damage to these kinds instead of `dmg` (quake: walls and outposts). */
  heavyDmg?: number;
  heavyKinds?: string[];
}

/** §2.7, §3.12: a card as stored in src/content/cards.json. */
export interface CardDef {
  id: CardId;
  cost: number;
  rarity: Rarity;
  arena: number;
  hp: number;
  dmg: number;
  cooldown: number;
  range: number;
  minRange: number;
  effects: Effect[];
  spell?: SpellDef;
}

export const CARDS: Readonly<Record<CardId, CardDef>> = Object.fromEntries(
  (cards as CardDef[]).map((c) => [c.id, c]),
) as Record<CardId, CardDef>;

export const isSpell = (card: CardId): boolean => CARDS[card].spell !== undefined;

export function effect<T extends Effect['type']>(
  kind: BuildingKind,
  type: T,
): Extract<Effect, { type: T }> | undefined {
  if (kind === 'keep' || kind === 'tower') return undefined;
  return CARDS[kind].effects.find((e): e is Extract<Effect, { type: T }> => e.type === type);
}

export interface StaticStats {
  hp: number;
  dmg: number;
  cooldown: number;
  range: number;
}

export const RULES = {
  mainTicks: secToTicks(battle.mainSec),
  doubleFromTick: secToTicks(battle.doubleElixirFromSec),
  overtimeTicks: secToTicks(battle.overtimeSec),
  elixirStart: battle.elixir.start * UNIT,
  elixirMax: battle.elixir.max * UNIT,
  /** GD-20: ticks per unit of elixir (56); twice as fast from 2:00. */
  regenTicks: secToTicks(battle.elixir.regenSec),
  regenSec: battle.elixir.regenSec,
  deployTicks: secToTicks(battle.deploySec),
  handSize: battle.handSize,
  tower: towers.tower as StaticStats,
  keep: towers.keep as StaticStats,
  playerLevelGrowthPercent: towers.playerLevelGrowthPercent,
  cardLevelPercent: progression.cardLevelPercent,
  keepAt: towers.layout.keep as [number, number],
  towersAt: towers.layout.towers as [number, number][],
  /** GD-40: a side's two back rows are always its zone. */
  backRows: 2,
  /** GD-50 */
  maxStars: 3,
} as const;

/**
 * CRD-03, LVL-04: a value grown by `percent` per level above 1, rounded to a whole number at
 * every step. Integer arithmetic only — Math.pow may differ between engines, and the result
 * must not (SIM-40).
 */
export function grow(base: number, level: number, percent: number): number {
  let v = base;
  for (let i = 1; i < level; i++) v = Math.floor((v * percent + 50) / 100);
  return v;
}

/** GD-50: ×1 for one star, ×1.5 for two, ×2 for three, in thousandths, rounded down. */
export const byStars = (v: number, stars: number): number => Math.floor((v * (stars + 1)) / 2);

/** GD-10: a cell in a side's own system → side 0's system (side 1 is turned by 180°). */
export function toBoard(side: Side, x: number, y: number): { x: number; y: number } {
  return side === 0 ? { x, y } : { x: COLS - 1 - x, y: ROWS - 1 - y };
}

/** The rows a building has moved towards the enemy (0 on its own back row). */
export const progress = (side: Side, y: number): number => (side === 0 ? ROWS - 1 - y : y);

/**
 * What a building does at its level and stars, in the simulation's units. The keep and the
 * towers grow with the player's level (LVL-04), cards with the card's level (CRD-03); stars add
 * +50% hit points, damage, healing and banner bonus each (GD-50). Cached: the same few kinds,
 * levels and stars come again and again.
 */
export interface KindStats {
  /** Thousandths of a hit point. */
  maxHp: number;
  /** Thousandths per shot; 0 — the building does not shoot (GD-49). */
  dmg: number;
  cooldownTicks: number;
  /** Squared range and minimum range, in hundredths of a cell squared (Euclid between centres). */
  range2: number;
  minRange2: number;
  /** BAL-style numbers for the bot: range in cells. */
  range: number;
  splashPm: number;
  slowTicks: number;
  slowPm: number;
  line: number;
  buffPm: number;
  reducePm: number;
  /** Thousandths of a hit point per tick (SIM-12). */
  healPerTick: number;
  elixirEveryTicks: number;
  zoneRadius: number;
}

const cache = new Map<string, KindStats>();
const sq100 = (cells: number): number => Math.round(cells * cells * 100);

export function stats(kind: BuildingKind, level: number, stars: number): KindStats {
  const key = `${kind}:${String(level)}:${String(stars)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let s: KindStats;
  if (kind === 'keep' || kind === 'tower') {
    const t = kind === 'keep' ? RULES.keep : RULES.tower;
    const g = (v: number): number => grow(v, level, RULES.playerLevelGrowthPercent) * UNIT;
    s = {
      maxHp: g(t.hp),
      dmg: g(t.dmg),
      cooldownTicks: secToTicks(t.cooldown),
      range2: sq100(t.range),
      minRange2: 0,
      range: t.range,
      splashPm: 0,
      slowTicks: 0,
      slowPm: 0,
      line: 0,
      buffPm: 0,
      reducePm: 0,
      healPerTick: 0,
      elixirEveryTicks: 0,
      zoneRadius: 1,
    };
  } else {
    const c = CARDS[kind];
    const g = (v: number): number => grow(v, level, RULES.cardLevelPercent);
    const splash = effect(kind, 'splash');
    const slow = effect(kind, 'slow');
    const heal = effect(kind, 'heal');
    const buff = effect(kind, 'buffDamage');
    const reduce = effect(kind, 'reduceDamage');
    const elixir = effect(kind, 'elixir');
    s = {
      maxHp: byStars(g(c.hp) * UNIT, stars),
      dmg: byStars(g(c.dmg) * UNIT, stars),
      cooldownTicks: secToTicks(c.cooldown),
      range2: sq100(c.range),
      minRange2: sq100(c.minRange),
      range: c.range,
      splashPm: splash ? Math.round(splash.ratio * 1000) : 0,
      slowTicks: slow ? secToTicks(slow.sec) : 0,
      slowPm: slow ? Math.round(slow.ratio * 1000) : 0,
      line: effect(kind, 'line')?.length ?? 0,
      // CRD-03 grows the banner bonus with the level, GD-50 with the stars.
      buffPm: buff ? byStars(g(Math.round(buff.value * 1000)), stars) : 0,
      // The dome's 40% stays 40%: only healing and the banner bonus grow (PROGRESS.md).
      reducePm: reduce ? Math.round(reduce.value * 1000) : 0,
      healPerTick: heal ? byStars((g(heal.perSecond) * UNIT) / TICKS_PER_SEC, stars) : 0,
      elixirEveryTicks: elixir ? secToTicks(elixir.everySec) : 0,
      zoneRadius: effect(kind, 'zone')?.radius ?? 1,
    };
  }
  cache.set(key, s);
  return s;
}

/** CRD-03: a spell's numbers at the card's level, in thousandths. */
export function spellAt(
  card: CardId,
  level: number,
): Required<Omit<SpellDef, 'heavyKinds'>> & {
  heavyKinds: string[];
} {
  const sp = CARDS[card].spell as SpellDef;
  const g = (v: number | undefined): number =>
    v === undefined ? 0 : grow(v, level, RULES.cardLevelPercent) * UNIT;
  return {
    area: sp.area,
    anchor: sp.anchor,
    heal: g(sp.heal),
    dmg: g(sp.dmg),
    towerDmg: g(sp.towerDmg),
    heavyDmg: g(sp.heavyDmg),
    heavyKinds: sp.heavyKinds ?? [],
  };
}

/** The projectile a shooter fires (SIM-50, FX-02). */
export function projectileOf(kind: BuildingKind): 'arrow' | 'ball' | 'stone' | 'bolt' | 'shard' {
  switch (kind) {
    case 'cannon':
      return 'ball';
    case 'mortar':
    case 'catapult':
      return 'stone';
    case 'ballista':
      return 'bolt';
    case 'ice':
      return 'shard';
    default:
      return 'arrow';
  }
}

/** REP-01: the most elixir a side can gain in `ms` of battle (without workshops). */
export function elixirPossible(ms: number): number {
  const sec = ms / 1000;
  const main = Math.min(sec, battle.doubleElixirFromSec);
  const double = Math.max(0, sec - battle.doubleElixirFromSec);
  return main / RULES.regenSec + (double * 2) / RULES.regenSec;
}
