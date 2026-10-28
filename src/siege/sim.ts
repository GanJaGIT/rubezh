/**
 * Siege: a wave-defence duel (docs/DESIGN-v2.md). Each side has a 5x4 grid of building cells inside
 * a closed ring road. Monster waves (the same for both sides) walk the ring; every time a monster
 * passes the gate it strikes it and goes on for another lap. A side whose gate falls loses.
 *
 * Pure and deterministic: integer thousandths of a cell, 50 ms ticks, a seeded RNG in the state.
 * The battle changes only through actions, so a bot, a player and a replayed record are alike.
 */

import RAW from './content.json';

export const TICK_MS = 50;
export const COLS = 5;
export const ROWS = 4;
export const CELLS = COLS * ROWS;
export const U = 1000;

export type BKind = 'crossbow' | 'cannon' | 'frost' | 'tesla' | 'mine' | 'banner';
export type EKind = 'imp' | 'runner' | 'swarm' | 'brute' | 'bat' | 'splitter' | 'golem';
export const BKINDS: readonly BKind[] = ['crossbow', 'cannon', 'frost', 'tesla', 'mine', 'banner'];
export type Side = 0 | 1;
/** 0 for tiers 1-2; 1 or 2 (branch A or B) from tier 3 on. */
export type Branch = 0 | 1 | 2;

interface BranchSpec {
  id: string;
  dmgMul?: number;
  cdMul?: number;
  rangeAdd?: number;
  splashAdd?: number;
  pierce?: boolean;
  targets?: number;
  air?: boolean;
  burn?: number;
  aura?: boolean;
  freezeEvery?: number;
  freezeT?: number;
  chain?: number;
  stun?: number;
  interest?: number;
  interestCap?: number[];
  forge?: number;
  oreMul?: number;
  rangeAura?: number;
  dmgAura?: number[];
}
interface BuildingSpec {
  cost: number;
  dmg?: number;
  cd?: number;
  range?: number;
  air?: boolean;
  splash?: number;
  slow?: number;
  slowT?: number;
  chain?: number;
  ore?: number[];
  every?: number;
  haste?: number[];
  branches: BranchSpec[];
}
interface EnemySpec {
  hp: number;
  speed: number;
  strike: number;
  bounty: number;
  armor?: number;
  air?: boolean;
  split?: string;
  group?: number;
  boss?: boolean;
  from?: number;
  weight?: number;
  stomp?: { every: number; radius: number; stun: number };
}
interface Content {
  gateHp: number;
  startOre: number;
  hand: number;
  reroll: number;
  ring: { inset: number; chamfer: number };
  wave: {
    first: number;
    interval: number;
    spacing: number;
    hpLinear: number;
    hpSquare: number;
    bountyLinear: number;
    bossEvery: number;
    corruptFrom: number;
    last: number;
  };
  hero: {
    speed: number;
    dmg: number;
    cd: number;
    range: number;
    block: number;
    blockSpeed: number;
    aura: number;
    haste: number;
    abilityCd: number;
    abilityRadius: number;
    abilityStun: number;
    abilityDmg: number;
  };
  horn: { cost: number; step: number; cd: number; kind: string; count: number };
  lastStand: { hp: number; ticks: number; haste: number };
  shadowHp: number;
  enemies: Record<EKind, EnemySpec>;
  tiers: { dmg: number[]; range: number[] };
  buildings: Record<BKind, BuildingSpec>;
}

export const CONTENT = RAW as unknown as Content;

// ---------------------------------------------------------------------------------------------
// The ring road: a rectangle around the grid with chamfered corners, starting at the gate (top
// centre) and going clockwise. Positions along it are integers; segment lengths come from
// Math.sqrt, which is exactly rounded in every engine.

export interface Pt {
  x: number;
  y: number;
}

function buildRing(): { pts: Pt[]; starts: number[]; lens: number[]; length: number } {
  const i = CONTENT.ring.inset;
  const c = CONTENT.ring.chamfer;
  const x0 = -i;
  const y0 = -i;
  const x1 = COLS * U + i;
  const y1 = ROWS * U + i;
  const pts: Pt[] = [
    { x: (COLS * U) / 2, y: y0 },
    { x: x1 - c, y: y0 },
    { x: x1, y: y0 + c },
    { x: x1, y: y1 - c },
    { x: x1 - c, y: y1 },
    { x: x0 + c, y: y1 },
    { x: x0, y: y1 - c },
    { x: x0, y: y0 + c },
    { x: x0 + c, y: y0 },
    { x: (COLS * U) / 2, y: y0 },
  ];
  const starts: number[] = [];
  const lens: number[] = [];
  let length = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const l = Math.round(Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2));
    starts.push(length);
    lens.push(l);
    length += l;
  }
  return { pts, starts, lens, length };
}

