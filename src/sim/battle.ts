/**
 * The battle simulation (§3). Pure TypeScript: no engine, no browser, no clock and no global
 * random — the architecture test checks it. One call of step() is one tick (SIM-01), in the order
 * of §3.3: actions, elixir, healing, shooting (all damage at once), destruction, time.
 */

import { fnv1a, randomInt } from './rng';
import {
  CARDS,
  CELLS,
  COLS,
  isSpell,
  progress,
  projectileOf,
  ROWS,
  RULES,
  spellAt,
  stats,
  toBoard,
  UNIT,
} from './rules';
import type {
  Action,
  BattleEvent,
  BattleResult,
  BattleSetup,
  BattleState,
  Building,
  BuildingKind,
  CardId,
  InvalidReason,
  Side,
  SideStats,
} from './types';

const SIDES: readonly Side[] = [0, 1];
const other = (side: Side): Side => (side === 0 ? 1 : 0);
const emptyStats = (): SideStats => ({
  played: 0,
  stacks: 0,
  enemyHalf: 0,
  expensive: 0,
  towers: 0,
});

export const cellIndex = (x: number, y: number): number => y * COLS + x;
export const inField = (x: number, y: number): boolean => x >= 0 && x < COLS && y >= 0 && y < ROWS;
export const isFort = (kind: BuildingKind): boolean => kind === 'keep' || kind === 'tower';

const cardLevelOf = (setup: BattleSetup, side: Side, kind: BuildingKind): number =>
  kind === 'keep' || kind === 'tower'
    ? setup.playerLevels[side]
    : (setup.cardLevels?.[side][kind] ?? 1);

/** CRD-03: the level of a side's card (1 when the setup does not say). */
export function cardLevel(s: BattleState, side: Side, card: CardId): number {
  return s.setup.cardLevels?.[side][card] ?? 1;
}

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
    stats: [emptyStats(), emptyStats()],
  };
  // GD-11: the keep and two towers of each side, in its own system; LVL-04: the player's level.
  for (const side of SIDES) {
    const level = setup.playerLevels[side];
    addBuilding(s, side, 'keep', toBoard(side, ...RULES.keepAt), level);
    for (const at of RULES.towersAt) addBuilding(s, side, 'tower', toBoard(side, ...at), level);
  }
  // TUT: the tutorial's own field.
  for (const p of setup.preset ?? []) {
    let b = s.buildings.find((x) => x.x === p.x && x.y === p.y);
    if (!b) b = addBuilding(s, p.side, p.kind, p, cardLevelOf(setup, p.side, p.kind));
    if (p.hpPm !== undefined) b.hp = Math.max(1, Math.floor((b.maxHp * p.hpPm) / 1000));
  }
  // GD-30: each deck is shuffled by the battle seed; the first cards are the hand.
  for (const side of SIDES) {
    const deck =
      setup.shuffle === false ? [...setup.decks[side]] : shuffle(s, [...setup.decks[side]]);
    s.hand[side] = deck.slice(0, RULES.handSize);
    s.deck[side] = deck.slice(RULES.handSize);
  }
  return s;
}

