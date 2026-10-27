/**
 * §3.9: the bot plays through the same actions as the player. It serves the tutorial, the
 * stand-in opponent (OPP-03), the end of a record (OPP-04) and the balance tournaments (§3.10).
 *
 * BOT-01: it decides at most once in `react` ticks: every card in hand it can pay for, on every
 * cell it may take, gets a score (BOT-02); the best pair is played if its score is above the
 * threshold, otherwise the bot saves elixir. BOT-03: its randomness is its own mulberry32 —
 * the simulation never sees it.
 */

import { config, type BotKind } from '../config';
import { cellAllowed, cellIndex, isFort, viewOf, type FieldView } from './battle';
import { nextRandom } from './rng';
import { CARDS, COLS, progress, ROWS, spellAt, stats, TICKS_PER_SEC, UNIT } from './rules';
import type { Action, BattleState, Building, CardId, Side } from './types';

/** BOT-01: a play needs a score above this; otherwise the bot waits for more elixir. */
const THRESHOLD = 0.3;
/** BOT-02: the random addition, 0…0.6. */
const NOISE = 0.6;
/** BOT-01: the bot saves for a card at most this many units away… */
const SAVE_UNITS = 2;
/** …when it scores this much more than the best card it can pay for now. */
const SAVE_MARGIN = 3;

export interface BotOptions {
  /** BOT-01: ticks between decisions (easy 30, normal 14, hard 8). */
  react: number;
  seed: number;
  /** BOT-02: how much the bot likes moving forward. */
  aggression?: number;
}

/** What the bot knows about the field at one decision. */
interface Context {
  s: BattleState;
  side: Side;
  view: FieldView;
  enemies: Building[];
  own: Building[];
  /** Incoming damage per second on every cell (units). */
  threat: Float64Array;
  /** The weakest enemy tower or keep (the bot's aim). */
  aim: Building | null;
  aggression: number;
}

export class Bot {
  private readonly random: { rng: number };
  private readonly aggression: number;

  constructor(
    readonly side: Side,
    private readonly o: BotOptions,
  ) {
    this.random = { rng: o.seed >>> 0 };
    this.aggression = o.aggression ?? 1;
  }

  /** The bot's actions for this tick (an empty list most of the time). */
  next(s: BattleState): Action[] {
    if (s.phase === 'ended') return [];
    // The two sides decide half a period apart, side 0 on even ticks and side 1 on odd ones
    // (the reaction times are even): two bots never pick the same free cell in one tick (T-17).
    const offset = this.side === 0 ? 0 : Math.floor(this.o.react / 2) | 1;
    if (s.tick % this.o.react !== offset) return [];
    const best = decide(context(s, this.side, this.aggression), () => nextRandom(this.random));
    return best ? [best] : [];
  }
}

export const botFor = (kind: BotKind, side: Side, seed: number): Bot =>
  new Bot(side, { react: config.bots[kind], seed });

function context(s: BattleState, side: Side, aggression: number): Context {
  const enemies = s.buildings.filter((b) => b.side !== side);
  const own = s.buildings.filter((b) => b.side === side);
  const threat = new Float64Array(COLS * ROWS);
  for (const e of enemies) {
    const st = stats(e.kind, e.level, e.stars);
    if (st.dmg === 0) continue;
    const dps = st.dmg / UNIT / (st.cooldownTicks / TICKS_PER_SEC);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (reaches(e, st.line, st.minRange2, st.range2, x, y)) threat[cellIndex(x, y)] += dps;
      }
    }
  }
  const forts = enemies.filter((b) => isFort(b.kind));
  const aim = forts.reduce<Building | null>(
    (a, b) => (!a || b.hp < a.hp || (b.hp === a.hp && b.id < a.id) ? b : a),
    null,
  );
  return { s, side, view: viewOf(s), enemies, own, threat, aim, aggression };
}

/** Whether a shooter at `from` reaches the cell (x, y). */
function reaches(
  from: { side: Side; x: number; y: number },
  line: number,
  min2: number,
  max2: number,
  x: number,
  y: number,
): boolean {
  if (line > 0) {
    if (x !== from.x) return false;
    const ahead = from.side === 0 ? from.y - y : y - from.y;
    return ahead >= 1 && ahead <= line;
  }
  const d = ((x - from.x) ** 2 + (y - from.y) ** 2) * 100;
  return d >= min2 && d <= max2;
}

const cheb = (a: { x: number; y: number }, x: number, y: number): number =>
  Math.max(Math.abs(a.x - x), Math.abs(a.y - y));

