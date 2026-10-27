/**
 * The battle simulation (§3). Pure TypeScript: no engine, no browser, no clock and no global
 * random — the architecture test checks it. One call of step() is one tick (SIM-01), in the order
 * of §3.3. Stage 0 has the frame: the keeps and towers, elixir, time, the end of the battle and
 * surrender; cards, shooting and crowns come in Stage 1.
 */

import { fnv1a, randomInt } from './rng';
import { COLS, grow, ROWS, RULES, toBoard, type StaticStats } from './rules';
import type {
  Action,
  BattleEvent,
  BattleResult,
  BattleSetup,
  BattleState,
  BuildingKind,
  CardId,
  Side,
} from './types';

const SIDES: readonly Side[] = [0, 1];

export function createBattle(setup: BattleSetup): BattleState {
  const s: BattleState = {
    setup,
    tick: 0,
    phase: 'main',
    rng: setup.seed >>> 0,
    buildings: [],
    nextId: 1,
    elixir: [RULES.elixirStart, RULES.elixirStart],
    elixirAcc: [0, 0],
    workshopAcc: [0, 0],
    deck: [[], []],
    hand: [[], []],
    crowns: [0, 0],
    result: null,
  };
  // GD-11: the keep and two towers of each side, in its own system.
  for (const side of SIDES) {
    const level = setup.playerLevels[side];
    addStatic(s, side, 'keep', RULES.keepAt, RULES.keep, level);
    for (const at of RULES.towersAt) addStatic(s, side, 'tower', at, RULES.tower, level);
  }
  // GD-30: each deck is shuffled by the battle seed; the first cards are the hand.
  for (const side of SIDES) {
    const deck = shuffle(s, [...setup.decks[side]]);
    s.hand[side] = deck.slice(0, RULES.handSize);
    s.deck[side] = deck.slice(RULES.handSize);
  }
  return s;
}

function addStatic(
  s: BattleState,
  side: Side,
  kind: BuildingKind,
  at: [number, number],
  base: StaticStats,
  level: number,
): void {
  const { x, y } = toBoard(side, at[0], at[1]);
  const hp = grow(base.hp, level, RULES.playerLevelGrowthPercent);
  s.buildings.push({
    id: s.nextId++,
    side,
    kind,
    x,
    y,
    hp,
    maxHp: hp,
    stars: 1,
    level,
    cooldown: RULES.deployTicks,
    slowTicks: 0,
  });
}

function shuffle(s: BattleState, cards: CardId[]): CardId[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(s, i + 1);
    [cards[i], cards[j]] = [cards[j] as CardId, cards[i] as CardId];
  }
  return cards;
}

/** A deep copy: the state is plain data. */
export function cloneState(s: BattleState): BattleState {
  return JSON.parse(JSON.stringify(s)) as BattleState;
}

/** SIM-40: equal hashes mean equal battles. */
export function stateHash(s: BattleState): number {
  return fnv1a(JSON.stringify(s));
}

/** §3.3: one tick. Returns everything that happened in it. */
export function step(s: BattleState, actions: readonly Action[]): BattleEvent[] {
  const events: BattleEvent[] = [];
  if (s.phase === 'ended') return events;
  // SIM-10: the actions, in the order they came.
  for (const a of actions) {
    apply(s, a, events);
    if (s.result) return events;
  }
  // SIM-11: elixir.
  for (const side of SIDES) growElixir(s, side, events);
  // SIM-15: time and the end of the battle.
  s.tick += 1;
  if (s.tick === RULES.doubleFromTick) events.push({ type: 'doubleElixir' });
  if (s.phase === 'main' && s.tick >= RULES.mainTicks) {
    // WIN-03: more crowns at 3:00 win; a tie goes to overtime.
    if (s.crowns[0] !== s.crowns[1]) finish(s, events, leader(s), 'crowns');
    else {
      s.phase = 'overtime';
      events.push({ type: 'overtime' });
    }
  } else if (s.phase === 'overtime') {
    // WIN-03: in overtime the first new crown decides.
    if (s.crowns[0] !== s.crowns[1]) finish(s, events, leader(s), 'overtime');
    else if (s.tick >= RULES.mainTicks + RULES.overtimeTicks) decideByHp(s, events);
  }
  return events;
}

