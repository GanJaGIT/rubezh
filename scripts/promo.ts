/**
 * ART-04, §9: `npm run promo` makes the store materials in release/ (and the README pictures).
 *
 *   npm run promo                         icon, covers, hero, screenshots, videos
 *   npm run promo -- --only=art           icon-512, cover-<lang>-800x470, hero-1560x520
 *   npm run promo -- --only=screens,video screenshots and videos (needs the e2e build)
 *   npm run promo -- --only=media         docs/media for the README (after screens and video)
 *   npm run promo -- --no-build           reuse dist-e2e/
 *   npm run promo -- --video=9x16         only the videos whose file name has "9x16"
 *
 * What the pictures show lives in scripts/promo-scenes.ts — edit that per game.
 * Lessons built in: every language gets its own screenshots and videos with its own title
 * (5.1.3); the video is captured frame by frame with the Phaser loop stepped by hand — Playwright
 * recording drops frames, lags behind and leaves grey borders when the page is smaller than the
 * frame; every video is checked for a frame that does not fill the picture; ≤ 27.8 s.
 */

import { spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import ffmpegPath from 'ffmpeg-static';
import type { DevHooks } from '../src/dev';
import { useBrowsersPath } from './browsers-path';
import { run, stop, waitFor } from './proc';
import { banner, cover, HERO, ICON, SHOTS, titleCard, VIDEO, type Scene } from './promo-scenes';

declare global {
  interface Window {
    __game?: DevHooks;
  }
}

useBrowsersPath();

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'release');
const TMP = join(ROOT, 'test-results', 'promo');
const arg = (name: string): string | null =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const only = arg('only')?.split(',') ?? null;
const want = (part: string): boolean => (only ? only.includes(part) : part !== 'media');
const ffmpeg = ffmpegPath as unknown as string | null;

const LANGS = readdirSync(join(ROOT, 'src', 'i18n'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort((a, b) => (a === 'ru' ? -1 : b === 'ru' ? 1 : a.localeCompare(b)));
const TITLES: Record<string, string> = Object.fromEntries(
  LANGS.map((l) => [
    l,
    (
      JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', `${l}.json`), 'utf8')) as Record<
        string,
        string
      >
    )['game.title'] as string,
  ]),
);

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const dataUrl = (file: string, type: string): string =>
  `data:${type};base64,${readFileSync(file).toString('base64')}`;
const sprite = (name: string): string =>
  dataUrl(join(ROOT, 'art', 'sprites', `${name}.svg`), 'image/svg+xml');
const font = (subset: string): string =>
  dataUrl(
    join(ROOT, `node_modules/@fontsource/nunito/files/nunito-${subset}-900-normal.woff2`),
    'font/woff2',
  );

function ffmpegRun(args: string[]): void {
  if (!ffmpeg)
    throw new Error('ffmpeg-static has no binary: node node_modules/ffmpeg-static/install.js');
  const res = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

// ---------------------------------------------------------------------------------------------
// Compositions (icon, covers, hero, banner, video titles)

function sceneHtml(s: Scene): string {
  const glows = s.flashes
    .map(
      (f) =>
        `<div class="glow" style="left:${f.x - f.r}px;top:${f.y - f.r}px;width:${f.r * 2}px;height:${f.r * 2}px"></div>`,
    )
    .join('');
  const puts = s.sprites
    .map(
      (p) =>
        `<img src="${sprite(p.name)}" style="left:${p.x - p.size / 2}px;top:${p.y - p.size / 2}px;width:${p.size}px;height:${p.size}px;transform:rotate(${p.rot ?? 0}deg)">`,
    )
    .join('');
  const t = s.title;
  const title = t
    ? `<div class="title" style="${t.anchor === 'middle' ? 'left:0;right:0;text-align:center;' : `left:${t.x}px;`}top:${t.y}px;font-size:${t.size}px">${t.text}</div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Nunito; font-weight: 900; src: url(${font('latin')}) format('woff2'); unicode-range: U+0000-00FF; }
@font-face { font-family: Nunito; font-weight: 900; src: url(${font('cyrillic')}) format('woff2'); unicode-range: U+0400-045F; }
html, body { margin: 0; width: ${s.w}px; height: ${s.h}px; overflow: hidden; background: ${s.background}; }
img { position: absolute; filter: drop-shadow(0 ${Math.max(2, s.w / 200)}px 0 rgba(0,0,0,.25)); }
.glow { position: absolute; border-radius: 50%; background: radial-gradient(circle, rgba(255,252,214,.9), rgba(255,236,140,.4) 40%, rgba(255,236,140,0) 70%); }
.title { position: absolute; font-family: Nunito; font-weight: 900; color: #fff; line-height: 1;
  -webkit-text-stroke: .14em #2a2160; paint-order: stroke fill;
  text-shadow: 0 .09em 0 #2a2160, 0 .2em .3em rgba(0,0,0,.25); }
</style></head><body>${glows}${puts}${title}</body></html>`;
}

/** Renders a composition to release/<file>, or to an absolute path. */
async function renderScene(browser: Browser, s: Scene, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  page.on('pageerror', (e) => console.error(`promo: ${file}: ${e.message}`));
  await page.setContent(sceneHtml(s));
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => undefined)));
  });
  const path = isAbsolute(file) ? file : join(OUT, file);
  await page.screenshot({ path, type: 'png' });
  await page.close();
  console.log(`promo: ${isAbsolute(file) ? file.replace(ROOT, '') : file}`);
}