function decide(c: Context, random: () => number): Action | null {
  const { s, side } = c;
  let best: { score: number; card: CardId; x: number; y: number } | null = null;
  // The best card it cannot pay for yet: worth saving elixir for (BOT-01 "otherwise it saves").
  let wish: { score: number; missing: number } | null = null;
  const seen = new Set<CardId>();
  for (const card of s.hand[side]) {
    if (seen.has(card)) continue;
    seen.add(card);
    const missing = CARDS[card].cost * UNIT - s.elixir[side];
    if (missing > SAVE_UNITS * UNIT) continue;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!cellAllowed(s, side, card, x, y, c.view)) continue;
        const score = evaluate(c, card, x, y) + random() * NOISE;
        if (missing > 0) {
          if (!wish || score > wish.score) wish = { score, missing };
        } else if (!best || score > best.score) best = { score, card, x, y };
      }
    }
  }
  // Cheap cards always score above the threshold; without this the bot never gathers enough
  // for a 5–7 elixir card (the tournament showed mortars and catapults almost never played).
  // …but never while its own towers or keep are under fire: then it defends with what it has.
  const underFire = c.own.some((b) => isFort(b.kind) && (c.threat[cellIndex(b.x, b.y)] ?? 0) > 0);
  if (wish && !underFire && wish.score > (best?.score ?? THRESHOLD) + SAVE_MARGIN) return null;
  if (!best || best.score <= THRESHOLD) return null;
  return { type: 'play', side, card: best.card, x: best.x, y: best.y };
}

/** BOT-02: the starting formula of §3.9, per kind of card. */
function evaluate(c: Context, card: CardId, x: number, y: number): number {
  const { s, side } = c;
  const def = CARDS[card];
  const level = s.setup.cardLevels?.[side][card] ?? 1;
  const thr = c.threat[cellIndex(x, y)] ?? 0;
  const prog = progress(side, y);
  const dist = c.aim ? Math.hypot(c.aim.x - x, c.aim.y - y) : 9;
  if (def.spell) return spellScore(c, card, level, x, y);
  const o = c.view.occ[cellIndex(x, y)] ?? 0;
  if (o > 0) {
    // Stacking: more when the building is under fire or damaged; shooters gain more.
    const b = s.buildings[o - 1] as Building;
    const lost = (b.maxHp - b.hp) / b.maxHp;
    return 1 + (thr > 0 ? 2 : 0) + 2 * lost + (def.dmg > 0 ? 1 : 0);
  }
  const st = stats(card, level, 1);
  if (st.dmg > 0) {
    let reach = 0;
    for (const e of c.enemies) {
      if (reaches({ side, x, y }, st.line, st.minRange2, st.range2, e.x, e.y)) {
        reach += isFort(e.kind) ? 3 : 1;
      }
    }
    const survive = Math.min(st.maxHp / UNIT / (thr + 1) / 20, 2);
    return reach * 1.2 + survive - def.cost * 0.3 + prog * 0.15 * c.aggression;
  }
  switch (card) {
    case 'wall': {
      // A shield right in front of own shooters (the cell behind it is theirs).
      const behind = y + (side === 0 ? 1 : -1);
      const shield = c.own.filter(
        (b) => b.x === x && b.y === behind && stats(b.kind, b.level, b.stars).dmg > 0,
      ).length;
      return prog * 0.35 * c.aggression + shield - 0.2 * dist;
    }
    case 'outpost':
      return prog * 0.4 * c.aggression - 0.2 * dist - thr / 30;
    case 'workshop':
      return (s.tick < 60 * TICKS_PER_SEC ? 2.5 : 0.5) - thr / 20 - prog * 0.3;
    default: {
      // Banner, dome, healer: worth as many own shooters around them.
      const near = c.own.filter(
        (b) => !isFort(b.kind) && cheb(b, x, y) === 1 && stats(b.kind, b.level, b.stars).dmg > 0,
      ).length;
      return near * 1.1 - 0.8 - thr / 40;
    }
  }
}

/** BOT-02: spells — the total effect over the cost, / 25, minus 2 (repair: minus 1.5). */
function spellScore(c: Context, card: CardId, level: number, x: number, y: number): number {
  const sp = spellAt(card, level);
  const [x0, y0] = sp.anchor === 'corner' ? [x, y] : [x - 1, y - 1];
  let value = 0;
  for (const b of c.s.buildings) {
    if (b.x < x0 || b.x >= x0 + sp.area[0] || b.y < y0 || b.y >= y0 + sp.area[1]) continue;
    if (sp.heal > 0) {
      if (b.side === c.side) value += Math.min(sp.heal, b.maxHp - b.hp);
    } else if (b.side !== c.side) {
      value += isFort(b.kind) ? sp.towerDmg : sp.heavyKinds.includes(b.kind) ? sp.heavyDmg : sp.dmg;
    }
  }
  const cost = CARDS[card].cost;
  return value / UNIT / cost / 25 - (sp.heal > 0 ? 1.5 : 2);
}

/**
 * BOT-04: the tutorial bot — a script of plays at fixed ticks (in its own system of
 * coordinates) and otherwise nothing.
 */
export class ScriptBot {
  private i = 0;

  constructor(
    readonly side: Side,
    private readonly script: readonly { tick: number; card: CardId; x: number; y: number }[],
  ) {}

  next(s: BattleState): Action[] {
    const out: Action[] = [];
    while (this.i < this.script.length && (this.script[this.i]?.tick ?? 0) <= s.tick) {
      const p = this.script[this.i] as { card: CardId; x: number; y: number };
      this.i += 1;
      const x = this.side === 0 ? p.x : COLS - 1 - p.x;
      const y = this.side === 0 ? p.y : ROWS - 1 - p.y;
      out.push({ type: 'play', side: this.side, card: p.card, x, y, record: true });
    }
    return out;
  }
}