function addBuilding(
  s: BattleState,
  side: Side,
  kind: BuildingKind,
  at: { x: number; y: number },
  level: number,
): Building {
  const maxHp = stats(kind, level, 1).maxHp;
  const b: Building = {
    id: s.nextId++,
    side,
    kind,
    x: at.x,
    y: at.y,
    hp: maxHp,
    maxHp,
    stars: 1,
    level,
    // SIM-22: a new building deploys for a second before its first shot.
    cooldown: RULES.deployTicks,
    slowTicks: 0,
  };
  s.buildings.push(b);
  return b;
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

// ---------------------------------------------------------------------------------------------
// The field: who stands where, and the zones (GD-40…GD-42)

/** Index + 1 of the building on every cell (0 — free). */
export function occupancy(s: BattleState): Int16Array {
  const occ = new Int16Array(CELLS);
  s.buildings.forEach((b, i) => {
    occ[cellIndex(b.x, b.y)] = i + 1;
  });
  return occ;
}

/**
 * GD-40, GD-41: the cells a side may build on — its two back rows and every cell within
 * Chebyshev distance 1 of its buildings (2 around an outpost). It may reach the other half.
 */
export function zoneOf(s: BattleState, side: Side): Uint8Array {
  const zone = new Uint8Array(CELLS);
  for (let y = 0; y < ROWS; y++) {
    if (progress(side, y) >= RULES.backRows) continue;
    for (let x = 0; x < COLS; x++) zone[cellIndex(x, y)] = 1;
  }
  for (const b of s.buildings) {
    if (b.side !== side) continue;
    const r = stats(b.kind, b.level, b.stars).zoneRadius;
    for (let y = Math.max(0, b.y - r); y <= Math.min(ROWS - 1, b.y + r); y++) {
      for (let x = Math.max(0, b.x - r); x <= Math.min(COLS - 1, b.x + r); x++) {
        zone[cellIndex(x, y)] = 1;
      }
    }
  }
  return zone;
}

/** The context of one decision: the cached grids a check needs (the bot asks many times). */
export interface FieldView {
  occ: Int16Array;
  zone: [Uint8Array, Uint8Array];
}

export function viewOf(s: BattleState): FieldView {
  return { occ: occupancy(s), zone: [zoneOf(s, 0), zoneOf(s, 1)] };
}

/** GD-40…GD-43, GD-50, SIM-21: whether a card may land on this cell (elixir and hand aside). */
export function cellAllowed(
  s: BattleState,
  side: Side,
  card: CardId,
  x: number,
  y: number,
  view: FieldView = viewOf(s),
): boolean {
  const sp = CARDS[card].spell;
  if (sp) {
    // A 2×2 fireball lies wholly in the field; a 3×3 is clipped by the edge.
    if (sp.anchor === 'corner') {
      return x >= 0 && y >= 0 && x + sp.area[0] <= COLS && y + sp.area[1] <= ROWS;
    }
    return inField(x, y);
  }
  if (!inField(x, y)) return false;
  const o = view.occ[cellIndex(x, y)] ?? 0;
  if (o > 0) {
    const b = s.buildings[o - 1] as Building;
    return b.side === side && b.kind === card && b.stars < RULES.maxStars;
  }
  return view.zone[side][cellIndex(x, y)] === 1;
}

/** SIM-20: why a play is not allowed, or null when it is. */
export function checkPlay(
  s: BattleState,
  a: Extract<Action, { type: 'play' }>,
  view?: FieldView,
): InvalidReason | null {
  if (s.phase === 'ended') return 'ended';
  if (!a.record && !s.hand[a.side].includes(a.card)) return 'notInHand';
  if (s.elixir[a.side] < CARDS[a.card].cost * UNIT) return 'elixir';
  if (!cellAllowed(s, a.side, a.card, a.x, a.y, view)) return 'cell';
  return null;
}

// ---------------------------------------------------------------------------------------------
// One tick (§3.3)

export function step(s: BattleState, actions: readonly Action[]): BattleEvent[] {
  const events: BattleEvent[] = [];
  if (s.phase === 'ended') return events;
  // SIM-10: the actions, in the order they came.
  for (const a of actions) {
    if (a.type === 'surrender') finish(s, events, other(a.side), 'surrender');
    else play(s, a, events);
    if (s.result) return events;
  }
  // SIM-11: elixir and workshops.
  for (const side of SIDES) growElixir(s, side, events);
  // SIM-12: healers.
  // The field does not change between healing and shooting: one grid for both.
  const occ = occupancy(s);
  heal(s, occ, events);
  // SIM-13: shooting — targets by the state at the start of the phase, damage all at once.
  shoot(s, occ, events);
  // SIM-14: destruction, crowns, zones.
  destroy(s, events);
  // SIM-15: time and the end of the battle.
  s.tick += 1;
  if (s.result) return events;
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

function play(s: BattleState, a: Extract<Action, { type: 'play' }>, events: BattleEvent[]): void {
  const view = viewOf(s);
  const reason = checkPlay(s, a, view);
  if (reason) {
    events.push({ type: 'invalid', side: a.side, reason });
    return;
  }
  const def = CARDS[a.card];
  s.elixir[a.side] -= def.cost * UNIT;
  // GD-31: the card goes to the end of the queue, the next one takes its place in the hand.
  if (!a.record) {
    const hand = s.hand[a.side];
    const i = hand.indexOf(a.card);
    const next = s.deck[a.side].shift();
    if (next) hand[i] = next;
    else hand.splice(i, 1);
    s.deck[a.side].push(a.card);
  }
  const st = s.stats[a.side];
  st.played += 1;
  if (def.cost >= 4) st.expensive += 1;
  if (isSpell(a.card)) {
    cast(s, a.side, a.card, a.x, a.y, view, events);
    return;
  }
  const o = view.occ[cellIndex(a.x, a.y)] ?? 0;
  if (o > 0) {
    // GD-50: one more star, +50% of the base hit points and damage, hit points restored.
    const b = s.buildings[o - 1] as Building;
    b.stars = (b.stars + 1) as 2 | 3;
    b.maxHp = stats(b.kind, b.level, b.stars).maxHp;
    b.hp = b.maxHp;
    st.stacks += 1;
    events.push({ type: 'stacked', id: b.id, side: b.side, stars: b.stars });
    return;
  }
  const b = addBuilding(s, a.side, a.card, a, cardLevel(s, a.side, a.card));
  if (progress(a.side, a.y) >= ROWS / 2) st.enemyHalf += 1;
  events.push({ type: 'placed', id: b.id, side: b.side, kind: b.kind, x: b.x, y: b.y, stars: 1 });
  events.push({ type: 'zoneChanged' });
}

/** SIM-21: a spell works in the tick it is played. */
function cast(
  s: BattleState,
  side: Side,
  card: CardId,
  x: number,
  y: number,
  view: FieldView,
  events: BattleEvent[],
): void {
  const sp = spellAt(card, cardLevel(s, side, card));
  const [x0, y0] = sp.anchor === 'corner' ? [x, y] : [x - 1, y - 1];
  events.push({ type: 'spell', side, card, x, y });
  for (let cy = Math.max(0, y0); cy < Math.min(ROWS, y0 + sp.area[1]); cy++) {
    for (let cx = Math.max(0, x0); cx < Math.min(COLS, x0 + sp.area[0]); cx++) {
      const o = view.occ[cellIndex(cx, cy)] ?? 0;
      if (o === 0) continue;
      const b = s.buildings[o - 1] as Building;
      if (b.side === side && sp.heal > 0) {
        const add = Math.min(sp.heal, b.maxHp - b.hp);
        if (add > 0) {
          b.hp += add;
          events.push({ type: 'healed', id: b.id, amount: add });
        }
      } else if (b.side !== side && (sp.dmg > 0 || sp.towerDmg > 0)) {
        const amount = isFort(b.kind)
          ? sp.towerDmg
          : sp.heavyKinds.includes(b.kind)
            ? sp.heavyDmg
            : sp.dmg;
        const taken = reduced(s, view.occ, b, amount);
        b.hp -= taken;
        events.push({ type: 'damaged', id: b.id, amount: taken });
      }
    }
  }
}

/** GD-20, GD-21: 1 unit per regenTicks (twice as fast from 2:00), +1 per workshop every 10 s. */
function growElixir(s: BattleState, side: Side, events: BattleEvent[]): void {
  const before = s.elixir[side];
  if (before < RULES.elixirMax) {
    const rate = s.tick >= RULES.doubleFromTick ? 2 : 1;
    const acc = s.elixirAcc[side] + 1000 * rate;
    s.elixirAcc[side] = acc % RULES.regenTicks;
    s.elixir[side] = Math.min(RULES.elixirMax, before + Math.floor(acc / RULES.regenTicks));
  } else {
    s.elixirAcc[side] = 0;
  }
  let workshops = 0;
  let every = 0;
  for (const b of s.buildings) {
    if (b.side !== side || b.kind !== 'workshop') continue;
    workshops += 1;
    every = stats(b.kind, b.level, b.stars).elixirEveryTicks;
  }
  if (workshops === 0) {
    s.workshopAcc[side] = 0;
  } else {
    s.workshopAcc[side] += workshops;
    while (s.workshopAcc[side] >= every) {
      s.workshopAcc[side] -= every;
      s.elixir[side] = Math.min(RULES.elixirMax, s.elixir[side] + UNIT);
    }
  }
  if (before < RULES.elixirMax && s.elixir[side] === RULES.elixirMax) {
    events.push({ type: 'elixirFull', side });
  }
}

/** The 8 cells around a cell, in the field. */
function forNeighbours(x: number, y: number, fn: (i: number) => void): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx !== 0 || dy !== 0) && inField(x + dx, y + dy)) fn(cellIndex(x + dx, y + dy));
    }
  }
}

