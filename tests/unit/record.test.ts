import { describe, expect, it } from 'vitest';
import { STARTER_DECK } from '../../src/content';
import {
  Bot,
  createBattle,
  headerPayload,
  parseRecord,
  playPayload,
  RecordDriver,
  recordedBattle,
  shouldPush,
  step,
  type BattleRecord,
  type BattleState,
  type CardId,
} from '../../src/sim';

/** §3.8: T-13…T-16 — recording, checking and replaying the battles of other players. */

const header = (over: Record<string, unknown> = {}): { payload: unknown; time: number } => ({
  payload: {
    ...headerPayload({
      deck: [...STARTER_DECK],
      lv: [1, 1, 1, 1, 1, 1, 1, 1],
      pl: 1,
      ar: 1,
      seed: 7,
    }),
    ...over,
  },
  time: 0,
});
const p = (
  card: CardId,
  x: number,
  y: number,
  time: number,
): { payload: unknown; time: number } => ({
  payload: playPayload(card, x, y),
  time,
});

const record = (plays: BattleRecord['plays']): BattleRecord => ({
  deck: [...STARTER_DECK],
  levels: {},
  playerLevel: 1,
  arena: 1,
  seed: 1,
  plays,
});

/** Side 1 replays the record; side 0 does nothing (and keeps its elixir). */
function replay(rec: BattleRecord, ticks: number): { s: BattleState; d: RecordDriver } {
  const s = createBattle({
    seed: 1,
    decks: [[...STARTER_DECK], [...STARTER_DECK]],
    playerLevels: [1, 1],
  });
  const d = new RecordDriver(rec, 1);
  for (let i = 0; i < ticks; i++) step(s, d.act(s));
  return { s, d };
}

describe('T-13: the record format (REC-01…REC-04)', () => {
  it('the header first, then one event per card in the own system of coordinates', () => {
    expect(header().payload).toEqual({
      k: 'h',
      v: 1,
      deck: STARTER_DECK,
      lv: [1, 1, 1, 1, 1, 1, 1, 1],
      pl: 1,
      ar: 1,
      seed: 7,
    });
    expect(playPayload('cannon', 2, 7)).toEqual({ k: 'p', c: 'cannon', x: 2, y: 7 });
  });

  it('a recorded bot battle has the header and its plays; it parses back', () => {
    const b0 = new Bot(0, { react: 14, seed: 1 });
    const b1 = new Bot(1, { react: 14, seed: 2 });
    const rec = recordedBattle(
      { seed: 3, decks: [[...STARTER_DECK], [...STARTER_DECK]], playerLevels: [1, 1] },
      [(s) => b0.next(s), (s) => b1.next(s)],
      1,
    );
    expect(rec.timeline.length - 1).toBe(rec.state.stats[1].played);
    const parsed = parseRecord(rec.timeline);
    expect('record' in parsed).toBe(true);
    if ('record' in parsed) {
      // Side 1's own system: its plays are on its own half (rows 5–9 there) or stacked.
      expect(parsed.record.plays.every((q) => q.y >= 0 && q.y <= 9)).toBe(true);
    }
  });

  it('REC-04: sent after more than 6 cards and 60 seconds; not tutorials and not abandoned', () => {
    const ok = { tutorial: false, abandoned: false, played: 7, ticks: 1201 };
    expect(shouldPush(ok)).toBe(true);
    expect(shouldPush({ ...ok, played: 6 })).toBe(false);
    expect(shouldPush({ ...ok, ticks: 1200 })).toBe(false);
    expect(shouldPush({ ...ok, tutorial: true })).toBe(false);
    expect(shouldPush({ ...ok, abandoned: true })).toBe(false);
  });
});

describe('T-14: checking a record (REP-01)', () => {
  it('accepts a good one: levels, ticks', () => {
    const r = parseRecord([
      header({ lv: [2, 2, 2, 2, 4, 4, 1, 1], pl: 2 }),
      p('wall', 2, 7, 1000),
      p('cannon', 3, 7, 30_025),
    ]);
    expect('record' in r && r.record.plays).toEqual([
      { tick: 20, card: 'wall', x: 2, y: 7 },
      { tick: 600, card: 'cannon', x: 3, y: 7 },
    ]);
    expect('record' in r && r.record.levels.archers).toBe(4);
  });

  it('rejects broken, inflated and impossible ones', () => {
    const bad = (t: { payload: unknown; time: number }[]): string[] => {
      const r = parseRecord(t);
      return 'problems' in r ? r.problems : [];
    };
    expect(bad([])).toEqual(['empty']);
    expect(bad([p('wall', 1, 1, 0)])).toEqual(['no header']);
    expect(bad([header({ v: 2 })])).toContain('version 2');
    expect(
      bad([
        header({
          deck: ['wall', 'wall', 'watch', 'banner', 'repair', 'archers', 'cannon', 'workshop'],
        }),
      ]),
    ).toContain('deck: 8 different known cards');
    expect(bad([header({ deck: [...STARTER_DECK.slice(0, 7), 'dragon'] })])).toContain(
      'deck: 8 different known cards',
    );
    expect(bad([header({ pl: 12 })])).toContain('player level 1-9');
    expect(bad([header({ lv: [5, 1, 1, 1, 1, 1, 1, 1] })])).toContain(
      'card levels 1-9 and at most the player level + 3',
    );
    expect(bad([header(), p('wall', 1, 7, 500), p('wall', 1, 7, 400)])).toContain('times go back');
    expect(bad([header(), p('ice', 1, 7, 500)])).toContain('a card outside the deck: ice');
    expect(bad([header(), { payload: { k: 'p', c: 'wall', x: 9, y: 1 }, time: 5 }])).toContain(
      'a bad play',
    );
    // 12 cannons (48 elixir) in 10 seconds: far more than 5 + 3.6 + 30.
    const greedy = Array.from({ length: 12 }, (_, i) => p('cannon', 3, 7, i * 800));
    expect(bad([header(), ...greedy])[0]).toMatch(/^spends 48 elixir/);
    const long = Array.from({ length: 300 }, (_, i) => p('wall', 1, 7, i * 1000));
    expect(bad([header(), ...long])).toContain('301 events');
  });
});

