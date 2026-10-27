import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STARTER_DECK } from '../../src/content';
import {
  Bot,
  cloneState,
  createBattle,
  grow,
  invariants,
  randomDeck,
  referenceHash,
  spellAt,
  RULES,
  runBattle,
  ScriptBot,
  stateHash,
  stats,
  step,
  toBoard,
  zoneOf,
  type Action,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type Building,
  type BuildingKind,
  type CardId,
  type Side,
} from '../../src/sim';

/** §3.11: T-01…T-12 and T-17 — the rules of the battle, one by one. */

const setup = (over: Partial<BattleSetup> = {}): BattleSetup => ({
  seed: 42,
  decks: [[...STARTER_DECK], [...STARTER_DECK]],
  playerLevels: [1, 1],
  ...over,
});

function run(s: BattleState, ticks: number, actions: Action[] = []): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(s, i === 0 ? actions : []));
  return events;
}

/** An empty field (no keeps, no towers) with plenty of elixir: one rule at a time. */
function empty(over: Partial<BattleSetup> = {}): BattleState {
  const s = createBattle(setup(over));
  s.buildings = [];
  s.elixir = [10_000, 10_000];
  return s;
}

function put(
  s: BattleState,
  side: Side,
  kind: BuildingKind,
  x: number,
  y: number,
  o: { level?: number; stars?: 1 | 2 | 3; cooldown?: number } = {},
): Building {
  const level = o.level ?? 1;
  const stars = o.stars ?? 1;
  const maxHp = stats(kind, level, stars).maxHp;
  const b: Building = {
    id: s.nextId++,
    side,
    kind,
    x,
    y,
    hp: maxHp,
    maxHp,
    stars,
    level,
    cooldown: o.cooldown ?? 0,
    slowTicks: 0,
  };
  s.buildings.push(b);
  return b;
}

const play = (side: Side, card: CardId, x: number, y: number): Action => ({
  type: 'play',
  side,
  card,
  x,
  y,
  record: true,
});
const byId = (s: BattleState, id: number): Building | undefined =>
  s.buildings.find((b) => b.id === id);

describe('the start of a battle (GD-10, GD-11, GD-12, GD-30)', () => {
  it('each side has a keep at (3, 9) and towers at (1, 8), (5, 8) in its own system', () => {
    const s = createBattle(setup());
    const at = (side: 0 | 1): string[] =>
      s.buildings
        .filter((b) => b.side === side)
        .map((b) => `${b.kind}@${String(b.x)},${String(b.y)}`)
        .sort();
    expect(at(0)).toEqual(['keep@3,9', 'tower@1,8', 'tower@5,8']);
    expect(at(1)).toEqual(['keep@3,0', 'tower@1,1', 'tower@5,1']);
    expect(toBoard(1, 1, 8)).toEqual({ x: 5, y: 1 });
  });

  it('hit points are thousandths (SIM-04): tower 600, keep 1000 at player level 1', () => {
    const s = createBattle(setup());
    const hp = (kind: string): number[] =>
      s.buildings.filter((b) => b.kind === kind).map((b) => b.maxHp);
    expect(hp('keep')).toEqual([1_000_000, 1_000_000]);
    expect(hp('tower')).toEqual([600_000, 600_000, 600_000, 600_000]);
  });

  it('GD-30: the deck is shuffled by the seed; 4 cards in hand, the rest queue behind', () => {
    const s = createBattle(setup());
    expect(s.hand[0]).toHaveLength(RULES.handSize);
    expect([...s.hand[0], ...s.deck[0]].sort()).toEqual([...STARTER_DECK].sort());
    expect(createBattle(setup()).hand).toEqual(s.hand);
    const others = [1, 2, 3, 4, 5].map((seed) => createBattle(setup({ seed })).hand[0].join());
    expect(new Set(others).size).toBeGreaterThan(1);
  });
});

