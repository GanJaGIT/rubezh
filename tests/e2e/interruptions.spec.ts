import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openGame, played, presetSave, quickWin, state } from './helpers';

/**
 * The cases a moderator found in game 2 (they are not in the SDK docs): the battle never runs on
 * its own while the player is away — also when they left DURING an ad (YG-04, YG-05, SIM-03);
 * fullscreen on the first touch is not "leaving" (UI-15, YG-20); a window taller than a short
 * screen scrolls with the finger (INP-06, req. 1.8); no two ads in a row (4.4).
 */

const ADS_FROM = Number(
  /adsFromBattle:\s*(\d+)/.exec(readFileSync('src/config.ts', 'utf8'))?.[1] ?? '3',
);

const blur = (page: Page): Promise<void> =>
  page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
  });

test('YG-04, YG-05: leaving the tab or the window pauses the battle and silences it', async ({
  page,
}) => {
  await openGame(page, '?battle=1');
  await blur(page);
  let st = await state(page);
  expect([st.window, st.audible, st.playing]).toEqual(['pause', false, false]);
  expect(st.silenced).toContain('blur');
  const tick = st.tick;
  await page.waitForTimeout(500);
  expect((await state(page)).tick).toBe(tick);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  st = await state(page);
  // Back in the game: the battle still waits for "Continue".
  expect([st.window, st.audible]).toEqual(['pause', true]);
});

test('YG-04: the player leaves during a fullscreen ad — the menu waits behind Pause rules', async ({
  page,
}) => {
  await presetSave(page, played(ADS_FROM));
  await openGame(page);
  await quickWin(page);
  await page.locator('[data-ui="result-menu"]').click();
  await expect(page.locator('#dev-overlay[data-kind="interstitial"]')).toBeVisible();
  await blur(page);
  // The stand-in ad closes itself after a second; on a busy machine the menu takes longer.
  await expect(page.locator('[data-ui="menu"]')).toBeVisible({ timeout: 15_000 });
  const st = await state(page);
  // Nothing plays in the menu: GameplayAPI stays stopped and the sound waits for the player.
  expect([st.screen, st.playing, st.audible]).toEqual(['menu', false, false]);
});

test('4.4: no fullscreen ad right after a watched "Double the gold"', async ({ page }) => {
  await presetSave(page, played(ADS_FROM));
  await openGame(page);
  await quickWin(page);
  await page.locator('[data-ui="result-double"]').click();
  await page.locator('#dev-overlay [data-action="watch"]').click();
  await expect(page.locator('[data-ui="result-double"]')).toHaveCount(0);
  await page.locator('[data-ui="result-menu"]').click();
  await expect(page.locator('[data-ui="menu"]')).toBeVisible();
  const calls = await page.evaluate(() => window.__game?.calls() ?? []);
  expect(calls.filter((c) => c === 'showInterstitial')).toHaveLength(0);
});

test('UI-15, YG-20: fullscreen on the first touch does not pause the battle, a later resize does', async ({
  page,
}) => {
  await openGame(page, '?battle=1');
  const vp = page.viewportSize() ?? { width: 800, height: 600 };
  // The first touch on the field: the window grows (the browser bars go away in fullscreen).
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.setViewportSize({ width: vp.width, height: vp.height + 60 });
  await page.waitForTimeout(300);
  expect((await state(page)).window).toBeNull();
  // Later the player resizes the window: the battle pauses (UI-15).
  await page.waitForTimeout(1600);
  await page.setViewportSize({ width: vp.width - 40, height: vp.height + 60 });
  await expect.poll(async () => (await state(page)).window).toBe('pause');
});

test('INP-06, req. 1.8: on a short screen a tall window scrolls with the finger, the page does not', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 320 });
  await presetSave(page, played(1));
  await openGame(page);
  await page.locator('[data-ui="menu-settings"]').click();
  const r = await page.evaluate(() => {
    const send = (el: Element): boolean => {
      const e = new Event('touchmove', { bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const modal = document.querySelector('.modal');
    const stage = document.getElementById('stage');
    if (!modal || !stage) return null;
    return {
      tall: modal.scrollHeight > modal.clientHeight,
      prevented: { inWindow: send(modal.firstElementChild ?? modal), outside: send(stage) },
    };
  });
  expect(r).toEqual({ tall: true, prevented: { inWindow: false, outside: true } });
});
