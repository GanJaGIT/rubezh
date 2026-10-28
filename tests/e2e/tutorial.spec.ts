import { expect, test, type Page } from '@playwright/test';
import { openGame, presetSave, played, sim, state } from './helpers';

/**
 * QA-03, Stage 2: the battle by hand — cards by drag, by tap and by keys (INP-01…INP-05), the
 * building plate (INP-04), a bot that plays (OPP-03), the tutorial (TUT-01…TUT-03). Chromium and
 * mobile WebKit.
 */

async function cell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const c = await page.evaluate(([cx, cy]) => window.__game?.cellClient(cx, cy), [x, y] as const);
  if (!c) throw new Error('no field');
  return c;
}

async function tap(page: Page, x: number, y: number): Promise<void> {
  const c = await cell(page, x, y);
  await page.mouse.click(c.x, c.y);
}

/** A card of the hand (a glowing card scales: clicked at its centre, not waited for). */
async function card(page: Page, i: number): Promise<void> {
  const b = await page.locator(`[data-ui="card-${String(i)}"]`).boundingBox();
  if (!b) throw new Error(`no card ${String(i)}`);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

const ticks = (page: Page, n: number): Promise<void> =>
  page.evaluate((k) => window.__game?.tick(k), n);

/** The first building card of the hand (not a spell). */
async function buildingCard(page: Page): Promise<number> {
  const hand = (await sim(page)).hand[0];
  return hand.findIndex((c) => c !== 'fireball' && c !== 'repair' && c !== 'quake');
}

test('OPP-03, UI-10: a battle against a bot — the hand of 4 and the next card, the bot builds', async ({
  page,
}) => {
  await presetSave(page, played(1));
  await openGame(page, '?battle=1');
  await expect(page.locator('[data-ui="opponent"]')).toContainText(/Бот|Bot/);
  await expect(page.locator('[data-ui^="card-"]:visible')).toHaveCount(5);
  await page.evaluate(() => window.__game?.stopTime());
  await ticks(page, 400);
  expect((await sim(page)).stats[1].played).toBeGreaterThan(0);
});

test('INP-01: a card dragged onto an allowed cell is played; onto a forbidden one — not', async ({
  page,
}) => {
  await presetSave(page, played(1));
  await openGame(page, '?battle=1');
  await page.evaluate(() => window.__game?.stopTime());
  const i = await buildingCard(page);
  const drag = async (x: number, y: number): Promise<void> => {
    const box = await page.locator(`[data-ui="card-${String(i)}"]`).boundingBox();
    const to = await cell(page, x, y);
    if (!box) throw new Error('no card');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y - 30, { steps: 6 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    await ticks(page, 1);
  };
  // Row 3 is the enemy half, out of reach at the start.
  await drag(3, 3);
  expect((await sim(page)).stats[0].played).toBe(0);
  await drag(0, 9);
  const s = await sim(page);
  expect(s.stats[0].played).toBe(1);
  expect(s.buildings.some((b) => b.side === 0 && b.x === 0 && b.y === 9)).toBe(true);
});

test('INP-02, INP-04, INP-05: a key chooses a card, a tap plays it; a tap on a building shows its plate', async ({
  page,
}) => {
  await presetSave(page, played(1));
  await openGame(page, '?battle=1');
  await page.evaluate(() => window.__game?.stopTime());
  const i = await buildingCard(page);
  await tap(page, 3, 9);
  await expect(page.locator('[data-ui="plate"]')).toBeVisible();
  await page.keyboard.press(`Digit${String(i + 1)}`);
  await expect(page.locator(`[data-ui="card-${String(i)}"]`)).toHaveClass(/selected/);
  // Escape first lets the card go; the battle is not paused by it.
  await page.keyboard.press('Escape');
  await expect(page.locator(`[data-ui="card-${String(i)}"]`)).not.toHaveClass(/selected/);
  expect((await state(page)).window).toBeNull();
  await page.keyboard.press(`Digit${String(i + 1)}`);
  await tap(page, 6, 9);
  await ticks(page, 1);
  expect((await sim(page)).buildings.some((b) => b.side === 0 && b.x === 6 && b.y === 9)).toBe(
    true,
  );
});

test('TUT-01…TUT-03: the first launch opens the tutorial; three battles lead to the menu and a chest', async ({
  page,
}) => {
  await openGame(page);
  await expect(page.locator('[data-ui="hint"]')).toBeVisible();
  await expect(page.locator('[data-ui="card-0"]')).toHaveClass(/hinted/);
  await page.evaluate(() => window.__game?.stopTime());
  // TUT-01: the cannon to the framed cell; the tower falls.
  await card(page, 0);
  await tap(page, 1, 3);
  await ticks(page, 200);
  await expect(page.locator('[data-ui="tutorial-done"]')).toBeVisible();
  await page.locator('[data-ui="tutorial-next"]').click();
  // TUT-02: walls forward until one stands on the enemy half.
  await page.evaluate(() => window.__game?.stopTime());
  for (const y of [8, 7, 6, 5, 4]) {
    await ticks(page, 60);
    await card(page, 0);
    await tap(page, 3, y);
    await ticks(page, 1);
  }
  await expect(page.locator('[data-ui="tutorial-done"]')).toBeVisible();
  await page.locator('[data-ui="tutorial-next"]').click();
  // TUT-03: a cannon, then a second one onto it.
  await page.evaluate(() => window.__game?.stopTime());
  await card(page, 0);
  await tap(page, 2, 8);
  await ticks(page, 240);
  const hand = (await sim(page)).hand[0];
  await card(page, hand.indexOf('cannon'));
  await tap(page, 2, 8);
  await ticks(page, 1);
  await expect(page.locator('[data-ui="tutorial-done"]')).toBeVisible();
  await page.locator('[data-ui="tutorial-next"]').click();
  await expect(page.locator('[data-ui="menu"]')).toBeVisible();
  const saved = await page.evaluate(() => window.__game?.save());
  // TUT-03: no trophies, the first chest.
  expect([
    saved?.tutorial.done,
    saved?.player.trophies,
    saved?.chests.filter(Boolean).length,
  ]).toEqual([true, 0, 1]);
});

test('TUT-03: after the first tutorial battle the rest can be skipped', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__game?.stopTime());
  await card(page, 0);
  await tap(page, 1, 3);
  await ticks(page, 200);
  await page.locator('[data-ui="tutorial-skip"]').click();
  await expect(page.locator('[data-ui="menu"]')).toBeVisible();
  expect((await page.evaluate(() => window.__game?.save()))?.tutorial.done).toBe(true);
});
