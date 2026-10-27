/**
 * QA-04: every screen × 10 sizes × every language. Elements stay on screen, buttons do not
 * overlap and are at least 44 px on touch screens, text is not cut and not smaller than 14 px,
 * a phone cell of the battle field is at least 40 px (UI-10), the desktop active area is at most
 * 2:1.
 * Screenshots go to test-results/layout/ — LOOK at them, the checks do not see ugliness.
 * Add every new screen of your game here (a window, a map, a shop…).
 */

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { openGame, played, presetSave, quickLoss, quickWin, state } from './helpers';

const SIZES: [number, number][] = [
  [360, 560],
  [360, 640],
  [390, 844],
  [412, 915],
  [768, 1024],
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1920, 1080],
  [2560, 1080],
];
const LANGS = ['ru', 'en'];
const OUT = 'test-results/layout';

/** Phones and tablets are touch devices; 1280 px and wider are computers. */
const isTouch = (w: number): boolean => w < 1280;

async function check(
  page: Page,
  screen: string,
  w: number,
  h: number,
  lang: string,
  problems: string[],
): Promise<void> {
  await page.waitForTimeout(400);
  // JPEG: a 2560×1080 PNG takes seconds to encode with software rendering.
  await page.screenshot({
    path: `${OUT}/${screen}-${w}x${h}-${lang}.jpg`,
    type: 'jpeg',
    quality: 80,
  });
  const report = (what: string): void => {
    problems.push(`${screen}: ${what}`);
  };
  const rects = (await page.evaluate(() => window.__game?.debugUI())) ?? [];
  for (const r of rects.filter((x) => x.visible)) {
    if (r.x < -1 || r.y < -1 || r.x + r.width > w + 1 || r.y + r.height > h + 1) {
      report(
        `${r.ui} is off screen (${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.width.toFixed(0)}×${r.height.toFixed(0)})`,
      );
    }
  }
  const modal = (await page.locator('.modal').count()) > 0;
  const buttons = await page.evaluate((inModal) => {
    const scope = inModal ? document.querySelector('.modal') : document.getElementById('ui');
    return Array.from(scope?.querySelectorAll<HTMLElement>('button') ?? [])
      .filter((b) => b.offsetParent !== null && !b.closest('[hidden]'))
      .map((b) => {
        const r = b.getBoundingClientRect();
        return {
          ui: b.dataset.ui ?? b.textContent ?? '?',
          // A tall window scrolls its content under the sticky button row: not an overlap.
          sticky: b.closest('.modal-buttons') !== null,
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
        };
      });
  }, modal);
  for (let i = 0; i < buttons.length; i++) {
    const a = buttons[i];
    if (!a) continue;
    if (isTouch(w) && (a.w < 43.5 || a.h < 43.5)) {
      report(`button ${a.ui} is ${a.w.toFixed(0)}×${a.h.toFixed(0)}`);
    }
    for (let j = i + 1; j < buttons.length; j++) {
      const b = buttons[j];
      if (!b || a.sticky !== b.sticky) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 1 && iy > 1) report(`buttons ${a.ui} and ${b.ui} overlap`);
    }
  }
  // ACC-03: text is not cut.
  const cut = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '#ui button, .modal-title, .modal-text, .settings-label, .complete-coins, .hud-timer, .hud-crowns, .hud-opponent-kind, .pill, .menu-arena',
      ),
    )
      .filter((e) => e.offsetParent !== null)
      .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
      .map((e) => `${e.dataset.ui ?? e.className}: "${(e.textContent ?? '').slice(0, 30)}"`),
  );
  for (const c of cut) report(`text cut: ${c}`);
  // ACC-02: text at least 14 px.
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('#ui *'))
      .filter(
        (e) =>
          e.offsetParent !== null &&
          [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== ''),
      )
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 14)
      .map((e) => `${e.className}: "${(e.textContent ?? '').slice(0, 20)}"`),
  );
  for (const s of small) report(`text smaller than 14 px: ${s}`);
}

async function openAt(
  browser: Browser,
  w: number,
  h: number,
  lang: string,
  extra = '',
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: isTouch(w),
    isMobile: isTouch(w),
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await presetSave(page, played(2));
  await openGame(page, `?lang=${lang}${extra}`);
  return { context, page };
}

for (const [w, h] of SIZES) {
  for (const lang of LANGS) {
    test(`QA-04 ${w}×${h} ${lang}`, async ({ browser, browserName }) => {
      test.skip(browserName !== 'chromium', 'layout runs in Chromium');
      test.setTimeout(180_000);
      const { context, page } = await openAt(browser, w, h, lang, '&iap=1');
      const problems: string[] = [];

      // UI-13: the desktop active area is at most 2:1, centred and touching the short side.
      if (!isTouch(w)) {
        const box = await page.locator('#stage').boundingBox();
        if (box) {
          const ratio = box.width / box.height;
          if (ratio > 2.01 || ratio < 0.49) problems.push(`active area ratio ${ratio.toFixed(2)}`);
          if (Math.abs(box.x * 2 + box.width - w) > 2) problems.push('active area not centred');
        }
      }

      // The menu and its windows.
      await check(page, 'menu', w, h, lang, problems);
      await page.locator('[data-ui="menu-settings"]').click();
      await check(page, 'settings', w, h, lang, problems);
      await page.locator('[data-ui="settings-close"]').click();
      await page.locator('[data-ui="menu-rating"]').click();
      await expect(page.locator('[data-ui="rating-note"]')).not.toHaveText(/…/);
      await check(page, 'rating', w, h, lang, problems);
      await page.locator('[data-ui="rating-close"]').click();
      await page.locator('[data-ui="menu-shop"]').click();
      await check(page, 'shop', w, h, lang, problems);
      await page.locator('[data-ui="shop-close"]').click();

      // The battle (UI-10: a cell of at least 40 px), the pause and its windows.
      await page.evaluate(() => {
        window.__game?.openBattle();
        window.__game?.stopTime();
        window.__game?.tick(200);
      });
      await check(page, 'battle', w, h, lang, problems);
      const cell = (await state(page)).field?.cell ?? 0;
      if (cell < 40) problems.push(`battle: cell ${String(cell)} px < 40 px`);
      await page.keyboard.press('Escape');
      await check(page, 'pause', w, h, lang, problems);
      await page.locator('[data-ui="pause-settings"]').click();
      await check(page, 'pause-settings', w, h, lang, problems);
      await page.locator('[data-ui="settings-close"]').click();
      await page.locator('[data-ui="pause-surrender"]').click();
      await check(page, 'surrender', w, h, lang, problems);
      await page.locator('[data-ui="surrender-no"]').click();
      await page.locator('[data-ui="pause-continue"]').click();

      // The result windows (WIN-05).
      await quickWin(page);
      await check(page, 'result-win', w, h, lang, problems);
      await quickLoss(page);
      await check(page, 'result-loss', w, h, lang, problems);

      await context.close();
      expect(problems).toEqual([]);
    });
  }
}