function apply(s: BattleState, a: Action, events: BattleEvent[]): void {
  if (a.type === 'surrender') {
    finish(s, events, a.side === 0 ? 1 : 0, 'surrender');
    return;
  }
  // SIM-20: the hand first; the cards themselves arrive with cards.json in Stage 1.
  const reason = s.hand[a.side].includes(a.card) ? 'notReady' : 'notInHand';
  events.push({ type: 'invalid', side: a.side, reason });
}

/** GD-20: 1 unit per regenTicks, twice as fast from 2:00; at the limit growth stops. */
function growElixir(s: BattleState, side: Side, events: BattleEvent[]): void {
  if (s.elixir[side] >= RULES.elixirMax) {
    s.elixirAcc[side] = 0;
    return;
  }
  const rate = s.tick >= RULES.doubleFromTick ? 2 : 1;
  const acc = s.elixirAcc[side] + 1000 * rate;
  const gain = Math.floor(acc / RULES.regenTicks);
  s.elixirAcc[side] = acc % RULES.regenTicks;
  s.elixir[side] = Math.min(RULES.elixirMax, s.elixir[side] + gain);
  if (s.elixir[side] === RULES.elixirMax) events.push({ type: 'elixirFull', side });
}

function leader(s: BattleState): Side {
  return s.crowns[0] > s.crowns[1] ? 0 : 1;
}

/**
 * WIN-04: after overtime the side whose most damaged tower or keep has the lower share of hit
 * points loses (a destroyed one counts as 0); equal shares — a draw.
 */
function decideByHp(s: BattleState, events: BattleEvent[]): void {
  const worst = SIDES.map((side) => {
    const own = s.buildings.filter(
      (b) => b.side === side && (b.kind === 'keep' || b.kind === 'tower'),
    );
    if (own.length < 1 + RULES.towersAt.length) return 0;
    return Math.min(...own.map((b) => Math.floor((b.hp * 1000) / b.maxHp)));
  });
  const [a, b] = worst as [number, number];
  if (a === b) finish(s, events, null, 'draw');
  else finish(s, events, a < b ? 1 : 0, 'hp');
}

function finish(
  s: BattleState,
  events: BattleEvent[],
  winner: Side | null,
  reason: BattleResult['reason'],
): void {
  s.phase = 'ended';
  s.result = { winner, reason };
  events.push({ type: 'ended', result: s.result });
}

/** SIM-41: what must hold after every tick; returns the broken rules (empty when fine). */
export function invariants(s: BattleState): string[] {
  const p: string[] = [];
  const ids = new Set<number>();
  const cells = new Set<number>();
  for (const b of s.buildings) {
    const at = `${String(b.x)},${String(b.y)}`;
    if (ids.has(b.id)) p.push(`id ${String(b.id)} twice`);
    ids.add(b.id);
    const cell = b.y * COLS + b.x;
    if (cells.has(cell)) p.push(`two buildings on ${at}`);
    cells.add(cell);
    if (b.hp > b.maxHp) p.push(`id ${String(b.id)}: hp above max`);
    if (b.stars < 1 || b.stars > 3) p.push(`id ${String(b.id)}: ${String(b.stars)} stars`);
    if (b.x < 0 || b.x >= COLS || b.y < 0 || b.y >= ROWS)
      p.push(`id ${String(b.id)} off the field`);
  }
  for (const side of SIDES) {
    const e = s.elixir[side];
    if (e < 0 || e > RULES.elixirMax) p.push(`side ${String(side)}: elixir ${String(e)}`);
  }
  return p;
}
