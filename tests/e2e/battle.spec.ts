import { expect, test } from '@playwright/test';
import { openGame, presetSave, played, quickLoss, quickWin, sim, state } from './helpers';

/**
 * QA-03: the battle screen in Chromium and mobile WebKit — the 7×10 field with both forts (the
 * Stage 0 acceptance), the clock, pause by the button and by Escape/P (any layout), surrender
 * with an in-game question, the result window and the gold kept after a reload.
 */

test('UI-02, GD-11: the first launch opens a battle — 7×10 field, both forts, the clock runs', async ({
  page,
}) => {
  await openGame(page);
  const st = await state(page);
  expect([st.screen, st.phase, st.opponent]).toEqual(['battle', 'main', 'bot']);
  expect(st.field?.cell ?? 0).toBeGreaterThanOrEqual(40);
  const s = await sim(page);
  const where = s.buildings
    .map((b) => `${String(b.side)}:${b.kind}@${String(b.x)},${String(b.y)}`)
    .sort();
  expect(where).toEqual([
    '0:keep@3,9',
    '0:tower@1,8',
    '0:tower@5,8',
    '1:keep@3,0',
    '1:tower@1,1',
    '1:tower@5,1',
  ]);
  // OPP-03: the opponent is shown as a bot.
  await expect(page.locator('[data-ui="opponent"]')).toContainText(/Бот|Bot/);
  await expect.poll(async () => (await state(page)).tick, { timeout: 10_000 }).toBeGreaterThan(20);
  await expect(page.locator('[data-ui="timer"]')).toHaveText(/^[23]:\d\d$/);
  // GD-20: elixir grows from 5.
  await expect
    .poll(async () => (await state(page)).elixir, { timeout: 10_000 })
    .toBeGreaterThan(5000);
});

test('UI-08, INP-05: pause by the button and by Escape/KeyP with any layout; the battle stands', async ({
  page,
}) => {
  await openGame(page, '?battle=1');
  await page.locator('[data-ui="pause"]').click();
  let st = await state(page);
  expect([st.window, st.paused, st.playing]).toEqual(['pause', true, false]);
  const at = st.tick;
  await page.waitForTimeout(500);
  expect((await state(page)).tick).toBe(at);
  await page.locator('[data-ui="pause-continue"]').click();
  await page.waitForFunction(() => window.__game?.state().playing === true);
  // KeyP on a Russian layout gives the letter «з»: the code is what counts.
  await page.keyboard.press('KeyP');
  expect((await state(page)).window).toBe('pause');
  await page.keyboard.press('Escape');
  st = await state(page);
  expect([st.window, st.paused]).toEqual([null, false]);
});

test('UI-08: surrender asks inside the game; "Keep playing" returns, "Surrender" is a loss', async ({
  page,
}) => {
  await openGame(page, '?battle=1');
  await page.locator('[data-ui="pause"]').click();
  await page.locator('[data-ui="pause-surrender"]').click();
  await expect(page.locator('[data-ui="surrender"]')).toBeVisible();
  await page.locator('[data-ui="surrender-no"]').click();
  expect((await state(page)).window).toBe('pause');
  await page.locator('[data-ui="pause-surrender"]').click();
  await page.locator('[data-ui="surrender-yes"]').click();
  await expect(page.locator('[data-ui="battle-result"]')).toBeVisible();
  const st = await state(page);
  expect([st.phase, st.winner, st.playing]).toEqual(['ended', 1, false]);
});

test('WIN-05, ECO-02, YG-08: a win gives 25 gold, saved at once and after a reload', async ({
  page,
}) => {
  await presetSave(page, played(1));
  await openGame(page);
  await quickWin(page);
  await expect(page.locator('[data-ui="result-gold"]')).toContainText('+25');
  const saved = await page.evaluate(() => window.__game?.save());
  expect([saved?.gold, saved?.stats.battles, saved?.stats.wins]).toEqual([25, 2, 1]);
  await page.reload();
  await page.waitForFunction(() => window.__game?.isReady() === true);
  await expect(page.locator('[data-ui="menu-gold"]')).toContainText('25');
});

test('ECO-02: a loss gives 5 gold; "To menu" opens the menu', async ({ page }) => {
  await presetSave(page, played(0));
  await openGame(page);
  await quickLoss(page);
  await expect(page.locator('[data-ui="result-gold"]')).toContainText('+5');
  await page.locator('[data-ui="result-menu"]').click();
  await expect(page.locator('[data-ui="menu"]')).toBeVisible();
  expect((await state(page)).screen).toBe('menu');
});

test('GD-01, WIN-04: a battle runs 3:00 and the overtime minute, then ends (a draw here)', async ({
  page,
}) => {
  await openGame(page, '?battle=1');
  await page.evaluate(() => {
    window.__game?.stopTime();
    window.__game?.tick(3600);
  });
  await expect(page.locator('[data-ui="timer"]')).toHaveText('1:00');
  await page.evaluate(() => window.__game?.tick(1200));
  await expect(page.locator('[data-ui="battle-result"]')).toBeVisible();
  expect((await state(page)).winner).toBeNull();
});