async function art(browser: Browser): Promise<void> {
  await renderScene(browser, ICON, 'icon-512.png');
  for (const lang of LANGS) {
    await renderScene(browser, cover(TITLES[lang] ?? '', lang), `cover-${lang}-800x470.png`);
  }
  await renderScene(browser, HERO, 'hero-1560x520.png');
}

// ---------------------------------------------------------------------------------------------
// The e2e build: the release build plus the DEV-02 hooks

const PORT = 4174;
const BASE = `http://localhost:${String(PORT)}`;

async function startServer(): Promise<ChildProcess> {
  if (!process.argv.includes('--no-build')) {
    const b = spawnSync('npm run build:e2e', { stdio: 'inherit', shell: true });
    if (b.status !== 0) throw new Error('npm run build:e2e failed');
  }
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
  await waitFor(server, String(PORT), 30_000);
  return server;
}

async function openBattle(page: Page, lang: string): Promise<void> {
  if (!page.url().startsWith(BASE)) {
    await page.goto(`${BASE}/?lang=${lang}`);
    await page.waitForFunction(() => window.__game?.isReady() === true);
    // Notes ("New!", "Purchase done") would cover the field in a picture.
    await page.addStyleTag({ content: '.toast { display: none !important; }' });
  }
  await page.evaluate(() => window.__game?.openBattle());
  await wait(300);
}

// ---------------------------------------------------------------------------------------------
// Screenshots (§9: 4 per device and language, gameplay only)

const DEVICES = [
  { name: 'desktop', viewport: { width: 1920, height: 1080 }, scale: 1, touch: false },
  // 360×640 at DPR 3: a 1080×1920 phone screenshot.
  { name: 'mobile', viewport: { width: 360, height: 640 }, scale: 3, touch: true },
];

