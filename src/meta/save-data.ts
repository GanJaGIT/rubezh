import starterDeck from '../content/starter-deck.json';
import type { CardId } from '../sim/types';

/** CRD-01: the starting deck (src/content/starter-deck.json). */
const STARTER = starterDeck as CardId[];

export const SAVE_VERSION = 1;

/** CHS-01, CHS-02: a chest in one of the four slots. */
export type ChestType = 'wood' | 'silver' | 'gold';

export interface ChestSlot {
  type: ChestType;
  /** Server time the opening started (CHS-04: one at a time), or null. */
  unlockStartedAt: number | null;
  /** CHS-04: hours skipped for ads (at most 3 per chest). */
  adSkips: number;
}

/**
 * §3.12, YG-07: saved progress. `v` is the schema version (migrate() in save.ts reads older and
 * broken copies), `updatedAt` picks the fresher of the local and the cloud copy. Under 20 KB
 * (YG-08, a unit test checks the worst case). The meta fields fill in with Stage 3.
 */
export interface SaveData {
  v: number;
  updatedAt: number;
  player: { level: number; xp: number; trophies: number; bestTrophies: number; arena: number };
  gold: number;
  gems: number;
  cards: Partial<Record<CardId, { level: number; copies: number }>>;
  /** GD-32: three decks, one active. */
  decks: [CardId[], CardId[], CardId[]];
  activeDeck: number;
  chests: (ChestSlot | null)[];
  chestCycle: { order: ChestType[]; index: number };
  freeChest: { nextAt: number; stored: number };
  crowns: { day: number; count: number; claimed: boolean };
  quests: { day: number; items: { id: string; progress: number; claimed: boolean }[] };
  shop: { day: number; offers: { card: CardId; copies: number }[]; bought: number[] };
  tutorial: { done: boolean; step: number };
  stats: { battles: number; wins: number };
  settings: { sound: boolean; music: boolean; lang: string | null };
  /** YG-14: the "No ads" purchase. */
  noAds: boolean;
  /** YG-16: the review was asked (once). */
  reviewAsked: boolean;
  /** YG-10: server time of the last fullscreen ad — a reload does not reset the 180 s gap. */
  lastInterstitialAt: number;
  /** One-time things: applied one-off purchases, "New" cards (TUT-04). Keys. */
  seen: string[];
}

/** A new profile: the 8 cards of arena 1 at level 1 in the first deck (CRD-01). */
export function defaultSave(): SaveData {
  return {
    v: SAVE_VERSION,
    updatedAt: 0,
    player: { level: 1, xp: 0, trophies: 0, bestTrophies: 0, arena: 1 },
    gold: 0,
    gems: 0,
    cards: Object.fromEntries(STARTER.map((id) => [id, { level: 1, copies: 0 }])),
    decks: [[...STARTER], [], []],
    activeDeck: 0,
    chests: [null, null, null, null],
    chestCycle: { order: [], index: 0 },
    freeChest: { nextAt: 0, stored: 1 },
    crowns: { day: 0, count: 0, claimed: false },
    quests: { day: 0, items: [] },
    shop: { day: 0, offers: [], bought: [] },
    tutorial: { done: false, step: 0 },
    stats: { battles: 0, wins: 0 },
    settings: { sound: true, music: true, lang: null },
    noAds: false,
    reviewAsked: false,
    lastInterstitialAt: 0,
    seen: [],
  };
}
