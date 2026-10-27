import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shopProducts } from '../../src/content';
import {
  validateBotDecks,
  validateCards,
  validateChests,
  validateProgression,
} from '../../src/content/schema';
import { CARD_IDS, CARDS, COLS, ROWS, RULES } from '../../src/sim';

const json = (f: string): unknown =>
  JSON.parse(readFileSync(`src/content/${f}`, 'utf8')) as unknown;

/**
 * QA-02: the content in src/content/*.json is complete and consistent: the schema (schema.ts)
 * and the files agreeing with each other.
 */

describe('content (§3.12)', () => {
  it('every content file is valid JSON', () => {
    for (const f of readdirSync('src/content').filter((x) => x.endsWith('.json'))) {
      expect(
        () => JSON.parse(readFileSync(`src/content/${f}`, 'utf8')) as unknown,
        f,
      ).not.toThrow();
    }
  });

  it('GD-11, GD-12: the keep and the towers stand on the back rows inside the field', () => {
    for (const [x, y] of [RULES.keepAt, ...RULES.towersAt]) {
      expect(x >= 0 && x < COLS && y >= 5 && y < ROWS, `${String(x)},${String(y)}`).toBe(true);
    }
    expect(RULES.tower.hp).toBe(600);
    expect(RULES.keep.hp).toBe(1000);
  });

  it('GD-01, GD-20: 3:00 + 1:00, double elixir from 2:00, 5 of 10 at the start', () => {
    expect([RULES.mainTicks, RULES.overtimeTicks, RULES.doubleFromTick]).toEqual([
      3600, 1200, 2400,
    ]);
    expect([RULES.elixirStart, RULES.elixirMax]).toEqual([5000, 10_000]);
  });

  it('YG-14: the shop products are the console ones, the dev catalog lists the same', () => {
    expect(shopProducts.map((p) => p.id).sort()).toEqual([
      'gems_1200',
      'gems_500',
      'gems_80',
      'no_ads',
      'starter_pack',
    ]);
    const catalog = JSON.parse(readFileSync('purchases-catalog.json', 'utf8')) as { id: string }[];
    expect(catalog.map((p) => p.id).sort()).toEqual(shopProducts.map((p) => p.id).sort());
    expect(shopProducts.filter((p) => p.permanent).map((p) => p.id)).toEqual(['no_ads']);
  });

  it('§2.7, §3.12: cards — all 16, by the schema, as in the table of the TZ', () => {
    expect(validateCards(json('cards.json'))).toEqual([]);
    expect(validateCards([{ id: 'wall', cost: 0 }]).length).toBeGreaterThan(5);
    expect(CARD_IDS.filter((c) => CARDS[c].arena === 1)).toHaveLength(8);
    expect(CARD_IDS.filter((c) => CARDS[c].spell).sort()).toEqual(['fireball', 'quake', 'repair']);
  });

  it('OPP-03: 4 bot decks per arena, 8 different cards of the open arenas', () => {
    expect(
      validateBotDecks(
        json('bot-decks.json'),
        (id) => (CARDS as Record<string, { arena: number } | undefined>)[id]?.arena,
      ),
    ).toEqual([]);
    expect(
      validateBotDecks(
        { 1: [['dome']] },
        (id) => (CARDS as Record<string, { arena: number } | undefined>)[id]?.arena,
      ).length,
    ).toBeGreaterThan(0);
  });

  it('CRD-10, LVL-01, CHS-02: progression and chests by the schema', () => {
    expect(validateProgression(json('progression.json'))).toEqual([]);
    expect(validateProgression({ upgrade: [], playerXp: [3, 2] })).toHaveLength(2);
    expect(validateChests(json('chests.json'))).toEqual([]);
    expect(
      validateChests({ types: { wood: { rare: 0.9, epic: 0.2, cards: 4 } }, cycle: { wood: 3 } }),
    ).toHaveLength(2);
  });

  it('ARN-03: arenas open the cards of their arena; thresholds grow', () => {
    const a = json('arenas.json') as { arenas: { id: number; trophies: number }[] };
    expect(a.arenas.map((x) => x.trophies)).toEqual([0, 150, 600, 1000, 1500]);
    for (const x of a.arenas) expect(CARD_IDS.some((c) => CARDS[c].arena === x.id)).toBe(true);
  });

  it('ECO-03: quests have known kinds and a reward', () => {
    const q = json('quests.json') as { pool: { kind: string; gold: number; gems: number }[] };
    const kinds = ['wins', 'battles', 'stacks', 'enemyHalf', 'towers', 'expensive', 'crowns'];
    expect(q.pool.length).toBeGreaterThanOrEqual(3);
    for (const x of q.pool) {
      expect(kinds).toContain(x.kind);
      expect(x.gold + x.gems).toBeGreaterThan(0);
    }
  });
});