/**
 * GD-51: the strongest value of a neighbour effect a building gets from its own side's
 * buildings of this kind (the same effects do not add up).
 */
function strongest(
  s: BattleState,
  occ: Int16Array,
  b: Building,
  kind: CardId,
  value: (n: Building) => number,
): number {
  let best = 0;
  forNeighbours(b.x, b.y, (i) => {
    const o = occ[i] ?? 0;
    if (o === 0) return;
    const n = s.buildings[o - 1] as Building;
    if (n.side === b.side && n.kind === kind) best = Math.max(best, value(n));
  });
  return best;
}

/** SIM-31: incoming damage × (1 − the dome's protection). */
function reduced(s: BattleState, occ: Int16Array, b: Building, amount: number): number {
  const pm = strongest(s, occ, b, 'dome', (n) => stats(n.kind, n.level, n.stars).reducePm);
  return Math.floor((amount * (1000 - pm)) / 1000);
}

/** SIM-12, GD-51: healers heal their neighbours; the strongest healer counts. */
function heal(s: BattleState, occ: Int16Array, events: BattleEvent[]): void {
  if (!s.buildings.some((b) => b.kind === 'healer')) return;
  for (const b of s.buildings) {
    if (b.hp >= b.maxHp) continue;
    const amount = strongest(
      s,
      occ,
      b,
      'healer',
      (n) => stats(n.kind, n.level, n.stars).healPerTick,
    );
    const add = Math.min(amount, b.maxHp - b.hp);
    if (add <= 0) continue;
    b.hp += add;
    events.push({ type: 'healed', id: b.id, amount: add });
  }
}

