/**
 * YG-19: `npm run check:yg` — the RELEASE build on the SDK mock of @yandex-games/sdk-dev-proxy,
 * with a clean console. Builds, starts the proxy, opens the game in headless Chromium (the
 * proxy's certificate is self-signed: allowed only there, no warnings in your own browser),
 * plays a little and prints every console error and warning. Exit code 1 on any problem.
 */

import { useBrowsersPath } from './browsers-path';
import { run, stop, waitFor } from './proc';

const GAME_URL = 'https://localhost:8080/';

async function main(): Promise<void> {
  useBrowsersPath();
  const { chromium } = await import('@playwright/test');
  const build = run('npm', ['run', 'build']);
  await new Promise((r) => build.on('exit', r));
  // The proxy opens a tab in the default browser and has no flag against it.
  const proxy = run('npx', ['sdk-dev-proxy', '-p', 'dist', '--dev-mode=true'], {
    ...process.env,
    NODE_OPTIONS: '--require ./scripts/no-browser-tab.cjs',
  });
  const problems: string[] = [];
  const sdkLog: string[] = [];
  try {
    await waitFor(proxy, 'localhost:8080', 30_000);
    const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
    });
    page.on('console', (m) => {
      const text = m.text();
      if (/ysdk|LoadingAPI|GameplayAPI/.test(text)) sdkLog.push(text);
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${text}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(GAME_URL);
    await page.waitForSelector('#loading', { state: 'detached', timeout: 30_000 });
    await page.waitForSelector('#canvas-host canvas', { timeout: 10_000 });
    // A little play: the first launch opens a battle (UI-02); pause and continue.
    await page.locator('[data-ui="pause"]').click();
    await page.locator('[data-ui="pause-continue"]').click();
    await page.waitForTimeout(2000);
    const sdk = await page.evaluate(() => typeof (window as { YaGames?: unknown }).YaGames);
    if (sdk !== 'object') problems.push('YaGames is not loaded');
    await browser.close();
  } finally {
    stop(proxy);
  }
  console.log(sdkLog.map((l) => `  ${l}`).join('\n'));
  const ready = sdkLog.some((l) => /ready/i.test(l));
  console.log(`SDK calls logged: ${String(sdkLog.length)}; LoadingAPI.ready: ${String(ready)}`);
  if (!ready) problems.push('LoadingAPI.ready() was not logged by the SDK mock');
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('check:yg — OK: the release build runs on the SDK mock with a clean console');
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
