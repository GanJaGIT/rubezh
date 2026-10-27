/**
 * ECO-04: "Card of the day" — 6 offers of cards of the open arenas for gold (a common copy
 * costs 10, a rare 100, an epic 1000; at most 10 copies of a common and 1 epic a day); the first
 * offer is free for an ad (YG-11). Renewed with the Moscow day (YG-25).
 */

import shop from '../content/shop.json';
import { CARDS, randomInt, type CardId, type Rarity } from '../sim';
import { addCards, unlockedCards } from './collection';
import type { SaveData } from './save-data';

/** The offers of a new day: different cards, at most one epic. */
export function rollOffers(save: SaveData, day: number, random: { rng: number }): boolean {
  if (save.shop.day === day && save.shop.offers.length > 0) return false;
  const pool = unlockedCards(save.player.arena);
  const offers: SaveData['shop']['offers'] = [];
  let epics = 0;
  while (offers.length < Math.min(shop.offers, pool.length)) {
    const card = pool.splice(randomInt(random, pool.length), 1)[0] as CardId;
    const rarity = CARDS[card].rarity;
    if (rarity === 'epic' && epics >= 1) continue;
    if (rarity === 'epic') epics += 1;
    offers.push({ card, copies: shop.copies[rarity] });
  }
  save.shop = { day, offers, bought: [] };
  return true;
}

/** The free offers come for an ad: index below freeOffers. */
export const isFreeOffer = (index: number): boolean => index < shop.freeOffers;

export function offerPrice(offer: { card: CardId; copies: number }, index: number): number {
  if (isFreeOffer(index)) return 0;
  return offer.copies * shop.pricePerCopy[CARDS[offer.card].rarity as Rarity];
}

/** Buys an offer (a free one only after a watched ad: `watched`). */
export function buyOffer(save: SaveData, index: number, watched = false): boolean {
  const offer = save.shop.offers[index];
  if (!offer || save.shop.bought.includes(index)) return false;
  if (isFreeOffer(index) && !watched) return false;
  const price = offerPrice(offer, index);
  if (save.gold < price) return false;
  save.gold -= price;
  save.shop.bought.push(index);
  addCards(save, { [offer.card]: offer.copies });
  return true;
}
