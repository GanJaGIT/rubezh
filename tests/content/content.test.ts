import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shopProducts } from '../../src/content';
import { COLS, ROWS, RULES } from '../../src/sim';

/**
 * QA-02: the content in src/content/*.json is complete and consistent. Stage 0 checks the battle
 * frame and the shop; Stage 1 adds the schema (schema.ts) and cards, arenas, chests and bot decks.
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
    expect(RULES.tower.hp).toBe(600_000);
    expect(RULES.keep.hp).toBe(1_000_000);
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
});