/**
 * SIM-13, SIM-30…SIM-34: every shooter picks its target by the state at the start of the phase;
 * the damage, the splash and the slows are gathered and applied together, so the order of the
 * buildings never matters.
 */
function shoot(s: BattleState, occ: Int16Array, events: BattleEvent[]): void {
  const damage = new Map<number, number>();
  const slowed: { b: Building; ticks: number; pm: number }[] = [];
  const hit = (b: Building, amount: number): void => {
    damage.set(b.id, (damage.get(b.id) ?? 0) + amount);
  };
  for (const b of s.buildings) {
    const st = stats(b.kind, b.level, b.stars);
    if (st.dmg === 0) continue;
    if (b.cooldown > 0) b.cooldown -= 1;
    if (b.cooldown > 0) continue;
    const targets =
      st.line > 0 ? lineTargets(s, b, st.line) : nearest(s, b, st.minRange2, st.range2);
    if (targets.length === 0) continue;
    // SIM-31: the strongest banner next to the shooter.
    const buff = strongest(s, occ, b, 'banner', (n) => stats(n.kind, n.level, n.stars).buffPm);
    const shot = Math.floor((st.dmg * (1000 + buff)) / 1000);
    for (const t of targets) {
      hit(t, shot);
      events.push({ type: 'shot', from: b.id, to: t.id, projectile: projectileOf(b.kind) });
      // SIM-32: the mortar hits the target's neighbours for half.
      if (st.splashPm > 0) {
        forNeighbours(t.x, t.y, (i) => {
          const o = occ[i] ?? 0;
          if (o === 0) return;
          const n = s.buildings[o - 1] as Building;
          if (n.side !== b.side) hit(n, Math.floor((shot * st.splashPm) / 1000));
        });
      }
      if (st.slowTicks > 0) slowed.push({ b: t, ticks: st.slowTicks, pm: st.slowPm });
    }
    // SIM-33: a slowed building reloads 1 / (1 − 0.4) times longer (SIM-32).
    b.cooldown =
      b.slowTicks > 0 ? Math.round((st.cooldownTicks * 1000) / (1000 - SLOW_PM)) : st.cooldownTicks;
  }
  for (const b of s.buildings) if (b.slowTicks > 0) b.slowTicks -= 1;
  for (const sl of slowed) sl.b.slowTicks = Math.max(sl.b.slowTicks, sl.ticks);
  for (const b of s.buildings) {
    const amount = damage.get(b.id);
    if (amount === undefined) continue;
    const taken = reduced(s, occ, b, amount);
    b.hp -= taken;
    events.push({ type: 'damaged', id: b.id, amount: taken });
  }
}