describe('T-15: replaying a record (REP-02…REP-06)', () => {
  it('turns the cells by 180° and plays at the recorded tick', () => {
    const { s, d } = replay(record([{ tick: 10, card: 'wall', x: 2, y: 8 }]), 12);
    const wall = s.buildings.find((b) => b.kind === 'wall');
    expect(wall && [wall.side, wall.x, wall.y]).toEqual([1, 4, 1]);
    expect(d.stats).toEqual({ exact: 1, moved: 0, droppedCell: 0, droppedElixir: 0 });
    expect(d.finished()).toBe(true);
  });

  it('waits for elixir up to 5 seconds, then drops the event', () => {
    // 5 elixir at the start: the cannon (4) goes at once, the watch (2) waits ~56 ticks.
    const plays = [
      { tick: 0, card: 'cannon' as CardId, x: 2, y: 8 },
      { tick: 0, card: 'watch' as CardId, x: 4, y: 8 },
    ];
    const early = replay(record(plays), 2);
    expect(early.s.buildings.filter((b) => b.kind === 'watch')).toHaveLength(0);
    const { s, d } = replay(record(plays), 70);
    expect(s.buildings.filter((b) => b.kind === 'watch')).toHaveLength(1);
    expect(d.stats.exact).toBe(2);
    // Elixir that never comes in time: the event is dropped after 100 ticks.
    const t = createBattle({
      seed: 1,
      decks: [[...STARTER_DECK], [...STARTER_DECK]],
      playerLevels: [1, 1],
    });
    const late = new RecordDriver(record([{ tick: 0, card: 'cannon', x: 2, y: 8 }]), 1);
    for (let i = 0; i < 120; i++) {
      t.elixir[1] = 0;
      step(t, late.act(t));
    }
    expect(late.stats.droppedElixir).toBe(1);
  });

  it('a taken or unreachable cell moves to the nearest allowed one within 2, or drops', () => {
    // Own (3, 9) is the keep: the wall moves to the nearest free cell, nearer by row first.
    let { s, d } = replay(record([{ tick: 0, card: 'wall', x: 3, y: 9 }]), 2);
    expect(d.stats.moved).toBe(1);
    const wall = s.buildings.find((b) => b.kind === 'wall');
    // Board (3, 0) is side 1's keep; candidates at distance 1 in its row first: (2, 0).
    expect(wall && [wall.x, wall.y]).toEqual([2, 0]);
    // Far beyond the zone (own row 2): nothing within 2 — dropped.
    ({ s, d } = replay(record([{ tick: 0, card: 'wall', x: 3, y: 2 }]), 2));
    expect(d.stats.droppedCell).toBe(1);
    expect(s.buildings.filter((b) => b.kind === 'wall')).toHaveLength(0);
    // Stacking on nothing becomes a new building on the same cell.
    ({ s } = replay(
      record([
        { tick: 0, card: 'wall', x: 2, y: 8 },
        { tick: 0, card: 'wall', x: 2, y: 8 },
      ]),
      2,
    ));
    expect(s.buildings.filter((b) => b.kind === 'wall').map((b) => b.stars)).toEqual([1, 1]);
  });

  it('REP-06, OPP-04: after the last event a bot plays on', () => {
    const bot = new Bot(1, { react: 14, seed: 5 });
    const s = createBattle({
      seed: 1,
      decks: [[...STARTER_DECK], [...STARTER_DECK]],
      playerLevels: [1, 1],
    });
    const d = new RecordDriver(record([{ tick: 0, card: 'wall', x: 2, y: 8 }]), 1, (st) =>
      bot.next(st),
    );
    for (let i = 0; i < 400; i++) step(s, d.act(s));
    expect(d.finished()).toBe(true);
    expect(s.stats[1].played).toBeGreaterThan(1);
  });
});
