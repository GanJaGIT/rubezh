import { describe, expect, it } from 'vitest';
import {
  cloneState,
  createBattle,
  grow,
  invariants,
  RULES,
  stateHash,
  step,
  toBoard,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type CardId,
} from '../../src/sim';
import { STARTER_DECK } from '../../src/content';

/**
 * The Stage 0 frame of the battle simulation (§3): the start (GD-11, GD-12, LVL-04, GD-30),
 * elixir (GD-20, part of T-01), time and the end (WIN-03, WIN-04), surrender (UI-08),
 * determinism (SIM-40) and invariants (SIM-41). Stage 1 adds T-01…T-20 in full.
 */

const setup = (over: Partial<BattleSetup> = {}): BattleSetup => ({
  seed: 42,
  decks: [[...STARTER_DECK], [...STARTER_DECK]],
  playerLevels: [1, 1],
  ...over,
});

function run(s: BattleState, ticks: number): BattleEvent[] {
  const events: BattleEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(s, []));
  return events;
}

describe('the start of a battle (GD-10, GD-11, GD-12)', () => {
  it('each side has a keep at (3, 9) and towers at (1, 8), (5, 8) in its own system', () => {
    const s = createBattle(setup());
    const at = (side: 0 | 1): string[] =>
      s.buildings
        .filter((b) => b.side === side)
        .map((b) => `${b.kind}@${String(b.x)},${String(b.y)}`)
        .sort();
    expect(at(0)).toEqual(['keep@3,9', 'tower@1,8', 'tower@5,8']);
    // Side 1 is turned by 180°: (x, y) → (6 − x, 9 − y).
    expect(at(1)).toEqual(['keep@3,0', 'tower@1,1', 'tower@5,1']);
    expect(toBoard(1, 1, 8)).toEqual({ x: 5, y: 1 });
  });

  it('hit points are thousandths (SIM-04): tower 600, keep 1000 at player level 1', () => {
    const s = createBattle(setup());
    const hp = (kind: string): number[] =>
      s.buildings.filter((b) => b.kind === kind).map((b) => b.maxHp);
    expect(hp('keep')).toEqual([1_000_000, 1_000_000]);
    expect(hp('tower')).toEqual([600_000, 600_000, 600_000, 600_000]);
    expect(s.buildings.every((b) => b.hp === b.maxHp && b.stars === 1)).toBe(true);
  });

  it('LVL-04: the keep and towers grow ×1.08 per player level, in integers', () => {
    const s = createBattle(setup({ playerLevels: [1, 3] }));
    const keep = s.buildings.find((b) => b.kind === 'keep' && b.side === 1);
    expect(keep?.maxHp).toBe(grow(1_000_000, 3, 108));
    expect(grow(1_000_000, 3, 108)).toBe(1_166_400);
    expect(grow(600, 1, 108)).toBe(600);
  });

  it('GD-30: the deck is shuffled by the seed; 4 cards in hand, the rest queue behind', () => {
    const s = createBattle(setup());
    expect(s.hand[0]).toHaveLength(RULES.handSize);
    expect([...s.hand[0], ...s.deck[0]].sort()).toEqual([...STARTER_DECK].sort());
    expect(createBattle(setup()).hand).toEqual(s.hand);
    const others = [1, 2, 3, 4, 5].map((seed) => createBattle(setup({ seed })).hand[0].join());
    expect(new Set(others).size).toBeGreaterThan(1);
  });

  it('an empty deck plays no cards (the Stage 0 field)', () => {
    const s = createBattle(setup({ decks: [[], []] }));
    expect([s.hand, s.deck]).toEqual([
      [[], []],
      [[], []],
    ]);
  });
});