describe('T-01: elixir (GD-20, GD-21)', () => {
  it('starts at 5, grows 1 per 56 ticks, twice as fast from 2:00, stops at 10', () => {
    const s = createBattle(setup());
    expect(s.elixir).toEqual([5000, 5000]);
    run(s, 56);
    expect(s.elixir).toEqual([6000, 6000]);
    run(s, 28);
    expect(s.elixir[0]).toBe(6500);
    const events = run(s, 56 * 4);
    expect(s.elixir[0]).toBe(10_000);
    expect(events.filter((e) => e.type === 'elixirFull')).toHaveLength(2);
    run(s, 100);
    expect(s.elixir[0]).toBe(10_000);
  });

  it('from 2:00 one unit takes 28 ticks', () => {
    const s = createBattle(setup());
    run(s, RULES.doubleFromTick);
    s.elixir = [0, 0];
    s.elixirAcc = [0, 0];
    run(s, 28);
    expect(s.elixir).toEqual([1000, 1000]);
  });

  it('a workshop adds 1 every everySec (cards.json) while it stands; the limit holds', () => {
    const every = stats('workshop', 1, 1).elixirEveryTicks;
    const s = empty();
    s.elixir = [0, 0];
    put(s, 0, 'workshop', 3, 8);
    run(s, every);
    expect(s.elixir[0]).toBe(Math.floor((every * 1000) / 56) + 1000);
    expect(s.elixir[1]).toBe(Math.floor((every * 1000) / 56));
    s.elixir = [9_900, 0];
    run(s, every);
    expect(s.elixir[0]).toBe(10_000);
    expect(invariants(s)).toEqual([]);
  });
});

describe('T-02: the building zone (GD-40, GD-41)', () => {
  it('the start: two back rows and the cells around the keep and towers', () => {
    const s = createBattle(setup());
    const z = zoneOf(s, 0);
    const has = (x: number, y: number): boolean => z[y * 7 + x] === 1;
    expect(has(3, 8) && has(0, 9) && has(0, 7) && has(6, 7)).toBe(true);
    expect(has(3, 7)).toBe(false);
    expect(has(2, 6)).toBe(false);
  });

  it('grows around a building, 2 around an outpost, reaches the other half, rolls back', () => {
    const s = createBattle(setup());
    s.elixir = [10_000, 10_000];
    run(s, 1, [play(0, 'wall', 2, 7)]);
    let z = zoneOf(s, 0);
    expect(z[6 * 7 + 3]).toBe(1);
    run(s, 1, [play(0, 'outpost', 2, 6)]);
    z = zoneOf(s, 0);
    expect(z[4 * 7 + 4]).toBe(1);
    // A wall on the other half (row 4): the zone crosses the middle.
    run(s, 1, [play(0, 'wall', 2, 4)]);
    expect(s.stats[0].enemyHalf).toBe(1);
    expect(zoneOf(s, 0)[3 * 7 + 2]).toBe(1);
    // The front building falls — the zone rolls back.
    s.buildings = s.buildings.filter((b) => !(b.x === 2 && b.y === 4));
    expect(zoneOf(s, 0)[3 * 7 + 2]).toBe(0);
  });

  it("side 1's zone is mirrored", () => {
    const s = createBattle(setup());
    const z = zoneOf(s, 1);
    expect(z[0 * 7 + 3]).toBe(1);
    expect(z[2 * 7 + 0]).toBe(1);
    expect(z[2 * 7 + 3]).toBe(0);
  });
});