/** SIM-32: how much the ice slows (its effect in cards.json). */
const SLOW_PM = stats('ice', 1, 1).slowPm;

/**
 * GD-48: the nearest enemy building within the range (Euclid between cell centres, not nearer
 * than the minimum range); ties — the lowest hit points, then the lowest id.
 */
function nearest(s: BattleState, b: Building, min2: number, max2: number): Building[] {
  let best: Building | null = null;
  let bestD = 0;
  for (const o of s.buildings) {
    if (o.side === b.side) continue;
    const d = ((o.x - b.x) ** 2 + (o.y - b.y) ** 2) * 100;
    if (d < min2 || d > max2) continue;
    if (
      !best ||
      d < bestD ||
      (d === bestD && (o.hp < best.hp || (o.hp === best.hp && o.id < best.id)))
    ) {
      best = o;
      bestD = d;
    }
  }
  return best ? [best] : [];
}

/** SIM-30: the ballista hits every enemy building ahead in its column, up to `length` cells. */
function lineTargets(s: BattleState, b: Building, length: number): Building[] {
  return s.buildings.filter((o) => {
    if (o.side === b.side || o.x !== b.x) return false;
    const ahead = b.side === 0 ? b.y - o.y : o.y - b.y;
    return ahead >= 1 && ahead <= length;
  });
}

/** SIM-14, WIN-01, WIN-02: the fallen go; a tower gives a crown, the keep ends the battle. */
function destroy(s: BattleState, events: BattleEvent[]): void {
  const fallen = s.buildings.filter((b) => b.hp <= 0);
  if (fallen.length === 0) return;
  s.buildings = s.buildings.filter((b) => b.hp > 0);
  const keeps: Side[] = [];
  for (const b of fallen) {
    events.push({ type: 'destroyed', id: b.id, side: b.side, kind: b.kind, x: b.x, y: b.y });
    if (!isFort(b.kind)) continue;
    const by = other(b.side);
    s.stats[by].towers += 1;
    if (b.kind === 'keep') keeps.push(b.side);
    s.crowns[by] = b.kind === 'keep' ? 3 : Math.min(3, s.crowns[by] + 1);
    events.push({ type: 'crown', side: by, crowns: s.crowns[by] });
  }
  events.push({ type: 'zoneChanged' });
  if (keeps.length === 2) finish(s, events, null, 'keep');
  else if (keeps.length === 1) finish(s, events, other(keeps[0] as Side), 'keep');
}

function leader(s: BattleState): Side {
  return s.crowns[0] > s.crowns[1] ? 0 : 1;
}

/** WIN-04: the share of hit points of a side's most damaged tower or keep (a fallen one — 0). */
export function weakestFort(s: BattleState, side: Side): number {
  const own = s.buildings.filter((b) => b.side === side && isFort(b.kind));
  if (own.length < 1 + RULES.towersAt.length) return 0;
  return Math.min(...own.map((b) => Math.floor((b.hp * 1000) / b.maxHp)));
}

/** WIN-04: after overtime the lower share of the most damaged fort loses; equal — a draw. */
function decideByHp(s: BattleState, events: BattleEvent[]): void {
  const a = weakestFort(s, 0);
  const b = weakestFort(s, 1);
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
    if (ids.has(b.id)) p.push(`id ${String(b.id)} twice`);
    ids.add(b.id);
    const cell = cellIndex(b.x, b.y);
    if (cells.has(cell)) p.push(`two buildings on ${String(b.x)},${String(b.y)}`);
    cells.add(cell);
    if (b.hp > b.maxHp) p.push(`id ${String(b.id)}: hp above max`);
    if (b.stars < 1 || b.stars > 3) p.push(`id ${String(b.id)}: ${String(b.stars)} stars`);
    if (!inField(b.x, b.y)) p.push(`id ${String(b.id)} off the field`);
  }
  for (const side of SIDES) {
    const e = s.elixir[side];
    if (e < 0 || e > RULES.elixirMax) p.push(`side ${String(side)}: elixir ${String(e)}`);
  }
  return p;
}
