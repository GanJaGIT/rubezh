/**
 * §2.15: the three tutorial battles against a passive bot (BOT-04: it does nothing).
 * TUT-01 — place a cannon, watch it shoot, bring a tower down. TUT-02 — the frontline: walls
 * forward until one stands on the enemy half. TUT-03 — stacking a star, the elixir bar.
 * Hints are a line of text, the glowing card and a frame on the cell (TUT-01). Each battle has its
 * own field (a deck in order, a few buildings set in advance), so every step can be reached.
 */

import {
  COLS,
  zoneOf,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type CardId,
} from './sim';

export type TutorialStep = 1 | 2 | 3;

export interface TutorialHost {
  /** A hint line (an i18n key) or null. */
  say(key: string | null): void;
  /** The card of the hand to glow (-1 — none). */
  card(i: number): void;
  /** The cell to frame (null — none). */
  cell(c: { x: number; y: number } | null): void;
  /** The battle's goal is reached. */
  done(step: TutorialStep): void;
}

const fill = (first: CardId[], rest: CardId): CardId[] => [
  ...first,
  ...Array<CardId>(8 - first.length).fill(rest),
];

/** The field of each tutorial battle (board coordinates; side 1 is the passive bot). */
export function tutorialSetup(step: TutorialStep, playerLevel: number): BattleSetup {
  const base = {
    seed: 7,
    shuffle: false,
    playerLevels: [playerLevel, playerLevel] as [number, number],
  };
  switch (step) {
    case 1:
      // A path of walls already leads forward; the enemy tower in front of it is half-ruined.
      return {
        ...base,
        decks: [fill(['cannon', 'wall', 'watch', 'archers'], 'wall'), fill([], 'wall')],
        preset: [
          { side: 0, kind: 'wall', x: 1, y: 6 },
          { side: 0, kind: 'wall', x: 1, y: 5 },
          { side: 0, kind: 'wall', x: 1, y: 4 },
          { side: 1, kind: 'tower', x: 1, y: 1, hpPm: 300 },
        ],
      };
    case 2:
      return { ...base, decks: [fill([], 'wall'), fill([], 'wall')] };
    case 3:
      return {
        ...base,
        decks: [fill(['cannon', 'cannon', 'wall', 'wall'], 'cannon'), fill([], 'wall')],
      };
  }
}

export class Tutorial {
  private phase = 0;

  constructor(
    readonly step: TutorialStep,
    private readonly host: TutorialHost,
    state: BattleState,
  ) {
    this.enter(state);
  }

  /** A card was chosen or let go. */
  chose(i: number): void {
    if (this.step === 1 && this.phase === 0) this.host.cell(i === 0 ? { x: 1, y: 3 } : null);
  }

  tick(events: readonly BattleEvent[], s: BattleState): void {
    const mine = (type: BattleEvent['type']): boolean =>
      events.some((e) => e.type === type && 'side' in e && e.side === 0);
    switch (this.step) {
      case 1:
        if (this.phase === 0 && mine('placed')) {
          this.phase = 1;
          this.host.card(-1);
          this.host.cell(null);
          this.host.say('tut.1.shoot');
        } else if (this.phase === 1 && events.some((e) => e.type === 'crown' && e.side === 0)) {
          this.finish();
        }
        break;
      case 2:
        if (s.stats[0].enemyHalf > 0) this.finish();
        else if (mine('placed')) this.host.cell(this.front(s));
        break;
      case 3:
        if (this.phase === 0 && mine('placed')) {
          this.phase = 1;
          const cannon = s.buildings.find((b) => b.side === 0 && b.kind === 'cannon');
          this.host.say('tut.3.stack');
          this.host.cell(cannon ? { x: cannon.x, y: cannon.y } : null);
          this.host.card(s.hand[0].indexOf('cannon'));
        } else if (this.phase === 1 && s.stats[0].stacks > 0) {
          this.finish();
        }
        break;
    }
  }

  private enter(s: BattleState): void {
    switch (this.step) {
      case 1:
        this.host.say('tut.1.place');
        this.host.card(0);
        break;
      case 2:
        this.host.say('tut.2.walls');
        this.host.card(0);
        this.host.cell(this.front(s));
        break;
      case 3:
        this.host.say('tut.3.place');
        this.host.card(0);
        break;
    }
  }

  /** TUT-02: the next cell forward in the middle column — where the frontline grows. */
  private front(s: BattleState): { x: number; y: number } | null {
    const zone = zoneOf(s, 0);
    const x = 3;
    for (let y = 0; y < 10; y++) {
      const i = y * COLS + x;
      if (zone[i] === 1 && !s.buildings.some((b) => b.x === x && b.y === y)) return { x, y };
    }
    return null;
  }

  private finish(): void {
    if (this.phase === 9) return;
    this.phase = 9;
    this.host.say(null);
    this.host.card(-1);
    this.host.cell(null);
    this.host.done(this.step);
  }
}