describe('T-03: playing a card (SIM-20, GD-31)', () => {
  it('not enough elixir, a taken cell, outside the zone — invalid, nothing changes', () => {
    const s = createBattle(
      setup({
        decks: [
          ['cannon', 'wall', 'watch', 'banner', 'repair', 'archers', 'workshop', 'fireball'],
          [...STARTER_DECK],
        ],
      }),
    );
    const inHand = s.hand[0][0] as CardId;
    s.elixir[0] = 0;
    let ev = step(s, [{ type: 'play', side: 0, card: inHand, x: 0, y: 9 }]);
    expect(ev[0]).toEqual({ type: 'invalid', side: 0, reason: 'elixir' });
    s.elixir[0] = 10_000;
    ev = step(s, [
      {
        type: 'play',
        side: 0,
        card: inHand === 'repair' || inHand === 'fireball' ? (s.hand[0][1] as CardId) : inHand,
        x: 3,
        y: 9,
      },
    ]);
    expect(ev.find((e) => e.type === 'invalid')).toMatchObject({ reason: 'cell' });
    const building = s.hand[0].find((c) => c !== 'repair' && c !== 'fireball') as CardId;
    ev = step(s, [{ type: 'play', side: 0, card: building, x: 3, y: 5 }]);
    expect(ev.find((e) => e.type === 'invalid')).toMatchObject({ reason: 'cell' });
    const notInHand = s.deck[0][0] as CardId;
    ev = step(s, [{ type: 'play', side: 0, card: notInHand, x: 0, y: 9 }]);
    expect(ev.find((e) => e.type === 'invalid')).toMatchObject({ reason: 'notInHand' });
    expect(s.buildings).toHaveLength(6);
  });

  it('the played card goes to the end of the queue, the next one takes its place', () => {
    const s = createBattle(setup());
    s.elixir[0] = 10_000;
    const card = s.hand[0].find((c) => c !== 'fireball' && c !== 'repair') as CardId;
    const i = s.hand[0].indexOf(card);
    const next = s.deck[0][0];
    const before = s.elixir[0];
    const ev = step(s, [{ type: 'play', side: 0, card, x: 0, y: 9 }]);
    expect(ev[0]).toMatchObject({ type: 'placed', kind: card, x: 0, y: 9 });
    expect(s.hand[0][i]).toBe(next);
    expect(s.deck[0][s.deck[0].length - 1]).toBe(card);
    expect(s.stats[0].played).toBe(1);
    expect(s.elixir[0]).toBeLessThan(before);
  });

  it('SIM-22: a new building waits a second before its first shot', () => {
    const s = empty();
    const target = put(s, 1, 'wall', 3, 6);
    run(s, 1, [play(0, 'watch', 3, 8)]);
    const shots = (n: number): number => run(s, n).filter((e) => e.type === 'shot').length;
    expect(shots(RULES.deployTicks - 2)).toBe(0);
    expect(shots(2)).toBe(1);
    expect(byId(s, target.id)?.hp).toBeLessThan(target.maxHp);
  });
});

describe('T-04: picking a target (GD-48)', () => {
  it('the nearest; then the lowest hit points; then the lowest id', () => {
    const s = empty();
    const shooter = put(s, 0, 'archers', 3, 7);
    const far = put(s, 1, 'wall', 3, 4);
    const near = put(s, 1, 'wall', 3, 5);
    let ev = run(s, 1);
    expect(ev.find((e) => e.type === 'shot')).toMatchObject({ from: shooter.id, to: near.id });
    s.buildings = s.buildings.filter((b) => b.id !== near.id && b.id !== far.id);
    const a = put(s, 1, 'wall', 2, 5);
    const b = put(s, 1, 'wall', 4, 5);
    b.hp -= 1000;
    shooter.cooldown = 0;
    ev = run(s, 1);
    expect(ev.find((e) => e.type === 'shot')).toMatchObject({ to: b.id });
    b.hp = a.hp;
    shooter.cooldown = 0;
    ev = run(s, 1);
    expect(ev.find((e) => e.type === 'shot')).toMatchObject({ to: a.id });
  });

  it('the mortar and the catapult do not shoot nearer than their minimum range', () => {
    const s = empty();
    put(s, 0, 'mortar', 3, 7);
    const close = put(s, 1, 'wall', 3, 6);
    expect(run(s, 1).filter((e) => e.type === 'shot')).toEqual([]);
    const ok = put(s, 1, 'wall', 3, 5);
    expect(run(s, 1).find((e) => e.type === 'shot')).toMatchObject({ to: ok.id });
    expect(close.hp).toBeLessThan(close.maxHp); // the splash hits the neighbour of the target
    const t = empty();
    put(t, 0, 'catapult', 3, 9);
    put(t, 1, 'wall', 3, 7);
    expect(run(t, 1).filter((e) => e.type === 'shot')).toEqual([]);
    put(t, 1, 'wall', 3, 6);
    expect(run(t, 1).filter((e) => e.type === 'shot')).toHaveLength(1);
  });
});

