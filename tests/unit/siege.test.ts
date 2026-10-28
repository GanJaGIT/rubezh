import { describe, expect, it } from 'vitest';
import { botActions } from '../../src/siege/bot';
import {
  BKINDS,
  canMerge,
  CONTENT,
  createSiege,
  GATE,
  hornCost,
  RING,
  ringPoint,
  siegeHash,
  stepSiege,
  waveSpec,
  type Action,
  type SiegeState,
} from '../../src/siege/sim';

/** Siege prototype (docs/DESIGN-v2.md): the rules of section 4 and determinism. */

const fresh = (seed = 7): SiegeState => createSiege({ seed, decks: [[...BKINDS], [...BKINDS]] });

function run(st: SiegeState, ticks: number, acts: (st: SiegeState) => Action[] = () => []): void {
  for (let i = 0; i < ticks && !st.result; i++) stepSiege(st, acts(st));
}

/** Puts a hand card of the kind into slot 0 (the hand is random). */
function give(st: SiegeState, side: 0 | 1, kind: (typeof BKINDS)[number]): void {
  st.sides[side].hand[0] = kind;
  st.sides[side].ore = 10_000;
}

describe('siege', () => {
  it('the ring is closed and starts at the gate', () => {
    expect(ringPoint(0)).toEqual(GATE);
    const end = ringPoint(RING.length - 1);
    expect(Math.abs(end.x - GATE.x) + Math.abs(end.y - GATE.y)).toBeLessThan(5);
  });

  it('is deterministic: the same seed and actions give the same state', () => {
    const play = (seed: number): number => {
      const st = fresh(seed);
      run(st, 3000, (s) => [...botActions(s, 0, 'normal'), ...botActions(s, 1, 'hard')]);
      return siegeHash(st);
    };
    expect(play(11)).toBe(play(11));
    expect(play(11)).not.toBe(play(12));
  });

  it('both sides draw the same cards and face the same waves', () => {
    const st = fresh(3);
    expect(st.sides[0].hand).toEqual(st.sides[1].hand);
    expect(waveSpec(3, 4)).toEqual(waveSpec(3, 4));
    expect(waveSpec(3, 5)[0].kind).toBe('golem');
    expect(waveSpec(3, 2).some((e) => e.corrupt)).toBe(false);
    expect(waveSpec(3, 3).filter((e) => e.corrupt)).toHaveLength(1);
  });

  it('a card builds; the same card on a tier-1 building merges it to tier 2', () => {
    const st = fresh();
    give(st, 0, 'crossbow');
    stepSiege(st, [{ type: 'play', side: 0, slot: 0, cell: 0 }]);
    expect(st.sides[0].cells[0]).toMatchObject({ kind: 'crossbow', tier: 1 });
    give(st, 0, 'crossbow');
    stepSiege(st, [{ type: 'play', side: 0, slot: 0, cell: 0 }]);
    expect(st.sides[0].cells[0]?.tier).toBe(2);
    // A different kind does not go onto it.
    give(st, 0, 'cannon');
    const ore = st.sides[0].ore;
    stepSiege(st, [{ type: 'play', side: 0, slot: 0, cell: 0 }]);
    expect(st.sides[0].ore).toBe(ore);
  });

  it('merging frees a cell, picks a branch at tier 3; other branches do not merge', () => {
    const st = fresh();
    const s = st.sides[0];
    for (const c of [0, 1, 2, 3]) {
      give(st, 0, 'cannon');
      stepSiege(st, [{ type: 'play', side: 0, slot: 0, cell: c }]);
      give(st, 0, 'cannon');
      stepSiege(st, [{ type: 'play', side: 0, slot: 0, cell: c }]);
    }
    stepSiege(st, [
      { type: 'merge', side: 0, from: 0, to: 1, branch: 2 },
      { type: 'merge', side: 0, from: 2, to: 3, branch: 1 },
    ]);
    expect(s.cells[0]).toBeNull();
    expect(s.cells[1]).toMatchObject({ tier: 3, branch: 2 });
    expect(s.cells[3]).toMatchObject({ tier: 3, branch: 1 });
    expect(canMerge(st, 0, 1, 3)).toBe(false);
    s.cells[3] = { ...(s.cells[3] as NonNullable<(typeof s.cells)[number]>), branch: 2 };
    stepSiege(st, [{ type: 'merge', side: 0, from: 1, to: 3 }]);
    expect(s.cells[3]).toMatchObject({ tier: 4, branch: 2 });
    expect(s.merges).toBe(7);
  });

  it('monsters strike the gate on every lap and keep walking', () => {
    const st = fresh();
    run(st, CONTENT.wave.first + 1);
    const first = st.sides[0].enemies[0];
    expect(first).toBeDefined();
    const lap = Math.ceil(RING.length / first.speed) + 2;
    run(st, lap);
    expect(st.sides[0].gate).toBeLessThan(CONTENT.gateHp);
    expect(st.sides[0].enemies.some((e) => e.id === first.id)).toBe(true);
  });

  it('a killed corrupt monster sends a shadow to the opponent', () => {
    const st = fresh();
    while (st.wave < 3) stepSiege(st, []);
    run(st, 200);
    const s = st.sides[0];
    const bad = s.enemies.find((e) => e.corrupt);
    expect(bad).toBeDefined();
    if (bad) bad.hp = 0;
    const before = st.sides[1].spawns.filter((p) => p.shadow).length;
    stepSiege(st, []);
    expect(st.sides[1].spawns.filter((p) => p.shadow).length).toBe(before + 1);
    expect(s.sent).toBe(1);
  });

  it('the horn costs more each time and sends monsters to the opponent', () => {
    const st = fresh();
    st.sides[0].ore = 500;
    const cost = hornCost(st.sides[0]);
    stepSiege(st, [{ type: 'horn', side: 0 }]);
    expect(st.sides[0].ore).toBe(500 - cost);
    expect(st.sides[1].spawns).toHaveLength(CONTENT.horn.count);
    // On cooldown: nothing happens.
    stepSiege(st, [{ type: 'horn', side: 0 }]);
    expect(st.sides[0].hornUses).toBe(1);
    expect(hornCost(st.sides[0])).toBe(cost + CONTENT.horn.step);
  });

  it('the hero walks to a point; the ability stuns nearby monsters once per cooldown', () => {
    const st = fresh();
    stepSiege(st, [{ type: 'move', side: 0, x: -600, y: 2000 }]);
    run(st, 60);
    expect(st.sides[0].hero).toMatchObject({ x: -600, y: 2000 });
    stepSiege(st, [{ type: 'ability', side: 0 }]);
    expect(st.sides[0].hero.abilityT).toBeGreaterThan(0);
  });

  it('the last stand fires once at low gate strength; a fallen gate loses', () => {
    const st = fresh();
    st.sides[0].gate = CONTENT.lastStand.hp;
    stepSiege(st, []);
    expect(st.sides[0].lastStandT).toBeGreaterThan(0);
    st.sides[0].gate = 0;
    stepSiege(st, []);
    expect(st.result).toEqual({ winner: 1, reason: 'gate' });
  });

  it('surrender ends the battle at once', () => {
    const st = fresh();
    const ev = stepSiege(st, [{ type: 'surrender', side: 1 }]);
    expect(st.result?.winner).toBe(0);
    expect(ev.map((e) => e.type)).toContain('ended');
  });

  it('a stronger bot beats a weaker one, and battles end in a few minutes', () => {
    let wins = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const st = fresh(seed);
      run(st, 20 * 60 * 15, (s) => [...botActions(s, 0, 'normal'), ...botActions(s, 1, 'easy')]);
      expect(st.result).not.toBeNull();
      if (st.result?.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  });
});
