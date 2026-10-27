import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openGame, played, presetSave, quickWin, state } from './helpers';

/**
 * The platform rules on LocalPlatform (the stand-in of the SDK in dev and e2e builds): ads
 * (YG-10…YG-12), the platform's pause (YG-04), sign-in and account change (YG-09), the shop
 * (YG-14), the review (YG-16), fullscreen (YG-20), the multiplayer record (YG-21). Chromium and
 * mobile WebKit.
 */

const config = readFileSync('src/config.ts', 'utf8');
const ADS_FROM = Number(/adsFromBattle:\s*(\d+)/.exec(config)?.[1] ?? '3');
const REVIEW_AFTER = Number(/reviewAfterWins:\s*(\d+)/.exec(config)?.[1] ?? '5');

const calls = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window.__game?.calls() ?? []).filter((c) => !c.startsWith('writeSave')));
const count = async (page: Page, name: string): Promise<number> =>
  (await calls(page)).filter((c) => c === name).length;
const save = (page: Page) => page.evaluate(() => window.__game?.save());

async function toMenu(page: Page): Promise<void> {
  await page.locator('[data-ui="result-menu"]').click();
  // The stand-in ad closes itself after a second; the platform call is what counts.
  await expect(page.locator('[data-ui="menu"]')).toBeVisible({ timeout: 15_000 });
}

test('YG-10: a fullscreen ad after "To menu" from battle adsFromBattle on, at most once in 180 s', async ({
  page,
}) => {
  await presetSave(page, played(ADS_FROM - 1));
  await openGame(page);
  await quickWin(page);
  await toMenu(page);
  expect(await count(page, 'showInterstitial')).toBe(1);

  // Within 180 s: no second ad.
  await quickWin(page);
  await toMenu(page);
  expect(await count(page, 'showInterstitial')).toBe(1);

  // 181 s later by the server clock: the next one.
  await page.evaluate(() => window.__game?.advanceTime(181_000));
  await quickWin(page);
  await toMenu(page);
  expect(await count(page, 'showInterstitial')).toBe(2);
});

test('YG-10: no fullscreen ad in the first battles and never during a battle', async ({ page }) => {
  await openGame(page);
  for (let i = 1; i < ADS_FROM; i++) {
    await quickWin(page);
    await toMenu(page);
  }
  expect(await count(page, 'showInterstitial')).toBe(0);
  await page.locator('[data-ui="menu-play"]').click();
  await page.waitForTimeout(1500);
  expect(await count(page, 'showInterstitial')).toBe(0);
});

test('YG-11, WIN-05: "Double the gold" pays again only for a watched video', async ({ page }) => {
  await presetSave(page, played(1));
  await openGame(page);
  await quickWin(page);
  const before = (await save(page))?.gold ?? 0;
  await page.locator('[data-ui="result-double"]').click();
  await expect(page.locator('#dev-overlay[data-kind="rewarded"]')).toBeVisible();
  // Silent and paused while the video shows (YG-05, 4.7).
  expect((await state(page)).silenced).toContain('ad');
  await page.locator('#dev-overlay [data-action="close"]').click();
  expect((await save(page))?.gold).toBe(before);
  await page.locator('[data-ui="result-double"]').click();
  await page.locator('#dev-overlay [data-action="watch"]').click();
  await expect(page.locator('[data-ui="result-double"]')).toHaveCount(0);
  expect((await save(page))?.gold).toBe(before + 25);
});

test('YG-12: the sticky banner shows in the menu and hides in a battle', async ({ page }) => {
  await presetSave(page, played(1));
  await openGame(page);
  expect(await page.evaluate(() => window.__game?.banner())).toBe(true);
  await page.locator('[data-ui="menu-play"]').click();
  expect(await page.evaluate(() => window.__game?.banner())).toBe(false);
  await page.evaluate(() => window.__game?.menu());
  expect(await page.evaluate(() => window.__game?.banner())).toBe(true);
});

test('YG-04: the platform pauses the battle; after resume it waits on Pause, GameplayAPI stopped', async ({
  page,
}) => {
  await openGame(page, '?battle=1');
  await page.waitForFunction(() => (window.__game?.state().tick ?? 0) > 3);
  await page.evaluate(() => window.__game?.sdkPause());
  let st = await state(page);
  expect([st.window, st.playing]).toEqual(['pause', false]);
  expect(st.silenced).toContain('sdk_pause');
  const tickAt = st.tick;
  await page.evaluate(() => window.__game?.sdkResume());
  await page.waitForTimeout(300);
  st = await state(page);
  expect([st.window, st.tick, st.silenced]).toEqual(['pause', tickAt, []]);
  // The platform starts GameplayAPI by itself on resume; the game sends stop() again.
  const after = await calls(page);
  expect(after[after.length - 1]).toBe('gameplayStop');
  await page.locator('[data-ui="pause-continue"]').click();
  await page.waitForFunction(() => window.__game?.state().playing === true);
});

test('YG-09: sign-in only by the button with its benefit; an account change reloads the save', async ({
  page,
}) => {
  await presetSave(page, played(1));
  await openGame(page);
  expect(await count(page, 'openAuth')).toBe(0);
  await page.locator('[data-ui="menu-settings"]').click();
  await expect(page.locator('.settings-hint')).not.toBeEmpty();
  await page.locator('[data-ui="settings-login"]').click();
  expect(await count(page, 'openAuth')).toBe(1);
  await page.evaluate(() => window.__game?.account({ gold: 4242, stats: { battles: 3, wins: 2 } }));
  await expect(page.locator('[data-ui="menu-gold"]')).toContainText('4242');
});

test('YG-14: the shop — "No ads" removes the banner; gems are granted and consumed', async ({
  page,
}) => {
  await presetSave(page, played(1));
  await openGame(page, '?iap=1');
  await page.locator('[data-ui="menu-shop"]').click();
  await page.locator('[data-ui="shop-buy-no_ads"]').click();
  await page.locator('#dev-overlay [data-action="buy"]').click();
  await expect(page.locator('[data-ui="shop-buy-no_ads"]')).toBeDisabled();
  expect((await save(page))?.noAds).toBe(true);
  expect(await page.evaluate(() => window.__game?.banner())).toBe(false);
  await page.locator('[data-ui="shop-buy-gems_80"]').click();
  await page.locator('#dev-overlay [data-action="buy"]').click();
  await expect.poll(async () => (await save(page))?.gems).toBe(80);
  expect(await count(page, 'consume')).toBe(1);
});

test('YG-16: the review is asked once, after the win number reviewAfterWins', async ({ page }) => {
  await presetSave(page, played(REVIEW_AFTER - 1, REVIEW_AFTER - 1));
  await openGame(page);
  await quickWin(page);
  await expect.poll(() => count(page, 'review')).toBe(1);
  await toMenu(page);
  await quickWin(page);
  await page.waitForTimeout(300);
  expect(await count(page, 'review')).toBe(1);
});

test('YG-20: the first touch asks the platform for fullscreen, once', async ({ page }) => {
  await presetSave(page, played(1));
  await openGame(page);
  await page.locator('[data-ui="menu-settings"]').click();
  await page.locator('[data-ui="settings-close"]').click();
  expect(await count(page, 'requestFullscreen')).toBe(1);
});