describe('T-05: damage is simultaneous (SIM-13)', () => {
  it('two buildings that kill each other in one tick both fall', () => {
    const s = empty();
    const a = put(s, 0, 'cannon', 3, 6);
    const b = put(s, 1, 'cannon', 3, 5);
    a.hp = 1000;
    b.hp = 1000;
    const ev = run(s, 1);
    const fallen = ev.filter((e) => e.type === 'destroyed').map((e) => (e as { id: number }).id);
    expect(fallen.sort()).toEqual([a.id, b.id].sort());
  });

  it('the order of the buildings does not change the result', () => {
    const make = (reverse: boolean): BattleState => {
      const s = empty();
      put(s, 0, 'archers', 2, 6);
      put(s, 0, 'cannon', 4, 6);
      put(s, 1, 'archers', 2, 4);
      put(s, 1, 'watch', 4, 4);
      if (reverse) s.buildings.reverse();
      run(s, 200);
      s.buildings.sort((x, y) => x.id - y.id);
      return s;
    };
    expect(stateHash(make(false))).toBe(stateHash(make(true)));
  });
});

describe('T-06: stacking (GD-50)', () => {
  it('+50% hit points and damage per star, full repair, at most 3, only on own same kind', () => {
    const s = empty();
    const c = put(s, 0, 'cannon', 3, 8);
    c.hp = 1000;
    let ev = run(s, 1, [play(0, 'cannon', 3, 8)]);
    expect(ev[0]).toEqual({ type: 'stacked', id: c.id, side: 0, stars: 2 });
    expect([c.stars, c.maxHp, c.hp]).toEqual([2, 750_000, 750_000]);
    expect(stats('cannon', 1, 2).dmg).toBe(135_000);
    s.elixir[0] = 10_000;
    run(s, 1, [play(0, 'cannon', 3, 8)]);
    expect([c.stars, c.maxHp]).toEqual([3, 1_000_000]);
    s.elixir[0] = 10_000;
    expect(stats('cannon', 1, 3).dmg).toBe(180_000);
    ev = run(s, 1, [play(0, 'cannon', 3, 8)]);
    expect(ev[0]).toMatchObject({ type: 'invalid', reason: 'cell' });
    put(s, 0, 'wall', 2, 8);
    s.elixir[0] = 10_000;
    ev = run(s, 1, [play(0, 'cannon', 2, 8)]);
    expect(ev[0]).toMatchObject({ type: 'invalid', reason: 'cell' });
    put(s, 1, 'cannon', 4, 8);
    ev = run(s, 1, [play(0, 'cannon', 4, 8)]);
    expect(ev[0]).toMatchObject({ type: 'invalid', reason: 'cell' });
    expect(s.stats[0].stacks).toBe(2);
  });
});

