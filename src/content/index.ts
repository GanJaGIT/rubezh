/**
 * §3.12: all content is JSON in src/content/. Loaded and checked here once; the game, the scripts
 * and the tests get the same data. Content never lives in code. The battle numbers are read by
 * src/sim/rules.ts; the card, arena and progression files join in Stage 1.
 */

import type { ShopProductDef } from '../services/shop';
import type { CardId } from '../sim/types';
import shop from './shop.json';
import starterDeck from './starter-deck.json';

export const shopProducts: readonly ShopProductDef[] = shop;

/** CRD-01: the starting deck — the 8 cards of arena 1, level 1. */
export const STARTER_DECK: readonly CardId[] = starterDeck as CardId[];