describe('elixir (GD-20, T-01)', () => {
  it('starts at 5, grows 1 per 56 ticks, twice as fast from 2:00, stops at 10', () => {
    const s = createBattle(setup());
    expect(s.elixir).toEqual([5000, 5000]);
    expect(RULES.regenTicks).toBe(56);
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
});

describe('time and the end of the battle (GD-01, WIN-03, WIN-04)', () => {
  it('double elixir at 2:00, overtime at 3:00 with equal crowns, then hit points decide', () => {
    const s = createBattle(setup());
    const events = run(s, RULES.mainTicks);
    expect(events.filter((e) => e.type === 'doubleElixir')).toHaveLength(1);
    expect(events[events.length - 1]).toEqual({ type: 'overtime' });
    expect(s.phase).toBe('overtime');
    run(s, RULES.overtimeTicks - 1);
    expect(s.phase).toBe('overtime');
    const end = run(s, 1);
    // No damage in Stage 0: equal shares of hit points — a draw.
    expect(end).toEqual([{ type: 'ended', result: { winner: null, reason: 'draw' } }]);
    expect(s.tick).toBe(4 * 60 * 20);
    expect(run(s, 5)).toEqual([]);
  });

  it('more crowns at 3:00 win', () => {
    const s = createBattle(setup());
    run(s, RULES.mainTicks - 1);
    s.crowns = [1, 0];
    run(s, 1);
    expect(s.result).toEqual({ winner: 0, reason: 'crowns' });
  });

  it('in overtime the first new crown decides', () => {
    const s = createBattle(setup());
    run(s, RULES.mainTicks + 100);
    s.crowns = [0, 1];
    run(s, 1);
    expect(s.result).toEqual({ winner: 1, reason: 'overtime' });
  });

  it('WIN-04: the lower share of the most damaged tower or keep loses; a fallen one is 0', () => {
    const damaged = createBattle(setup());
    const tower = damaged.buildings.find((b) => b.side === 0 && b.kind === 'tower');
    if (tower) tower.hp = tower.maxHp / 2;
    run(damaged, RULES.mainTicks + RULES.overtimeTicks);
    expect(damaged.result).toEqual({ winner: 1, reason: 'hp' });

    const fallen = createBattle(setup());
    fallen.buildings = fallen.buildings.filter((b) => !(b.side === 1 && b.kind === 'tower'));
    run(fallen, RULES.mainTicks);
    // Crowns are equal here (set by Stage 1); the missing tower counts as 0 %.
    run(fallen, RULES.overtimeTicks);
    expect(fallen.result).toEqual({ winner: 0, reason: 'hp' });
  });
});

describe('actions (§3.4)', () => {
  it('UI-08: surrender ends the battle at once, the other side wins', () => {
    const s = createBattle(setup());
    const events = step(s, [{ type: 'surrender', side: 0 }]);
    expect(events).toEqual([{ type: 'ended', result: { winner: 1, reason: 'surrender' } }]);
    expect([s.phase, s.tick]).toEqual(['ended', 0]);
    expect(step(s, [{ type: 'surrender', side: 1 }])).toEqual([]);
  });

  it('SIM-20: a card not in hand is invalid; cards arrive in Stage 1', () => {
    const s = createBattle(setup());
    const inHand = s.hand[0][0] as CardId;
    const notInHand = s.deck[0][0] as CardId;
    const events = step(s, [
      { type: 'play', side: 0, card: notInHand, x: 3, y: 7 },
      { type: 'play', side: 0, card: inHand, x: 3, y: 7 },
    ]);
    expect(events.filter((e) => e.type === 'invalid')).toEqual([
      { type: 'invalid', side: 0, reason: 'notInHand' },
      { type: 'invalid', side: 0, reason: 'notReady' },
    ]);
    expect(s.buildings).toHaveLength(6);
  });
});

describe('SIM-40, SIM-41: determinism and invariants', () => {
  it('the same setup and actions give the same battle; a copy goes on the same way', () => {
    const a = createBattle(setup());
    const b = createBattle(setup());
    run(a, 700);
    run(b, 700);
    expect(stateHash(a)).toBe(stateHash(b));
    const c = cloneState(a);
    run(a, 300);
    run(c, 300);
    expect(stateHash(c)).toBe(stateHash(a));
  });

  it('another seed gives another battle', () => {
    expect(stateHash(createBattle(setup({ seed: 1 })))).not.toBe(
      stateHash(createBattle(setup({ seed: 2 }))),
    );
  });

  it('a whole battle keeps the invariants after every tick', () => {
    const s = createBattle(setup());
    while (s.phase !== 'ended') {
      step(s, []);
      expect(invariants(s)).toEqual([]);
    }
  });

  it('invariants name what is broken', () => {
    const s = createBattle(setup());
    const [a, b] = s.buildings;
    if (!a || !b) throw new Error('no buildings');
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
