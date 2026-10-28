import { describe, expect, it } from 'vitest';
import { createBattle, step, type Action, type BattleState } from '../../src/sim';
import { Tutorial, tutorialSetup, type TutorialStep } from '../../src/tutorial';

/**
 * TUT-01…TUT-03: every tutorial battle can be won by its own hint, the passive bot does nothing,
 * and the tutorial notices the goal. The battle setup options it uses (an ordered deck, buildings
 * set in advance) are checked here too.
 */

interface Run {
  s: BattleState;
  done: TutorialStep[];
  said: (string | null)[];
  cells: ({ x: number; y: number } | null)[];
}

function start(step: TutorialStep): Run & { t: Tutorial } {
  const s = createBattle(tutorialSetup(step, 1));
  const r: Run = { s, done: [], said: [], cells: [] };
  const t = new Tutorial(
    step,
    {
      say: (k) => r.said.push(k),
      card: () => undefined,
      cell: (c) => r.cells.push(c),
      done: (n) => r.done.push(n),
    },
    s,
  );
  return { ...r, t };
}

function play(r: Run & { t: Tutorial }, actions: Action[], ticks = 1): void {
  for (let i = 0; i < ticks; i++) r.t.tick(step(r.s, i === 0 ? actions : []), r.s);
}

describe('tutorial battles', () => {
  it('TUT-01: the deck in order, a path of walls, a half-ruined tower; the cannon brings it down', () => {
    const r = start(1);
    expect(r.s.hand[0]).toEqual(['cannon', 'wall', 'watch', 'archers']);
    expect(r.s.buildings.filter((b) => b.side === 0 && b.kind === 'wall')).toHaveLength(3);
    const tower = r.s.buildings.find((b) => b.side === 1 && b.x === 1 && b.y === 1);
    expect(tower && tower.hp / tower.maxHp).toBeCloseTo(0.3, 2);
    expect(r.said).toEqual(['tut.1.place']);
    r.t.chose(0);
    expect(r.cells[r.cells.length - 1]).toEqual({ x: 1, y: 3 });
    play(r, [{ type: 'play', side: 0, card: 'cannon', x: 1, y: 3 }]);
    expect(r.said[r.said.length - 1]).toBe('tut.1.shoot');
    play(r, [], 200);
    expect(r.done).toEqual([1]);
    expect(r.s.stats[1].played).toBe(0);
  });

  it('TUT-02: walls forward along the hinted cells reach the enemy half', () => {
    const r = start(2);
    for (let n = 0; n < 8 && r.done.length === 0; n++) {
      const c = r.cells[r.cells.length - 1];
      if (!c) throw new Error('no hint');
      play(r, [{ type: 'play', side: 0, card: 'wall', x: c.x, y: c.y }], 60);
    }
    expect(r.done).toEqual([2]);
    expect(r.s.stats[0].enemyHalf).toBe(1);
  });

  it('TUT-03: a cannon, then a cannon onto it — a star', () => {
    const r = start(3);
    play(r, [{ type: 'play', side: 0, card: 'cannon', x: 2, y: 8 }]);
    expect(r.said[r.said.length - 1]).toBe('tut.3.stack');
    expect(r.cells[r.cells.length - 1]).toEqual({ x: 2, y: 8 });
    play(r, [], 240);
    play(r, [{ type: 'play', side: 0, card: 'cannon', x: 2, y: 8 }]);
    expect(r.done).toEqual([3]);
    expect(r.s.buildings.find((b) => b.kind === 'cannon')?.stars).toBe(2);
  });

  it('the goal is reported once', () => {
    const r = start(3);
    play(r, [{ type: 'play', side: 0, card: 'cannon', x: 2, y: 8 }]);
    play(r, [], 240);
    play(r, [{ type: 'play', side: 0, card: 'cannon', x: 2, y: 8 }]);
    play(r, [], 300);
    expect(r.done).toEqual([3]);
  });
});