describe('T-07: banner, dome, healer (GD-51, SIM-31)', () => {
  it('a banner adds 25% to its neighbours; two banners do not add up', () => {
    const s = empty();
    put(s, 0, 'cannon', 3, 7);
    put(s, 0, 'banner', 2, 7);
    const target = put(s, 1, 'wall', 3, 5);
    run(s, 1);
    expect(target.maxHp - target.hp).toBe(112_500);
    put(s, 0, 'banner', 4, 7);
    const t2 = target.hp;
    run(s, stats('cannon', 1, 1).cooldownTicks);
    expect(t2 - target.hp).toBe(112_500);
  });

  it('a dome takes 40% off the damage to its neighbours (not to itself)', () => {
    const s = empty();
    put(s, 0, 'cannon', 3, 7);
    const target = put(s, 1, 'wall', 3, 5);
    put(s, 1, 'dome', 2, 4);
    put(s, 1, 'dome', 4, 4);
    run(s, 1);
    expect(target.maxHp - target.hp).toBe(54_000);
  });

  it('a healer heals its neighbours 14 a second; the strongest healer counts', () => {
    const s = empty();
    const w = put(s, 0, 'wall', 3, 8);
    w.hp -= 100_000;
    put(s, 0, 'healer', 2, 8);
    put(s, 0, 'healer', 4, 8);
    run(s, 20);
    expect(w.maxHp - w.hp).toBe(100_000 - 14_000);
    const strong = put(s, 0, 'healer', 3, 9, { stars: 2 });
    w.hp = w.maxHp - 100_000;
    run(s, 20);
    expect(w.maxHp - w.hp).toBe(100_000 - 21_000);
    expect(strong.hp).toBe(strong.maxHp);
  });
});

describe('T-08: ballista, mortar, ice (SIM-30, SIM-32)', () => {
  it('the ballista hits every enemy ahead in its column up to 6 cells', () => {
    const s = empty();
    put(s, 0, 'ballista', 3, 9);
    const a = put(s, 1, 'wall', 3, 8);
    const b = put(s, 1, 'wall', 3, 4);
    const c = put(s, 1, 'wall', 3, 2);
    const d = put(s, 1, 'wall', 2, 8);
    run(s, 1);
    expect([a, b, c, d].map((x) => x.maxHp - x.hp)).toEqual([110_000, 110_000, 0, 0]);
  });

  it('the mortar hits the neighbours of its target for half', () => {
    const s = empty();
    put(s, 0, 'mortar', 3, 8);
    const t = put(s, 1, 'wall', 3, 5);
    const n = put(s, 1, 'wall', 4, 4);
    const own = put(s, 0, 'wall', 2, 5);
    run(s, 1);
    expect([t.maxHp - t.hp, n.maxHp - n.hp, own.maxHp - own.hp]).toEqual([120_000, 60_000, 0]);
  });

  it('ice slows the target: its reload is longer for 2 seconds', () => {
    const s = empty();
    put(s, 0, 'ice', 3, 7);
    const target = put(s, 1, 'cannon', 3, 5);
    run(s, 1);
    expect(target.slowTicks).toBe(40);
    // Damage and slows land together (SIM-13): the cannon's shot in this tick is not slowed yet…
    expect(target.cooldown).toBe(24);
    // …its next one is: 24 ticks / 0.6 = 40.
    run(s, 24);
    expect(target.cooldown).toBe(40);
  });
});

describe('T-09: spells (SIM-21, GD-43)', () => {
  it('fireball: 2×2 from its corner, 35% to towers, wholly inside the field', () => {
    const s = createBattle(setup());
    s.elixir[0] = 10_000;
    const tower = s.buildings.find(
      (b) => b.side === 1 && b.kind === 'tower' && b.x === 1,
    ) as Building;
    const wall = put(s, 1, 'wall', 2, 2);
    const ev = run(s, 1, [play(0, 'fireball', 1, 1)]);
    expect(ev[0]).toMatchObject({ type: 'spell', card: 'fireball' });
    expect(tower.maxHp - tower.hp).toBe(105_000);
    expect(wall.maxHp - wall.hp).toBe(300_000);
    expect(run(s, 1, [play(0, 'fireball', 6, 0)])[0]).toMatchObject({ reason: 'cell' });
  });

  it('repair: + its heal to own buildings in 3×3, clipped by the edge, never above the maximum', () => {
    const heal = spellAt('repair', 1).heal;
    const s = empty();
    const a = put(s, 0, 'wall', 0, 9);
    const b = put(s, 0, 'wall', 1, 8);
    const enemy = put(s, 1, 'wall', 0, 8);
    a.hp -= 100_000;
    b.hp -= 400_000;
    enemy.hp -= 100_000;
    run(s, 1, [play(0, 'repair', 0, 9)]);
    expect([a.hp === a.maxHp, b.maxHp - b.hp, enemy.maxHp - enemy.hp]).toEqual([
      true,
      400_000 - heal,
      100_000,
    ]);
  });

  it('quake: 250 to walls and outposts, 80 to other buildings, 40 to towers', () => {
    const s = createBattle(setup());
    s.elixir[0] = 10_000;
    const tower = s.buildings.find(
      (b) => b.side === 1 && b.kind === 'tower' && b.x === 1,
    ) as Building;
    const wall = put(s, 1, 'wall', 2, 2);
    const cannon = put(s, 1, 'cannon', 0, 2);
    run(s, 1, [play(0, 'quake', 1, 2)]);
    expect([tower, wall, cannon].map((b) => b.maxHp - b.hp)).toEqual([40_000, 250_000, 80_000]);
  });
});

