/**
 * OPP-03: the stand-in opponent — a bot with a deck of src/content/bot-decks.json for the player's
 * arena, its cards at the player's levels (a card the player owns — its level; one the player
 * has not got — the deck's average, not below the card's start level, CRD-11), and a speed by the
 * trophies: the newest players meet the easy bot.
 */

import botDecks from '../content/bot-decks.json';
import { config } from '../config';
import { randomInt, type CardId, type CardLevels } from '../sim';
import { startLevel } from './collection';
import type { SaveData } from './save-data';

/** The number of bot names in src/i18n (bot.name.1…). */
export const BOT_NAMES = 8;
/** Below these trophies the bot is easy, above the second — hard. */
const EASY_BELOW = 150;
const HARD_FROM = 1000;

export interface BotOpponent {
  deck: CardId[];
  levels: CardLevels;
  /** BOT-01: ticks between decisions. */
  react: number;
  /** Which bot.name.N to show. */
  name: number;
}

export function botOpponent(save: SaveData, random: { rng: number }): BotOpponent {
  const pool = (botDecks as Record<string, CardId[][]>)[String(save.player.arena)] ?? [];
  const deck = [...(pool[randomInt(random, pool.length)] ?? [])];
  const mine = save.decks[save.activeDeck] ?? [];
  const avg = Math.max(
    1,
    Math.round(
      mine.reduce((n, c) => n + (save.cards[c]?.level ?? 1), 0) / Math.max(1, mine.length),
    ),
  );
  const levels: CardLevels = Object.fromEntries(
    deck.map((c) => [c, save.cards[c]?.level ?? Math.max(avg, startLevel(c))]),
  );
  const t = save.player.trophies;
  const react =
    t < EASY_BELOW ? config.bots.easy : t >= HARD_FROM ? config.bots.hard : config.bots.normal;
  return { deck, levels, react, name: 1 + randomInt(random, BOT_NAMES) };
}
