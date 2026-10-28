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
  /** The card's level (CRD-03); for the keep and the towers — the player's (LVL-04). */
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

export type CardLevels = Partial<Record<CardId, number>>;

/** What a battle starts from: both sides' decks and levels and the seed (SIM-43). */
export interface BattleSetup {
  seed: number;
  /** GD-30: 8 different cards each. */
  decks: [CardId[], CardId[]];
  /** CRD-03: card levels of each side (1 when not given). */
  cardLevels?: [CardLevels, CardLevels];
  /** LVL-04: the players' levels grow the keep and the towers. */
  playerLevels: [number, number];
  /** TUT-01…TUT-03: false keeps the decks in order (the tutorial hands its cards one by one). */
  shuffle?: boolean;
  /**
   * TUT: buildings placed before the battle (board coordinates), and existing ones changed: a
   * keep or a tower already standing on the cell gets the given share of hit points (‰).
   */
  preset?: { side: Side; kind: BuildingKind; x: number; y: number; hpPm?: number }[];
}

/** What a side did — for the quests (ECO-03), the record rules (REC-04) and the reports. */
export interface SideStats {
  played: number;
  stacks: number;
  /** Buildings placed on the opponent's half (rows of the other side). */
  enemyHalf: number;
  /** Cards of 4 elixir and more played. */
  expensive: number;
  /** Enemy towers and keep destroyed. */
  towers: number;
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
  /** GD-21: workshop-ticks gathered towards the next unit. */
  workshopAcc: [number, number];
  /** GD-30, GD-31: the queue behind the hand; the first card is "next". */
  deck: [CardId[], CardId[]];
  hand: [CardId[], CardId[]];
  crowns: [number, number];
  result: BattleResult | null;
  stats: [SideStats, SideStats];
}

/**
 * §3.4: the only ways to change a battle — from the player, the bot and a replayed record alike.
 * `record`: a replayed record plays its own cards, the hand is not modelled (REP-02).
 * `surrender` is the "Surrender" button of the Pause screen (UI-08).
 */
export type Action =
  | { type: 'play'; side: Side; card: CardId; x: number; y: number; record?: boolean }
  | { type: 'surrender'; side: Side };

export type InvalidReason = 'ended' | 'notInHand' | 'elixir' | 'cell';

export type Projectile = 'arrow' | 'ball' | 'stone' | 'bolt' | 'shard';

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
  | { type: 'stacked'; id: number; side: Side; stars: number }
  | { type: 'spell'; side: Side; card: CardId; x: number; y: number }
  | { type: 'shot'; from: number; to: number; projectile: Projectile }
  | { type: 'damaged'; id: number; amount: number }
  | { type: 'healed'; id: number; amount: number }
  | { type: 'destroyed'; id: number; side: Side; kind: BuildingKind; x: number; y: number }
  | { type: 'crown'; side: Side; crowns: number }
  | { type: 'zoneChanged' }
  | { type: 'invalid'; side: Side; reason: InvalidReason }
  | { type: 'elixirFull'; side: Side }
  | { type: 'doubleElixir' }
  | { type: 'overtime' }
  | { type: 'ended'; result: BattleResult };
