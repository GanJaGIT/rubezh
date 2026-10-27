import type { CardId } from '../sim';

/** CHS-01, CHS-02: a chest in one of the four slots. */
export type ChestType = 'wood' | 'silver' | 'gold';

export interface ChestSlot {
  type: ChestType;
  /** Server time the opening started (CHS-04: one at a time), or null. */
  unlockStartedAt: number | null;
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
