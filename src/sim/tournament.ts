/**
 * §3.10: whole battles without a screen — for the tests (T-12, T-16, T-17), `npm run sim`,
 * `npm run balance` and `npm run bench`. Each side is driven by a function that returns its
 * actions for the coming tick (a bot, a record, a script).
 */

import { createBattle, invariants, step } from './battle';
import { Bot } from './bot';
import { stateHash } from './battle';
import { headerPayload, playPayload } from './record';
import { randomInt } from './rng';
import { CARDS, COLS, ROWS } from './rules';
import {
  CARD_IDS,
  type Action,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type CardId,
  type Side,
} from './types';

export type Driver = (s: BattleState) => Action[];

export interface RunResult {
  state: BattleState;
  /** Invalid actions per side (T-17: a bot makes none). */
  invalid: [number, number];
  /** Broken invariants, if checked (SIM-41). */
  broken: string[];
}

export interface RunOptions {
  /** SIM-41 after every tick (slower). */
  checkInvariants?: boolean;
  /** Called with the events of every tick (records, reports). */
  onEvents?: (events: readonly BattleEvent[], s: BattleState, actions: readonly Action[]) => void;
  maxTicks?: number;
}

export function runBattle(
  setup: BattleSetup,
  drivers: [Driver, Driver],
  o: RunOptions = {},
): RunResult {
  const s = createBattle(setup);
  const invalid: [number, number] = [0, 0];
  const broken: string[] = [];
  const max = o.maxTicks ?? 10_000;
  while (s.phase !== 'ended' && s.tick < max) {
    const actions = [...drivers[0](s), ...drivers[1](s)];
    const events = step(s, actions);
    for (const e of events) if (e.type === 'invalid') invalid[e.side] += 1;
    o.onEvents?.(events, s, actions);
    if (o.checkInvariants) {
      const p = invariants(s);
      if (p.length > 0) broken.push(`tick ${String(s.tick)}: ${p.join('; ')}`);
    }
  }
  return { state: s, invalid, broken };
}

/** BAL-01: a random deck of 8 different cards (of the arenas up to `arena`). */
export function randomDeck(random: { rng: number }, arena = 5): CardId[] {
  const pool = CARD_IDS.filter((c) => CARDS[c].arena <= arena);
  const deck: CardId[] = [];
  while (deck.length < 8) {
    const c = pool[randomInt(random, pool.length)] as CardId;
    if (!deck.includes(c)) deck.push(c);
  }
  return deck;
}

/** The winner of a finished battle, or null for a draw. */
export const winnerOf = (s: BattleState): Side | null => s.result?.winner ?? null;

/** REC-01, REC-02: a battle with one side recorded the way the game commits it to the SDK. */
export function recordedBattle(
  setup: BattleSetup,
  drivers: [Driver, Driver],
  side: Side,
  o: RunOptions = {},
): RunResult & { timeline: { payload: unknown; time: number }[] } {
  const deck = setup.decks[side];
  const timeline: { payload: unknown; time: number }[] = [
    {
      payload: headerPayload({
        deck,
        lv: deck.map((c) => setup.cardLevels?.[side][c] ?? 1),
        pl: setup.playerLevels[side],
        ar: 1,
        seed: setup.seed,
      }),
      time: 0,
    },
  ];
  const res = runBattle(setup, drivers, {
    ...o,
    onEvents: (events, s, actions) => {
      o.onEvents?.(events, s, actions);
      const done = events.some(
        (e) =>
          (e.type === 'placed' || e.type === 'stacked' || e.type === 'spell') && e.side === side,
      );
      const a = actions.find((x) => x.type === 'play' && x.side === side);
      if (!done || !a || a.type !== 'play') return;
      // The record keeps the player's own system of coordinates (REC-01).
      const x = side === 0 ? a.x : COLS - 1 - a.x;
      const y = side === 0 ? a.y : ROWS - 1 - a.y;
      timeline.push({ payload: playPayload(a.card, x, y), time: (s.tick - 1) * 50 });
    },
  });
  return { ...res, timeline };
}

/**
 * SIM-40: a reference battle — random decks of the seed, two normal bots — and its final state
 * hash. The same seeds give the same hashes in Node (unit tests) and in the browser (e2e):
 * tests/fixtures/sim-hashes.json.
 */
export function referenceHash(seed: number): number {
  const r = { rng: seed };
  const b0 = new Bot(0, { react: 14, seed: seed * 3 + 1 });
  const b1 = new Bot(1, { react: 14, seed: seed * 3 + 2 });
  const res = runBattle({ seed, decks: [randomDeck(r), randomDeck(r)], playerLevels: [1, 2] }, [
    (s) => b0.next(s),
    (s) => b1.next(s),
  ]);
  return stateHash(res.state);
}