describe('T-10: crowns and the end (WIN-01…WIN-04)', () => {
  it('a fallen tower gives a crown; a fallen keep ends the battle with three', () => {
    const s = createBattle(setup());
    const tower = s.buildings.find((b) => b.side === 1 && b.kind === 'tower') as Building;
    tower.hp = 1;
    put(s, 0, 'cannon', tower.x, tower.y + 2);
    const ev = run(s, 1);
    expect(ev).toContainEqual({ type: 'crown', side: 0, crowns: 1 });
    expect(s.stats[0].towers).toBe(1);
    const keep = s.buildings.find((b) => b.side === 1 && b.kind === 'keep') as Building;
    keep.hp = 1;
    put(s, 0, 'cannon', keep.x, keep.y + 2);
    run(s, 30);
    expect(s.crowns[0]).toBe(3);
    expect(s.result).toEqual({ winner: 0, reason: 'keep' });
  });

  it('more crowns at 3:00 win; a tie goes to overtime; the first new crown decides', () => {
    const s = createBattle(setup());
    run(s, RULES.mainTicks - 1);
    s.crowns = [1, 0];
    run(s, 1);
    expect(s.result).toEqual({ winner: 0, reason: 'crowns' });
    const t = createBattle(setup());
    const events = run(t, RULES.mainTicks);
    expect(events.filter((e) => e.type === 'doubleElixir')).toHaveLength(1);
    expect(t.phase).toBe('overtime');
    t.crowns = [0, 1];
    run(t, 1);
    expect(t.result).toEqual({ winner: 1, reason: 'overtime' });
  });

  it('after overtime the weaker most-damaged fort loses; equal — a draw', () => {
    const damaged = createBattle(setup());
    const tower = damaged.buildings.find((b) => b.side === 0 && b.kind === 'tower') as Building;
    tower.hp = tower.maxHp / 2;
    run(damaged, RULES.mainTicks + RULES.overtimeTicks);
    expect(damaged.result).toEqual({ winner: 1, reason: 'hp' });
    const even = createBattle(setup());
    run(even, RULES.mainTicks + RULES.overtimeTicks);
    expect(even.result).toEqual({ winner: null, reason: 'draw' });
  });

  it('both keeps falling in one tick is a draw', () => {
    const s = empty();
    const a = put(s, 0, 'keep', 3, 9);
    const b = put(s, 1, 'keep', 3, 6);
    a.hp = 1;
    b.hp = 1;
    run(s, 1);
    expect(s.result).toEqual({ winner: null, reason: 'keep' });
  });

  it('UI-08: surrender ends the battle at once, the other side wins', () => {
    const s = createBattle(setup());
    expect(step(s, [{ type: 'surrender', side: 0 }])).toEqual([
      { type: 'ended', result: { winner: 1, reason: 'surrender' } },
    ]);
    expect(step(s, [])).toEqual([]);
  });
});

