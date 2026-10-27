/**
 * §2.13: chests — the cycle of 20 wins (CHS-02), four slots (CHS-01), one opening at a time and
 * its speed-ups (CHS-04), the free chest every 4 hours and the crown chest (CHS-02 table), the
 * contents by arena with at most 4 kinds of cards (CHS-03). Time is the server clock (YG-25),
 * passed in; randomness is a seeded generator, passed in.
 */

import chests from '../content/chests.json';
import { CARDS, randomInt, nextRandom, type CardId, type Rarity } from '../sim';
import { unlockedCards } from './collection';
import type { ChestSlot, ChestType, SaveData } from './save-data';

export type ChestKind = ChestType | 'free' | 'crown';
export type Random = { rng: number };

interface ChestDef {
  openSec: number;
  gold: number;
  cards: number;
  rare: number;
  epic: number;
}

const TYPES = chests.types as Record<ChestKind, ChestDef>;
const HOUR = 3600_000;

/** CHS-02: 14 wooden, 5 silver and 1 gold chest, shuffled once for the profile. */
export function createCycle(random: Random): ChestType[] {
  const order: ChestType[] = [];
  for (const [type, n] of Object.entries(chests.cycle) as [ChestType, number][]) {
    for (let i = 0; i < n; i++) order.push(type);
  }
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    [order[i], order[j]] = [order[j] as ChestType, order[i] as ChestType];
  }
  return order;
}

/** CHS-01: a win puts the next chest of the cycle into a free slot; no slot — no chest. */
export function awardChest(save: SaveData, random: Random): ChestType | null {
  const slot = save.chests.findIndex((c) => c === null);
  if (slot < 0) return null;
  if (save.chestCycle.order.length === 0)
    save.chestCycle = { order: createCycle(random), index: 0 };
  const order = save.chestCycle.order;
  const type = order[save.chestCycle.index % order.length] as ChestType;
  save.chestCycle.index = (save.chestCycle.index + 1) % order.length;
  save.chests[slot] = { type, unlockStartedAt: null, adSkips: 0 };
  return type;
}

/** CHS-04: only one chest opens at a time. */
export function startUnlock(save: SaveData, slot: number, now: number): boolean {
  const c = save.chests[slot];
  if (!c || c.unlockStartedAt !== null) return false;
  if (save.chests.some((x) => x !== null && x.unlockStartedAt !== null)) return false;
  c.unlockStartedAt = now;
  return true;
}

/** Ms left until the chest opens (0 — ready); a chest not started counts its whole time. */
export function timeLeft(c: ChestSlot, now: number): number {
  const total = TYPES[c.type].openSec * 1000 - c.adSkips * chests.adSkipSec * 1000;
  const spent = c.unlockStartedAt === null ? 0 : now - c.unlockStartedAt;
  return Math.max(0, total - spent);
}

/** CHS-04: 1 gem for every 10 minutes left, rounded up. */
export const speedUpCost = (leftMs: number): number =>
  Math.ceil(leftMs / (chests.gemPerMinutes * 60_000));

/** CHS-04: −1 hour for an ad, at most 3 times a chest (the reward comes in onRewarded). */
export function adSkip(c: ChestSlot): boolean {
  if (c.unlockStartedAt === null || c.adSkips >= chests.adSkipsPerChest) return false;
  c.adSkips += 1;
  return true;
}

/** Takes a ready chest (or pays gems for the rest) from its slot; null if it is not ready. */
export function takeChest(
  save: SaveData,
  slot: number,
  now: number,
  payGems = false,
): ChestType | null {
  const c = save.chests[slot];
  if (!c) return null;
  const left = timeLeft(c, now);
  if (left > 0) {
    if (!payGems || c.unlockStartedAt === null) return null;
    const cost = speedUpCost(left);
    if (save.gems < cost) return null;
    save.gems -= cost;
  }
  save.chests[slot] = null;
  return c.type;
}

