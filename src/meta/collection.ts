/**
 * §2.12, §2.8: the collection — cards and copies, upgrades (CRD-10), the player's experience
 * and level (LVL-01), rare and epic cards joining at higher levels (CRD-11), the cards each
 * arena opens (ARN-03, CRD-12).
 */

import progression from '../content/progression.json';
import { CARD_IDS, CARDS, type CardId } from '../sim';
import type { SaveData } from './save-data';

export interface UpgradeStep {
  to: number;
  copies: number;
  gold: number;
  xp: number;
}

const STEPS = progression.upgrade as UpgradeStep[];

/** CRD-12, ARN-03: the cards of the arenas up to this one. */
export function unlockedCards(arena: number): CardId[] {
  return CARD_IDS.filter((c) => CARDS[c].arena <= arena);
}

/** CRD-11: a rare card joins the collection at level 3, an epic one at 6. */
export function startLevel(card: CardId): number {
  return progression.startLevel[CARDS[card].rarity];
}

/** Adds copies; a new card joins at its start level. Returns the cards that are new. */
export function addCards(save: SaveData, cards: Partial<Record<CardId, number>>): CardId[] {
  const fresh: CardId[] = [];
  for (const [id, n] of Object.entries(cards) as [CardId, number][]) {
    if (n <= 0) continue;
    const have = save.cards[id];
    if (have) have.copies += n;
    else {
      save.cards[id] = { level: startLevel(id), copies: n - 1 };
      fresh.push(id);
    }
  }
  return fresh;
}

/** CRD-10: what the next level of a card costs, or null at the top. */
export function upgradeCost(level: number): UpgradeStep | null {
  return STEPS.find((s) => s.to === level + 1) ?? null;
}

export function canUpgrade(save: SaveData, card: CardId): boolean {
  const c = save.cards[card];
  const step = c ? upgradeCost(c.level) : null;
  return !!c && !!step && c.copies >= step.copies && save.gold >= step.gold;
}

/** LVL-01: the player's level for this much experience (1–9). */
export function playerLevelFor(xp: number): number {
  return 1 + progression.playerXp.filter((t) => xp >= t).length;
}

/** CRD-10: copies and gold for a level of the card and experience for the player. */
export function upgrade(save: SaveData, card: CardId): boolean {
  if (!canUpgrade(save, card)) return false;
  const c = save.cards[card] as { level: number; copies: number };
  const step = upgradeCost(c.level) as UpgradeStep;
  c.copies -= step.copies;
  c.level = step.to;
  save.gold -= step.gold;
  save.player.xp += step.xp;
  save.player.level = playerLevelFor(save.player.xp);
  return true;
}

/** The levels of a deck, for a battle setup and a record header (REC-02). */
export function deckLevels(
  save: SaveData,
  deck: readonly CardId[],
): Partial<Record<CardId, number>> {
  return Object.fromEntries(deck.map((c) => [c, save.cards[c]?.level ?? 1]));
}