describe('T-11: levels (CRD-03, LVL-04)', () => {
  it('a card level is ×1.10 to hit points and damage; elixir cost stays', () => {
    expect(stats('cannon', 3, 1).maxHp).toBe(grow(500, 3, 110) * 1000);
    expect(grow(500, 3, 110)).toBe(605);
    expect(stats('cannon', 3, 1).dmg).toBe(109_000);
    expect(stats('healer', 2, 1).healPerTick).toBe(Math.floor((15 * 1000) / 20));
  });

  it('a player level is ×1.08 to the keep and the towers', () => {
    const s = createBattle(setup({ playerLevels: [1, 3] }));
    const keep = s.buildings.find((b) => b.kind === 'keep' && b.side === 1);
    expect(keep?.maxHp).toBe(1_166_000);
    expect(stats('tower', 3, 1).dmg).toBe(35_000);
  });

  it('a placed card takes its level from the setup', () => {
    const s = empty({ cardLevels: [{ wall: 4 }, {}] });
    put(s, 0, 'keep', 3, 9);
    run(s, 1, [play(0, 'wall', 2, 9)]);
    expect(s.buildings.find((b) => b.kind === 'wall')?.maxHp).toBe(grow(550, 4, 110) * 1000);
  });
});

describe('T-12, T-17, SIM-40, SIM-41: 1000 battles of bots', () => {
  it('the same setup, bots and seed give the same battle; a copy goes on the same way', () => {
    const battle = (seed: number): BattleState => {
      const r = { rng: seed };
      const b0 = new Bot(0, { react: 14, seed: seed + 1 });
      const b1 = new Bot(1, { react: 14, seed: seed + 2 });
      return runBattle({ seed, decks: [randomDeck(r), randomDeck(r)], playerLevels: [1, 1] }, [
        (s) => b0.next(s),
        (s) => b1.next(s),
      ]).state;
    };
    for (const seed of [1, 2, 3]) expect(stateHash(battle(seed))).toBe(stateHash(battle(seed)));
    expect(stateHash(battle(1))).not.toBe(stateHash(battle(2)));
    const a = createBattle(setup());
    run(a, 700);
    const c = cloneState(a);
    run(a, 300);
    run(c, 300);
    expect(stateHash(c)).toBe(stateHash(a));
  });

  it('SIM-40: the reference battles end with the hashes of tests/fixtures (also checked in e2e)', () => {
    const want = JSON.parse(readFileSync('tests/fixtures/sim-hashes.json', 'utf8')) as Record<
      string,
      number
    >;
    for (const [seed, hash] of Object.entries(want))
      expect(referenceHash(Number(seed)), seed).toBe(hash);
  });

  it('invariants name what is broken', () => {
    const s = createBattle(setup());
    const [a, b] = s.buildings as [Building, Building];
    b.id = a.id;
    b.x = a.x;
    b.y = a.y;
    a.hp = a.maxHp + 1;
    a.stars = 4 as 1;
    s.buildings.push({ ...a, id: 99, x: 7, y: 0 });
    s.elixir[1] = 10_001;
    expect(invariants(s)).toEqual([
      'id 1: hp above max',
      'id 1: 4 stars',
      'id 1 twice',
      'two buildings on 3,9',
      'id 99: hp above max',
      'id 99: 4 stars',
      'id 99 off the field',
      'side 1: elixir 10001',
    ]);
  });
});

describe('BOT-04: the tutorial bot plays its script', () => {
  it('plays at its ticks, in its own system, and nothing else', () => {
    const s = createBattle(setup());
    const bot = new ScriptBot(1, [
      { tick: 0, card: 'wall', x: 2, y: 8 },
      { tick: 40, card: 'cannon', x: 1, y: 7 },
    ]);
    const res = runBattle(setup(), [() => [], (st) => bot.next(st)], { maxTicks: 100 });
    const kinds = res.state.buildings.filter(
      (b) => b.side === 1 && !['keep', 'tower'].includes(b.kind),
    );
    expect(kinds.map((b) => `${b.kind}@${String(b.x)},${String(b.y)}`)).toEqual([
      'wall@4,1',
      'cannon@5,2',
    ]);
    expect(s.tick).toBe(0);
  });
});
