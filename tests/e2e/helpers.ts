import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { DevHooks } from '../../src/dev';
import type { BattleState } from '../../src/sim';

declare global {
  interface Window {
    __game?: DevHooks;
  }
}

export type Point = { x: number; y: number };

/** The save key of this game (package.json "name"), as the build uses it. */
const SAVE_KEY = `${(JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }).name}.save`;

export async function openGame(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__game?.isReady() === true);
}

export async function state(page: Page): Promise<ReturnType<DevHooks['state']>> {
  const s = await page.evaluate(() => window.__game?.state());
  if (!s) throw new Error('no game');
  return s;
}

export async function sim(page: Page): Promise<BattleState> {
  const s = await page.evaluate(() => window.__game?.sim());
  if (!s) throw new Error('no battle');
  return s;
}

/** Client coordinates of a cell centre. */
export async function cell(page: Page, x: number, y: number): Promise<Point> {
  const p = await page.evaluate(([cx, cy]) => window.__game?.cellClient(cx, cy), [x, y] as const);
  if (!p) throw new Error('no field');
  return p;
}

/** A save before the game loads (an init script; only if there is none yet). */
export async function presetSave(page: Page, save: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([key, data]) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify({ v: 1, updatedAt: 1, ...data }));
      }
    },
    [SAVE_KEY, save] as const,
  );
}

/** A player who has played `n` battles: the menu opens at launch (UI-02). */
export const played = (n: number, wins = 0): Record<string, unknown> => ({
  stats: { battles: n, wins },
  tutorial: { done: true, step: 0 },
});

/** A battle that ends at once: the opponent surrenders (or the player does, for a loss). */
async function quickEnd(page: Page, winner: 0 | 1): Promise<void> {
  await page.evaluate((w) => {
    window.__game?.openBattle();
    window.__game?.stopTime();
    window.__game?.finish(w);
  }, winner);
  await page.waitForSelector('[data-ui="battle-result"]');
}

export const quickWin = (page: Page): Promise<void> => quickEnd(page, 0);
export const quickLoss = (page: Page): Promise<void> => quickEnd(page, 1);