async function screens(browser: Browser): Promise<void> {
  for (const lang of LANGS) {
    mkdirSync(join(OUT, 'screens', lang), { recursive: true });
    for (const d of DEVICES) {
      const context = await browser.newContext({
        viewport: d.viewport,
        deviceScaleFactor: d.scale,
        isMobile: d.touch,
        hasTouch: d.touch,
      });
      const page = await context.newPage();
      for (const [i, shot] of SHOTS.entries()) {
        await openBattle(page, lang);
        // The battle jumps to the moment (bots play both sides from Stage 1 on).
        await page.evaluate((s) => {
          window.__game?.stopTime();
          window.__game?.tick(s * 20);
        }, shot.seconds);
        await wait(300);
        const name = `screens/${lang}/${d.name}-${String(i + 1)}.png`;
        await page.screenshot({ path: join(OUT, name), type: 'png' });
        console.log(`promo: ${name}`);
      }
      await context.close();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Videos: frame by frame

const FPS = 30;
const TITLE_SECONDS = 3;
/** "Up to 28 s" in the console: keep a margin. */
const MAX_SECONDS = 27.8;

interface VideoFormat {
  tag: '16x9' | '9x16';
  viewport: { width: number; height: number };
  scale: number;
  mobile: boolean;
}

const FORMATS: VideoFormat[] = [
  { tag: '16x9', viewport: { width: 1280, height: 720 }, scale: 1.5, mobile: false },
  { tag: '9x16', viewport: { width: 360, height: 640 }, scale: 3, mobile: true },
];

async function video(browser: Browser, f: VideoFormat, lang: string): Promise<void> {
  const file = `video-${f.tag}-${lang}.mp4`;
  const size = {
    w: Math.round(f.viewport.width * f.scale),
    h: Math.round(f.viewport.height * f.scale),
  };
  const frames = join(TMP, `frames-${f.tag}-${lang}`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const context = await browser.newContext({
    viewport: f.viewport,
    deviceScaleFactor: f.scale,
    isMobile: f.mobile,
    hasTouch: f.mobile,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await openBattle(page, lang);
  // The game moves by exactly one video frame per step. CSS animations of the interface run on
  // real time; their playback rate follows the real pace of the capture.
  await page.evaluate(() => window.__game?.frameMode(true));
  await cdp.send('Animation.enable');
  let rate = 1;
  let last = Date.now();
  const maxPlay = Math.round(Math.min(VIDEO.playSeconds, MAX_SECONDS - TITLE_SECONDS) * FPS);
  let endAt = maxPlay;
  let n = 0;
  for (; n < endAt; n++) {
    await page.evaluate((ms) => window.__game?.stepFrame(ms), 1000 / FPS);
    if (endAt === maxPlay) {
      const phase = await page.evaluate(() => window.__game?.state().phase);
      if (phase === 'ended') {
        endAt = Math.min(
          maxPlay + Math.round(VIDEO.resultSeconds * FPS),
          n + Math.round(VIDEO.resultSeconds * FPS) + 22,
        );
      }
    }
    // The DevTools capture ignores the emulated pixel ratio: the scale is given explicitly.
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 92,
      clip: { x: 0, y: 0, width: f.viewport.width, height: f.viewport.height, scale: f.scale },
    });
    writeFileSync(
      join(frames, `${String(n).padStart(4, '0')}.jpg`),
      Buffer.from(shot.data, 'base64'),
    );
    const spent = Date.now() - last;
    last = Date.now();
    const target = Math.max(0.05, Math.min(1, 1000 / FPS / Math.max(1, spent)));
    if (Math.abs(target - rate) > 0.05) {
      rate = rate * 0.7 + target * 0.3;
      await cdp.send('Animation.setPlaybackRate', { playbackRate: rate });
    }
  }
  await context.close();
  const game = Math.min(n / FPS, MAX_SECONDS - TITLE_SECONDS);
  const title = join(TMP, `title-${f.tag}-${lang}.png`);
  await renderScene(browser, titleCard(TITLES[lang] ?? '', size.w, size.h), title);
  const out = join(OUT, file);
  const norm = `scale=${String(size.w)}:${String(size.h)}:flags=lanczos,setsar=1,format=yuv420p`;
  ffmpegRun([
    '-framerate',
    String(FPS),
    '-i',
    join(frames, '%04d.jpg'),
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-t',
    String(TITLE_SECONDS),
    '-i',
    title,
    '-filter_complex',
    `[0:v]${norm},trim=duration=${game.toFixed(2)}[g];[1:v]${norm},fade=t=in:st=0:d=0.4[t];[g][t]concat=n=2:v=1:a=0[v]`,
    '-map',
    '[v]',
    '-r',
    String(FPS),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-movflags',
    '+faststart',
    out,
  ]);
  checkFilled(out);
  console.log(`promo: ${file} (${(game + TITLE_SECONDS).toFixed(1)} s)`);
}

/**
 * 8.3.1: the picture fills the whole frame. A quarter of a frame that is plain grey means the
 * page was captured smaller than the video (the bug of game 2's first vertical video).
 */
function checkFilled(file: string): void {
  if (!ffmpeg) return;
  for (const t of [2, 10]) {
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const res = spawnSync(
        ffmpeg,
        [
          '-v',
          'error',
          '-ss',
          String(t),
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          `crop=iw/2:ih/2:${String(x)}*iw/2:${String(y)}*ih/2,scale=1:1:flags=area`,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          '-',
        ],
        { encoding: 'buffer' },
      );
      const [r = 0, g = 0, b = 0] = res.stdout;
      if (Math.max(r, g, b) - Math.min(r, g, b) < 10 && r > 90 && r < 170) {
        throw new Error(`${file}: at ${String(t)} s a quarter of the frame is plain grey`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The README pictures (docs/media)

async function media(browser: Browser): Promise<void> {
  const dir = join(ROOT, 'docs', 'media');
  mkdirSync(dir, { recursive: true });
  const lang = LANGS[0] as string;
  await renderScene(browser, banner(TITLES[lang] ?? ''), join(dir, 'banner.png'));
  await renderScene(browser, ICON, join(dir, 'icon.png'));
  ffmpegRun([
    '-ss',
    '2',
    '-t',
    '8',
    '-i',
    join(OUT, `video-9x16-${lang}.mp4`),
    '-vf',
    'fps=10,scale=270:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    '-loop',
    '0',
    join(dir, 'gameplay.gif'),
  ]);
  for (const [from, to] of [
    [`screens/${lang}/mobile-2.png`, 'phone-1.png'],
    [`screens/${lang}/mobile-4.png`, 'phone-2.png'],
    [`screens/${lang}/desktop-2.png`, 'desktop.png'],
  ] as const) {
    ffmpegRun([
      '-i',
      join(OUT, from),
      '-vf',
      `scale=${to === 'desktop.png' ? 1100 : 405}:-1:flags=lanczos`,
      join(dir, to),
    ]);
  }
  console.log('promo: docs/media — banner, icon, gameplay.gif, phone-1, phone-2, desktop');
}

// ---------------------------------------------------------------------------------------------
// §9 check: every file with its size in pixels, weight and (video) length

function pngSize(file: string): string {
  const b = readFileSync(file);
  return `${String(b.readUInt32BE(16))}×${String(b.readUInt32BE(20))}`;
}

function videoInfo(file: string): string {
  if (!ffmpeg) return '?';
  const text = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const dur = /Duration: ([\d:.]+)/.exec(text)?.[1] ?? '?';
  const dims = /, (\d{3,}x\d{3,})/.exec(text)?.[1] ?? '?';
  return `${dims} ${dur}`;
}

function report(): void {
  const list = (dir: string): string[] => {
    try {
      return readdirSync(join(OUT, dir)).flatMap((f) => {
        const rel = dir ? `${dir}/${f}` : f;
        return statSync(join(OUT, rel)).isDirectory() ? list(rel) : [rel];
      });
    } catch {
      return [];
    }
  };
  const files = list('')
    .filter((f) => /\.(png|mp4|zip)$/.test(f))
    .sort();
  console.log('\nfile                              size                    weight');
  for (const f of files) {
    const path = join(OUT, f);
    const kb = (statSync(path).size / 1024).toFixed(0).padStart(6);
    const size = f.endsWith('.png') ? pngSize(path) : f.endsWith('.mp4') ? videoInfo(path) : '';
    console.log(`${f.padEnd(34)}${size.padEnd(24)}${kb} KB`);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
  let server: ChildProcess | null = null;
  try {
    if (want('art')) await art(browser);
    if (want('screens') || want('video')) server = await startServer();
    if (want('screens')) await screens(browser);
    if (want('video')) {
      const pick = arg('video');
      for (const lang of LANGS) {
        for (const f of FORMATS) {
          if (!pick || `video-${f.tag}-${lang}`.includes(pick)) await video(browser, f, lang);
        }
      }
    }
    if (want('media')) await media(browser);
  } finally {
    await browser.close();
    if (server) stop(server);
  }
  report();
}

await main();
