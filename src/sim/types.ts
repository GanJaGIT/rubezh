/**
 * §3.2: the battle model. Plain data (JSON-serialisable): the state is copied, hashed (SIM-40) and
 * checked for invariants (SIM-41). Coordinates are in side 0's system (GD-10): column x 0–6 left
 * to right, row y 0–9 top to bottom, side 0 owns rows 5–9. Fractional values (elixir, hit points)
 * are whole thousandths (SIM-04); durations are ticks (SIM-01).
 */

export type Side = 0 | 1;

/** §2.7: the cards of version 1.0. */
export const CARD_IDS = [
  'wall',
  'watch',
  'banner',
  'repair',
  'archers',
  'cannon',
  'workshop',
  'fireball',
  'outpost',
  'healer',
  'mortar',
  'ballista',
  'ice',
  'quake',
  'dome',
  'catapult',
] as const;
export type CardId = (typeof CARD_IDS)[number];

export type BuildingKind = CardId | 'keep' | 'tower';

export interface Building {
  id: number;
  side: Side;
  kind: BuildingKind;
  x: number;
  y: number;
  /** Thousandths of a hit point (SIM-04). */
  hp: number;
  maxHp: number;
  stars: 1 | 2 | 3;
  level: number;
  /** Ticks until the next shot (SIM-22: one second of deployment at first). */
  cooldown: number;
  /** Ticks of the ice slow left (SIM-32). */
  slowTicks: number;
}

export type Phase = 'main' | 'overtime' | 'ended';

export interface BattleResult {
  /** null — a draw (WIN-04). */
  winner: Side | null;
  reason: 'keep' | 'crowns' | 'overtime' | 'hp' | 'draw' | 'surrender';
}

/** What a battle starts from: both sides' decks and levels and the seed (SIM-43). */
export interface BattleSetup {
  seed: number;
  /** GD-30: 8 different cards each; an empty deck plays no cards (Stage 0 field). */
  decks: [CardId[], CardId[]];
  /** LVL-04: the players' levels grow the keep and the towers. */
  playerLevels: [number, number];
}

export interface BattleState {
  setup: BattleSetup;
  tick: number;
  phase: Phase;
  /** SIM-43: mulberry32 state; the simulation's only randomness. */
  rng: number;
  buildings: Building[];
  nextId: number;
  /** GD-20: thousandths of a unit, 0…10 000. */
  elixir: [number, number];
  /** GD-20: the remainder of the elixir growth, in 1/regenTicks of a thousandth. */
  elixirAcc: [number, number];
  /** GD-21: ticks the workshops have run towards their next unit. */
  workshopAcc: [number, number];
  /** GD-30, GD-31: the queue behind the hand; the first card is "next". */
  deck: [CardId[], CardId[]];
  hand: [CardId[], CardId[]];
  crowns: [number, number];
  result: BattleResult | null;
}

/**
 * §3.4: the only ways to change a battle — from the player, the bot and a replayed record alike.
 * `surrender` is the "Surrender" button of the Pause screen (UI-08).
 */
export type Action =
  | { type: 'play'; side: Side; card: CardId; x: number; y: number }
  | { type: 'surrender'; side: Side };

export type InvalidReason = 'ended' | 'notInHand' | 'elixir' | 'cell' | 'notReady';

/** SIM-50: what happened during a tick — for the drawing, the sound and the tests. */
export type BattleEvent =
  | {
      type: 'placed';
      id: number;
      side: Side;
      kind: BuildingKind;
      x: number;
      y: number;
      stars: number;
    }
  | { type: 'invalid'; side: Side; reason: InvalidReason }
  | { type: 'elixirFull'; side: Side }
  | { type: 'doubleElixir' }
  | { type: 'overtime' }
  | { type: 'ended'; result: BattleResult };
