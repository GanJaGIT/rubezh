/**
 * PERF-02, PERF-03: `npm run perf` on the e2e build in Chromium.
 * - time to ready() with the CPU slowed down 4 times (target ≤ 5 s), three loads;
 * - frames per second in a battle: a desktop 1920×1080 as is (target 60) and a phone 412×915 with
 *   the CPU ×4 (target ≥ 30). From Stage 2 the battle is a full field played by two bots (PERF-03:
 *   40 buildings, 30 shots in flight).
 * By default WebGL is software (SwiftShader) — a lower bound that depends on the canvas size.
 * `PERF_GPU=1 npm run perf` uses the video card, like a player's browser.
 * The e2e suite has its own ready() check (tests/e2e/perf.spec.ts) that runs alone, after all.
 */

import { useBrowsersPath } from './browsers-path';
import { run, stop, waitFor } from './proc';

const PORT = 4185;
const BASE = `http://localhost:${String(PORT)}/`;

interface DevGame {
  isReady(): boolean;
  openBattle(): void;
}
type DevWindow = Window & { __game?: DevGame };

async function main(): Promise<void> {
  useBrowsersPath();
  const { chromium } = await import('@playwright/test');
  const build = run('npm', ['run', 'build:e2e']);
  await new Promise((r) => build.on('exit', r));
  const server = run('npx', [
    'vite',
    'preview',
    '--mode',
    'e2e',
    '--outDir',
    'dist-e2e',
    '--port',
    String(PORT),
    '--strictPort',
  ]);
  const lines: string[] = [];
  try {
    await waitFor(server, String(PORT), 30_000);
    const gpu = process.env.PERF_GPU === '1';
    const browser = await chromium.launch({
      args: gpu ? ['--use-angle=d3d11', '--enable-gpu'] : ['--use-angle=swiftshader'],
    });
    const open = async (width: number, height: number, cpu: number) => {
      const page = await browser.newPage({ viewport: { width, height } });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      await page.goto(BASE);
      await page.waitForFunction(() => (window as DevWindow).__game?.isReady() === true, null, {
        timeout: 60_000,
        polling: 20,
      });
      return page;
    };

    // PERF-02
    const ready: number[] = [];
    for (let i = 0; i < 3; i++) {
      const page = await open(412, 915, 4);
      ready.push(await page.evaluate(() => performance.now()));
      await page.close();
    }
    const worst = Math.max(...ready);
    lines.push(
      `PERF-02 ready() with CPU ×4: ${ready.map((t) => `${(t / 1000).toFixed(2)} s`).join(', ')} — ${worst <= 5000 ? 'OK' : 'SLOW'} (≤ 5 s)`,
    );

    // PERF-03
    for (const [name, w, h, cpu, target] of [
      ['desktop 1920×1080', 1920, 1080, 1, 60],
      ['phone 412×915, CPU ×4', 412, 915, 4, 30],
    ] as const) {
      const page = await open(w, h, cpu);
      await page.evaluate(() => (window as DevWindow).__game?.openBattle());
      await page.waitForTimeout(1500);
      // A string, not a function: tsx would wrap a named inner function in its `__name` helper,
      // which does not exist in the page.
      const fps = await page.evaluate<number>(`new Promise((resolve) => {
        let frames = 0;
        const t0 = performance.now();
        const tick = (t) => {
          frames++;
          if (t - t0 < 5000) requestAnimationFrame(tick);
          else resolve((frames * 1000) / (t - t0));
        };
        requestAnimationFrame(tick);
      })`);
      lines.push(
        `PERF-03 ${name}: ${fps.toFixed(1)} FPS in a battle — ${fps >= target - 1 ? 'OK' : 'SLOW'} (target ${String(target)})`,
      );
      await page.close();
    }
    await browser.close();
  } finally {
    stop(server);
  }
  console.log(lines.join('\n'));
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