/** The free chest: one every 4 hours, up to 2 kept. Brings the counter to `now`. */
export function refreshFreeChest(save: SaveData, now: number): void {
  const f = save.freeChest;
  const every = chests.freeEverySec * 1000;
  if (f.stored >= chests.freeMaxStored) return;
  if (f.nextAt === 0) f.nextAt = now + every;
  while (f.stored < chests.freeMaxStored && now >= f.nextAt) {
    f.stored += 1;
    f.nextAt += every;
  }
  if (f.stored >= chests.freeMaxStored) f.nextAt = 0;
}

export function takeFreeChest(save: SaveData, now: number): boolean {
  refreshFreeChest(save, now);
  if (save.freeChest.stored === 0) return false;
  save.freeChest.stored -= 1;
  if (save.freeChest.nextAt === 0) save.freeChest.nextAt = now + chests.freeEverySec * 1000;
  return true;
}

/** The crown chest: 10 crowns won in a day (Moscow day by the server clock). */
export function addCrowns(save: SaveData, crowns: number, day: number): void {
  if (save.crowns.day !== day) save.crowns = { day, count: 0, claimed: false };
  save.crowns.count += crowns;
}

export function takeCrownChest(save: SaveData, day: number): boolean {
  const c = save.crowns;
  if (c.day !== day || c.claimed || c.count < chests.crownsForChest) return false;
  c.claimed = true;
  return true;
}

export interface ChestContents {
  gold: number;
  cards: Partial<Record<CardId, number>>;
}

/** CHS-03: gold and cards × (1 + 0.25 × (arena − 1)). */
export function chestSize(kind: ChestKind, arena: number): { gold: number; cards: number } {
  const k = 1 + chests.arenaBonus * (arena - 1);
  return { gold: Math.round(TYPES[kind].gold * k), cards: Math.round(TYPES[kind].cards * k) };
}

/**
 * CHS-03: every card rolls its rarity (CHS-02 chances); cards come only from the arenas open,
 * at most 4 kinds a chest — every rarity rolled gets at least one kind, the commons get the
 * kinds left. A rarity with no open card falls back to the next lower one.
 */
export function openChest(kind: ChestKind, arena: number, random: Random): ChestContents {
  const def = TYPES[kind];
  const size = chestSize(kind, arena);
  const pool = unlockedCards(arena);
  const byRarity = (r: Rarity): CardId[] => pool.filter((c) => CARDS[c].rarity === r);
  const count: Record<Rarity, number> = { common: 0, rare: 0, epic: 0 };
  for (let i = 0; i < size.cards; i++) {
    const roll = nextRandom(random);
    let r: Rarity = roll < def.epic ? 'epic' : roll < def.epic + def.rare ? 'rare' : 'common';
    if (r === 'epic' && byRarity('epic').length === 0) r = 'rare';
    if (r === 'rare' && byRarity('rare').length === 0) r = 'common';
    count[r] += 1;
  }
  const rarities: Rarity[] = (['epic', 'rare', 'common'] as Rarity[]).filter((r) => count[r] > 0);
  const kinds: Record<Rarity, number> = { common: 0, rare: 0, epic: 0 };
  for (const r of rarities) kinds[r] = 1;
  let free = chests.maxKinds - rarities.length;
  for (const r of ['common', 'rare'] as Rarity[]) {
    while (free > 0 && kinds[r] > 0 && kinds[r] < Math.min(count[r], byRarity(r).length)) {
      kinds[r] += 1;
      free -= 1;
    }
  }
  const cards: Partial<Record<CardId, number>> = {};
  for (const r of rarities) {
    const options = [...byRarity(r)];
    const chosen: CardId[] = [];
    while (chosen.length < kinds[r]) {
      chosen.push(options.splice(randomInt(random, options.length), 1)[0] as CardId);
    }
    // Each kind gets at least one copy; the rest are spread at random.
    chosen.forEach((c) => (cards[c] = 1));
    for (let i = chosen.length; i < count[r]; i++) {
      const c = chosen[randomInt(random, chosen.length)] as CardId;
      cards[c] = (cards[c] ?? 0) + 1;
    }
  }
  return { gold: size.gold, cards };
}

/** Hours a chest takes, for the interface. */
export const openHours = (kind: ChestKind): number => (TYPES[kind].openSec * 1000) / HOUR;