export const RING = buildRing();
export const GATE: Pt = RING.pts[0];

export function ringPoint(s: number): Pt {
  const { pts, starts, lens } = RING;
  let k = lens.length - 1;
  while (k > 0 && starts[k] > s) k--;
  const a = pts[k];
  const b = pts[k + 1];
  const t = s - starts[k];
  return {
    x: a.x + Math.trunc(((b.x - a.x) * t) / lens[k]),
    y: a.y + Math.trunc(((b.y - a.y) * t) / lens[k]),
  };
}

export const cellCenter = (cell: number): Pt => ({
  x: (cell % COLS) * U + U / 2,
  y: Math.floor(cell / COLS) * U + U / 2,
});

const dist2 = (a: Pt, b: Pt): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const within = (a: Pt, b: Pt, r: number): boolean => dist2(a, b) <= r * r;

export function neighbours(cell: number): number[] {
  const cx = cell % COLS;
  const cy = Math.floor(cell / COLS);
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if ((dx || dy) && x >= 0 && x < COLS && y >= 0 && y < ROWS) out.push(y * COLS + x);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// RNG (mulberry32 on a uint32 kept in the state).

function rand(o: { rng: number }): number {
  o.rng = (o.rng + 0x6d2b79f5) >>> 0;
  let t = o.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Resolved building stats per (kind, tier, branch), cached.

export interface Stats {
  kind: BKind;
  tier: number;
  branch: Branch;
  attack: boolean;
  dmg: number;
  cd: number;
  range: number;
  air: boolean;
  splash: number;
  targets: number;
  pierce: boolean;
  slow: number;
  slowT: number;
  chain: number;
  stun: number;
  burn: number;
  aura: boolean;
  freezeEvery: number;
  freezeT: number;
  ore: number;
  every: number;
  interest: number;
  interestCap: number;
  haste: number;
  forge: number;
  rangeAura: number;
  dmgAura: number;
}

const statsCache = new Map<string, Stats>();

export function stats(kind: BKind, tier: number, branch: Branch): Stats {
  const key = `${kind}${String(tier)}${String(branch)}`;
  const hit = statsCache.get(key);
  if (hit) return hit;
  const b = CONTENT.buildings[kind];
  const br: BranchSpec = branch ? b.branches[branch - 1] : { id: '' };
  const t = tier - 1;
  const dmgMul = (CONTENT.tiers.dmg[t] * (br.dmgMul ?? 1000)) / 1000;
  const s: Stats = {
    kind,
    tier,
    branch,
    attack: b.dmg !== undefined,
    dmg: Math.round(((b.dmg ?? 0) * dmgMul) / 1000),
    cd: Math.max(2, Math.round(((b.cd ?? 1) * (br.cdMul ?? 1000)) / 1000)),
    range: (b.range ?? 0) + CONTENT.tiers.range[t] + (br.rangeAdd ?? 0),
    air: br.air ?? b.air ?? false,
    splash: b.splash ? b.splash + (br.splashAdd ?? 0) : 0,
    targets: br.targets ?? 1,
    pierce: br.pierce ?? false,
    slow: b.slow ?? 0,
    slowT: (b.slowT ?? 0) + t * 6,
    chain: br.chain ?? b.chain ?? 0,
    stun: br.stun ?? 0,
    burn: br.burn ?? 0,
    aura: br.aura ?? false,
    freezeEvery: br.freezeEvery ?? 0,
    freezeT: br.freezeT ?? 0,
    ore: b.ore ? Math.round((b.ore[t] * (br.oreMul ?? 1000)) / 1000) : 0,
    every: b.every ?? 0,
    interest: br.interest ?? 0,
    interestCap: br.interestCap?.[t] ?? 0,
    haste: b.haste?.[t] ?? 0,
    forge: br.forge ?? 0,
    rangeAura: br.rangeAura ?? 0,
    dmgAura: br.dmgAura?.[t] ?? 0,
  };
  statsCache.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------------------------
// State

export interface Building {
  id: number;
  kind: BKind;
  tier: number;
  branch: Branch;
  /** Attack charge in thousandths of a tick; fires at cd * 1000. */
  charge: number;
  timer: number;
  stun: number;
  shots: number;
  /** Ore spent on it, for selling. */
  value: number;
  /** Last aim, for the turret head. */
  aim: Pt | null;
}

export interface Enemy {
  id: number;
  kind: EKind;
  hp: number;
  maxHp: number;
  s: number;
  /** Distance walked in total: the targeting order ("first"). */
  walked: number;
  x: number;
  y: number;
  speed: number;
  armor: number;
  strike: number;
  bounty: number;
  air: boolean;
  corrupt: boolean;
  shadow: boolean;
  slow: number;
  slowT: number;
  stun: number;
  burnT: number;
  burnDmg: number;
  stompT: number;
}

export interface Hero {
  x: number;
  y: number;
  tx: number;
  ty: number;
  charge: number;
  abilityT: number;
}

interface Spawn {
  tick: number;
  kind: EKind;
  hp: number;
  corrupt: boolean;
  shadow: boolean;
}

export interface SideState {
  gate: number;
  ore: number;
  deck: BKind[];
  hand: BKind[];
  rng: number;
  cells: (Building | null)[];
  enemies: Enemy[];
  spawns: Spawn[];
  hero: Hero;
  hornUses: number;
  hornT: number;
  lastStandT: number;
  lastStandUsed: boolean;
  kills: number;
  sent: number;
  merges: number;
  leaked: number;
  /** Tick the gate fell, or -1. */
  fellAt: number;
  rerolls: number;
}

export interface SiegeSetup {
  seed: number;
  decks: [BKind[], BKind[]];
  /** Collection levels add 6% damage per level above 1 (meta, later). */
  levels?: [number, number];
}

export interface SiegeState {
  tick: number;
  seed: number;
  wave: number;
  nextWave: number;
  nextId: number;
  sides: [SideState, SideState];
  result: { winner: Side | null; reason: 'gate' | 'surrender' | 'time' } | null;
}

export type Action =
  | { type: 'play'; side: Side; slot: number; cell: number }
  | { type: 'merge'; side: Side; from: number; to: number; branch?: Branch }
  | { type: 'move'; side: Side; x: number; y: number }
  | { type: 'ability'; side: Side }
  | { type: 'horn'; side: Side }
  | { type: 'reroll'; side: Side }
  | { type: 'sell'; side: Side; cell: number }
  | { type: 'surrender'; side: Side };

export type SiegeEvent =
  | { type: 'wave'; wave: number; boss: boolean }
  | { type: 'shot'; side: Side; cell: number; kind: BKind; tier: number; branch: Branch; to: Pt[] }
  | { type: 'hero-hit'; side: Side; to: Pt }
  | { type: 'ability'; side: Side; at: Pt }
  | { type: 'strike'; side: Side; dmg: number; kind: EKind }
  | { type: 'kill'; side: Side; at: Pt; kind: EKind; corrupt: boolean; bounty: number }
  | { type: 'built'; side: Side; cell: number; kind: BKind }
  | { type: 'merged'; side: Side; cell: number; kind: BKind; tier: number; branch: Branch }
  | { type: 'sold'; side: Side; cell: number }
  | { type: 'ore'; side: Side; cell: number; amount: number }
  | { type: 'shadow'; side: Side; kind: EKind }
  | { type: 'horn'; side: Side }
  | { type: 'stomp'; side: Side; at: Pt }
  | { type: 'last-stand'; side: Side }
  | { type: 'ended'; winner: Side | null };

export const HERO_BOUNDS = { x0: -1100, y0: -1100, x1: COLS * U + 1100, y1: ROWS * U + 1100 };

export function createSiege(setup: SiegeSetup): SiegeState {
  const side = (deck: BKind[]): SideState => {
    const s: SideState = {
      gate: CONTENT.gateHp,
      ore: CONTENT.startOre,
      deck: deck.length ? [...deck] : [...BKINDS],
      hand: [],
      // Both sides draw the same cards in the same order (a fair "duplicate").
      rng: (setup.seed ^ 0x9e3779b9) >>> 0,
      cells: Array.from({ length: CELLS }, () => null),
      enemies: [],
      spawns: [],
      hero: { x: GATE.x, y: 1500, tx: GATE.x, ty: 1500, charge: 0, abilityT: 0 },
      hornUses: 0,
      hornT: 0,
      lastStandT: 0,
      lastStandUsed: false,
      kills: 0,
      sent: 0,
      merges: 0,
      leaked: 0,
      fellAt: -1,
      rerolls: 0,
    };
    for (let i = 0; i < CONTENT.hand; i++) s.hand.push(draw(s));
    return s;
  };
  return {
    tick: 0,
    seed: setup.seed >>> 0,
    wave: 0,
    nextWave: CONTENT.wave.first,
    nextId: 1,
    sides: [side(setup.decks[0]), side(setup.decks[1])],
    result: null,
  };
}

function draw(s: SideState): BKind {
  return s.deck[rand(s) % s.deck.length];
}

/** Monster health and bounty multiplier (thousandths) for a wave. */
export function hpMul(wave: number): number {
  const w = Math.max(0, wave - 1);
  return 1000 + CONTENT.wave.hpLinear * w + CONTENT.wave.hpSquare * w * w;
}

export interface WaveEntry {
  kind: EKind;
  delay: number;
  corrupt: boolean;
}

/** A wave's monsters: a pure function of the seed and the wave number (the same for both). */
export function waveSpec(seed: number, wave: number): WaveEntry[] {
  const r = { rng: (seed * 31 + wave * 7919) >>> 0 };
  rand(r);
  const W = CONTENT.wave;
  const out: WaveEntry[] = [];
  const boss = wave % W.bossEvery === 0;
  const pool = (Object.keys(CONTENT.enemies) as EKind[]).filter((k) => {
    const e = CONTENT.enemies[k];
    return !e.boss && (e.from ?? 1) <= wave;
  });
  const total = pool.reduce((n, k) => n + (CONTENT.enemies[k].weight ?? 1), 0);
  const count = boss ? 3 + Math.floor(wave / 5) : 6 + Math.floor((wave * 3) / 5);
  let delay = 0;
  if (boss) {
    out.push({ kind: 'golem', delay: 0, corrupt: false });
    delay += W.spacing * 3;
  }
  for (let i = 0; i < count; i++) {
    let roll = rand(r) % total;
    let kind = pool[0];
    for (const k of pool) {
      roll -= CONTENT.enemies[k].weight ?? 1;
      if (roll < 0) {
        kind = k;
        break;
      }
    }
    const group = CONTENT.enemies[kind].group ?? 1;
    for (let g = 0; g < group; g++) {
      out.push({ kind, delay, corrupt: false });
      delay += g + 1 < group ? 3 : W.spacing;
    }
  }
  if (wave >= W.corruptFrom) {
    const singles = out.map((e, i) => ({ e, i })).filter((p) => p.e.kind !== 'swarm');
    const pick = singles[rand(r) % singles.length];
    pick.e.corrupt = true;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Checks for actions (the interface uses them to show what is allowed).

export function canPlay(st: SiegeState, side: Side, slot: number, cell: number): boolean {
  const s = st.sides[side];
  const kind = s.hand[slot];
  if (!kind || cell < 0 || cell >= CELLS || s.fellAt >= 0) return false;
  if (s.ore < CONTENT.buildings[kind].cost) return false;
  const b = s.cells[cell];
  return !b || (b.kind === kind && b.tier === 1);
}

export function canMerge(st: SiegeState, side: Side, from: number, to: number): boolean {
  const s = st.sides[side];
  if (from === to || s.fellAt >= 0) return false;
  const a = s.cells[from];
  const b = s.cells[to];
  return (
    !!a && !!b && a.kind === b.kind && a.tier === b.tier && a.branch === b.branch && a.tier < 4
  );
}

export const hornCost = (s: SideState): number =>
  CONTENT.horn.cost + CONTENT.horn.step * s.hornUses;

// ---------------------------------------------------------------------------------------------
// The tick

export function stepSiege(st: SiegeState, actions: readonly Action[]): SiegeEvent[] {
  const ev: SiegeEvent[] = [];
  if (st.result) return ev;
  for (const a of actions) apply(st, a, ev);
  // apply() may end the battle (surrender); the narrowing above does not know that.
  const early = st.result as SiegeState['result'];
  if (early) {
    ev.push({ type: 'ended', winner: early.winner });
    return ev;
  }

  if (st.tick >= st.nextWave && st.wave < CONTENT.wave.last) {
    st.wave++;
    st.nextWave += CONTENT.wave.interval;
    const spec = waveSpec(st.seed, st.wave);
    const mul = hpMul(st.wave);
    for (const s of st.sides) {
      for (const e of spec) {
        s.spawns.push({
          tick: st.tick + e.delay,
          kind: e.kind,
          hp: Math.round((CONTENT.enemies[e.kind].hp * mul) / 1000),
          corrupt: e.corrupt,
          shadow: false,
        });
      }
    }
    ev.push({ type: 'wave', wave: st.wave, boss: st.wave % CONTENT.wave.bossEvery === 0 });
  }

  for (let k = 0; k < 2; k++) {
    const side = k as Side;
    const s = st.sides[side];
    if (s.fellAt >= 0) continue;
    spawn(st, s);
    moveHero(s);
    economy(s, side, ev);
    buildings(s, side, ev);
    heroAttack(st, s, side, ev);
    monsters(st, s, side, ev);
    if (!s.lastStandUsed && s.gate > 0 && s.gate <= CONTENT.lastStand.hp) {
      s.lastStandUsed = true;
      s.lastStandT = CONTENT.lastStand.ticks;
      ev.push({ type: 'last-stand', side });
    }
    if (s.lastStandT > 0) s.lastStandT--;
    if (s.hornT > 0) s.hornT--;
    if (s.hero.abilityT > 0) s.hero.abilityT--;
  }

  const fallen = st.sides.map((s) => s.gate <= 0 && s.fellAt < 0);
  fallen.forEach((f, i) => {
    if (f) st.sides[i].fellAt = st.tick;
  });
  if (fallen[0] || fallen[1]) {
    let winner: Side | null;
    if (fallen[0] && fallen[1]) {
      const [a, b] = st.sides;
      winner = a.kills === b.kills ? null : a.kills > b.kills ? 0 : 1;
    } else {
      winner = fallen[0] ? 1 : 0;
    }
    st.result = { winner, reason: 'gate' };
    ev.push({ type: 'ended', winner });
  } else if (
    st.wave >= CONTENT.wave.last &&
    st.tick >= st.nextWave &&
    st.sides.every((s) => s.enemies.length === 0 && s.spawns.length === 0)
  ) {
    const [a, b] = st.sides;
    const winner = a.gate === b.gate ? null : a.gate > b.gate ? 0 : 1;
    st.result = { winner, reason: 'time' };
    ev.push({ type: 'ended', winner });
  }
  st.tick++;
  return ev;
}

function apply(st: SiegeState, a: Action, ev: SiegeEvent[]): void {
  const s = st.sides[a.side];
  if (s.fellAt >= 0) return;
  switch (a.type) {
    case 'play': {
      if (!canPlay(st, a.side, a.slot, a.cell)) return;
      const kind = s.hand[a.slot];
      const cost = CONTENT.buildings[kind].cost;
      s.ore -= cost;
      s.hand[a.slot] = draw(s);
      const b = s.cells[a.cell];
      if (b) {
        b.tier = 2;
        b.value += cost;
        s.merges++;
        ev.push({ type: 'merged', side: a.side, cell: a.cell, kind, tier: 2, branch: 0 });
      } else {
        s.cells[a.cell] = newBuilding(st, kind, cost);
        ev.push({ type: 'built', side: a.side, cell: a.cell, kind });
      }
      return;
    }
    case 'merge': {
      if (!canMerge(st, a.side, a.from, a.to)) return;
      const from = s.cells[a.from] as Building;
      const to = s.cells[a.to] as Building;
      to.tier++;
      if (to.tier === 3) to.branch = a.branch === 2 ? 2 : 1;
      to.value += from.value;
      to.charge = Math.max(to.charge, from.charge);
      s.cells[a.from] = null;
      s.merges++;
      ev.push({
        type: 'merged',
        side: a.side,
        cell: a.to,
        kind: to.kind,
        tier: to.tier,
        branch: to.branch,
      });
      return;
    }
    case 'move': {
      const B = HERO_BOUNDS;
      s.hero.tx = Math.max(B.x0, Math.min(B.x1, Math.trunc(a.x)));
      s.hero.ty = Math.max(B.y0, Math.min(B.y1, Math.trunc(a.y)));
      return;
    }
    case 'ability': {
      if (s.hero.abilityT > 0) return;
      const H = CONTENT.hero;
      s.hero.abilityT = H.abilityCd;
      const dmg = Math.round((H.abilityDmg * hpMul(st.wave)) / 1000);
      for (const e of s.enemies) {
        if (within(e, s.hero, H.abilityRadius)) {
          e.stun = Math.max(e.stun, H.abilityStun);
          e.hp -= dmg;
        }
      }
      ev.push({ type: 'ability', side: a.side, at: { x: s.hero.x, y: s.hero.y } });
      return;
    }
    case 'horn': {
      const cost = hornCost(s);
      if (s.hornT > 0 || s.ore < cost) return;
      s.ore -= cost;
      s.hornUses++;
      s.hornT = CONTENT.horn.cd;
      const foe = st.sides[a.side === 0 ? 1 : 0];
      const kind = CONTENT.horn.kind as EKind;
      const hp = Math.round((CONTENT.enemies[kind].hp * hpMul(Math.max(1, st.wave))) / 1000);
      for (let i = 0; i < CONTENT.horn.count; i++) {
        foe.spawns.push({ tick: st.tick + 20 + i * 8, kind, hp, corrupt: false, shadow: true });
      }
      s.sent += CONTENT.horn.count;
      ev.push({ type: 'horn', side: a.side });
      return;
    }
    case 'reroll': {
      if (s.ore < CONTENT.reroll) return;
      s.ore -= CONTENT.reroll;
      s.rerolls++;
      s.hand = s.hand.map(() => draw(s));
      return;
    }
    case 'sell': {
      const b = s.cells[a.cell];
      if (!b) return;
      s.ore += Math.floor(b.value / 2);
      s.cells[a.cell] = null;
      ev.push({ type: 'sold', side: a.side, cell: a.cell });
      return;
    }
    case 'surrender': {
      s.gate = 0;
      s.fellAt = st.tick;
      st.result = { winner: a.side === 0 ? 1 : 0, reason: 'surrender' };
      return;
    }
  }
}

function newBuilding(st: SiegeState, kind: BKind, cost: number): Building {
  return {
    id: st.nextId++,
    kind,
    tier: 1,
    branch: 0,
    charge: 0,
    timer: 0,
    stun: 0,
    shots: 0,
    value: cost,
    aim: null,
  };
}

function spawn(st: SiegeState, s: SideState): void {
  if (!s.spawns.length) return;
  const keep: Spawn[] = [];
  for (const p of s.spawns) {
    if (p.tick > st.tick) {
      keep.push(p);
      continue;
    }
    addEnemy(st, s, p.kind, p.hp, p.corrupt, p.shadow, 0);
  }
  s.spawns = keep;
}

function addEnemy(
  st: SiegeState,
  s: SideState,
  kind: EKind,
  hp: number,
  corrupt: boolean,
  shadow: boolean,
  at: number,
): void {
  const E = CONTENT.enemies[kind];
  const p = ringPoint(at);
  const bm = 1000 + CONTENT.wave.bountyLinear * Math.max(0, st.wave - 1);
  s.enemies.push({
    id: st.nextId++,
    kind,
    hp,
    maxHp: hp,
    s: at,
    walked: at,
    x: p.x,
    y: p.y,
    speed: E.speed,
    armor: Math.round(((E.armor ?? 0) * hpMul(st.wave)) / 1000),
    strike: E.strike,
    bounty: Math.round((E.bounty * bm) / 1000),
    air: E.air ?? false,
    corrupt,
    shadow,
    slow: 0,
    slowT: 0,
    stun: 0,
    burnT: 0,
    burnDmg: 0,
    stompT: E.stomp?.every ?? 0,
  });
}

function moveHero(s: SideState): void {
  const h = s.hero;
  const dx = h.tx - h.x;
  const dy = h.ty - h.y;
  if (!dx && !dy) return;
  const d = Math.round(Math.sqrt(dx * dx + dy * dy));
  const v = CONTENT.hero.speed;
  if (d <= v) {
    h.x = h.tx;
    h.y = h.ty;
  } else {
    h.x += Math.trunc((dx * v) / d);
    h.y += Math.trunc((dy * v) / d);
  }
}

function economy(s: SideState, side: Side, ev: SiegeEvent[]): void {
  for (let c = 0; c < CELLS; c++) {
    const b = s.cells[c];
    if (!b || b.kind !== 'mine') continue;
    const k = stats(b.kind, b.tier, b.branch);
    if (++b.timer < k.every) continue;
    b.timer = 0;
    let amount = k.ore;
    if (k.interest) amount += Math.min(k.interestCap, Math.floor((s.ore * k.interest) / 1000));
    s.ore += amount;
    ev.push({ type: 'ore', side, cell: c, amount });
  }
}

/** Haste, damage and range bonuses that neighbours, the hero and the last stand give a cell. */
function auras(s: SideState, cell: number): { haste: number; dmg: number; range: number } {
  let haste = 0;
  let dmg = 0;
  let range = 0;
  for (const n of neighbours(cell)) {
    const b = s.cells[n];
    if (!b) continue;
    const k = stats(b.kind, b.tier, b.branch);
    haste += k.haste;
    dmg += k.forge + k.dmgAura;
    range += k.rangeAura;
  }
  if (within(s.hero, cellCenter(cell), CONTENT.hero.aura)) haste += CONTENT.hero.haste;
  if (s.lastStandT > 0) haste += CONTENT.lastStand.haste;
  return { haste, dmg, range };
}

function hurt(e: Enemy, dmg: number, pierce: boolean): void {
  e.hp -= pierce ? dmg : Math.max(dmg - e.armor, Math.ceil(dmg / 4));
}

function buildings(s: SideState, side: Side, ev: SiegeEvent[]): void {
  for (let c = 0; c < CELLS; c++) {
    const b = s.cells[c];
    if (!b) continue;
    const k = stats(b.kind, b.tier, b.branch);
    if (!k.attack) continue;
    if (b.stun > 0) {
      b.stun--;
      continue;
    }
    const au = auras(s, c);
    const full = k.cd * 1000;
    if (b.charge < full) b.charge = Math.min(full, b.charge + 1000 + au.haste);
    if (b.charge < full) continue;
    const at = cellCenter(c);
    const range = k.range + au.range;
    const inRange = s.enemies.filter((e) => e.hp > 0 && (k.air || !e.air) && within(e, at, range));
    if (!inRange.length) continue;
    b.charge -= full;
    b.shots++;
    const dmg = Math.round((k.dmg * (1000 + au.dmg)) / 1000);
    inRange.sort((p, q) => q.walked - p.walked || p.id - q.id);
    const hit: Enemy[] = [];
    if (k.aura) {
      hit.push(...inRange);
    } else if (k.chain) {
      let cur: Enemy | undefined = inRange[0];
      while (cur && hit.length < k.chain) {
        hit.push(cur);
        const from: Enemy = cur;
        cur = s.enemies
          .filter((e) => e.hp > 0 && !hit.includes(e) && (k.air || !e.air) && within(e, from, 1500))
          .sort((p, q) => dist2(p, from) - dist2(q, from) || p.id - q.id)[0];
      }
    } else {
      hit.push(...inRange.slice(0, k.targets));
    }
    const to: Pt[] = hit.map((e) => ({ x: e.x, y: e.y }));
    b.aim = to[0];
    const freeze = k.freezeEvery > 0 && b.shots % k.freezeEvery === 0;
    for (const e of hit) {
      if (k.splash) {
        for (const o of s.enemies) {
          if (o.hp > 0 && (k.air || !o.air) && within(o, e, k.splash)) hurt(o, dmg, k.pierce);
        }
      } else {
        hurt(e, dmg, k.pierce);
      }
      if (k.slow) {
        e.slow = Math.max(e.slow, k.slow);
        e.slowT = Math.max(e.slowT, k.slowT);
      }
      if (k.stun) e.stun = Math.max(e.stun, k.stun);
      if (freeze) e.stun = Math.max(e.stun, k.freezeT);
      if (k.burn) {
        e.burnT = 60;
        e.burnDmg = Math.max(e.burnDmg, Math.round((dmg * k.burn) / 1000));
      }
    }
    ev.push({ type: 'shot', side, cell: c, kind: b.kind, tier: b.tier, branch: b.branch, to });
  }
}

function heroAttack(st: SiegeState, s: SideState, side: Side, ev: SiegeEvent[]): void {
  const H = CONTENT.hero;
  const h = s.hero;
  if (h.charge < H.cd) h.charge++;
  if (h.charge < H.cd) return;
  let best: Enemy | null = null;
  for (const e of s.enemies) {
    if (e.hp <= 0 || !within(e, h, H.range)) continue;
    if (!best || dist2(e, h) < dist2(best, h) || (dist2(e, h) === dist2(best, h) && e.id < best.id))
      best = e;
  }
  if (!best) return;
  h.charge = 0;
  hurt(best, Math.round((H.dmg * hpMul(st.wave)) / 1000), false);
  ev.push({ type: 'hero-hit', side, to: { x: best.x, y: best.y } });
}

function monsters(st: SiegeState, s: SideState, side: Side, ev: SiegeEvent[]): void {
  const H = CONTENT.hero;
  const foe = st.sides[side === 0 ? 1 : 0];
  const born: Enemy[] = [];
  const alive: Enemy[] = [];
  for (const e of s.enemies) {
    if (e.burnT > 0) {
      e.burnT--;
      if (e.burnT % 20 === 0) e.hp -= e.burnDmg;
    }
    if (e.hp <= 0) {
      kill(st, s, foe, side, e, ev, born);
      continue;
    }
    let v = e.speed;
    if (e.stun > 0) {
      e.stun--;
      v = 0;
    } else {
      if (e.slowT > 0) {
        e.slowT--;
        v = Math.trunc((v * (1000 - e.slow)) / 1000);
        if (!e.slowT) e.slow = 0;
      }
      if (!e.air && within(e, s.hero, H.block)) v = Math.trunc((v * H.blockSpeed) / 1000);
    }
    e.s += v;
    e.walked += v;
    if (e.s >= RING.length) {
      e.s -= RING.length;
      s.gate -= e.strike;
      s.leaked++;
      ev.push({ type: 'strike', side, dmg: e.strike, kind: e.kind });
    }
    const p = ringPoint(e.s);
    e.x = p.x;
    e.y = p.y;
    const stomp = CONTENT.enemies[e.kind].stomp;
    if (stomp && --e.stompT <= 0) {
      e.stompT = stomp.every;
      for (let c = 0; c < CELLS; c++) {
        const b = s.cells[c];
        if (b && within(cellCenter(c), e, stomp.radius)) b.stun = Math.max(b.stun, stomp.stun);
      }
      ev.push({ type: 'stomp', side, at: { x: e.x, y: e.y } });
    }
    alive.push(e);
  }
  s.enemies = alive.concat(born);
}

function kill(
  st: SiegeState,
  s: SideState,
  foe: SideState,
  side: Side,
  e: Enemy,
  ev: SiegeEvent[],
  born: Enemy[],
): void {
  s.kills++;
  s.ore += e.bounty;
  ev.push({
    type: 'kill',
    side,
    at: { x: e.x, y: e.y },
    kind: e.kind,
    corrupt: e.corrupt,
    bounty: e.bounty,
  });
  if (e.corrupt && foe.fellAt < 0) {
    foe.spawns.push({
      tick: st.tick + 30,
      kind: e.kind,
      hp: Math.round((e.maxHp * CONTENT.shadowHp) / 1000),
      corrupt: false,
      shadow: true,
    });
    s.sent++;
    ev.push({ type: 'shadow', side: side === 0 ? 1 : 0, kind: e.kind });
  }
  const split = CONTENT.enemies[e.kind].split as EKind | undefined;
  if (split) {
    const before = s.enemies.length;
    for (let i = 0; i < 2; i++) {
      addEnemy(st, s, split, Math.max(1, Math.round((e.maxHp * 4) / 10)), false, e.shadow, e.s);
    }
    const kids = s.enemies.splice(before);
    kids.forEach((k, i) => {
      k.walked = e.walked - i * 200;
      born.push(k);
    });
  }
}

/** A cheap 32-bit hash of the state, for determinism tests. */
export function siegeHash(st: SiegeState): number {
  let h = 2166136261;
  const mix = (n: number): void => {
    h = Math.imul(h ^ (n | 0), 16777619) >>> 0;
  };
  mix(st.tick);
  mix(st.wave);
  for (const s of st.sides) {
    mix(s.gate);
    mix(s.ore);
    mix(s.kills);
    mix(s.hero.x);
    mix(s.hero.y);
    for (const b of s.cells) {
      mix(b ? b.id * 7 + b.tier : -1);
    }
    for (const e of s.enemies) {
      mix(e.id);
      mix(e.hp);
      mix(e.s);
    }
  }
  return h;
}
