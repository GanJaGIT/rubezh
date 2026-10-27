/**
 * ART-04, §9: what the store pictures are made of — EDIT THIS FILE PER GAME. Every picture is a
 * composition of the game's own sprites (art/sprites/*.svg) over a background, with the title
 * in the game font: not a screenshot, no frame, no rounded corners (п. 5.6, 8.3.3, 8.3.4).
 * The video scenario and the screenshot moments are here too. Stage 5 composes the real ones (ART-04). scripts/promo.ts renders it all.
 *
 * Rules learned the hard way:
 * - the title on a cover and at the end of a video is the title of THAT language (5.1.3);
 * - the icon has no text (one icon serves every language);
 * - nothing important near the edges: the store crops covers on some screens;
 * - long English titles: smaller font, keep clear of the sprites (check the pictures!).
 */

/** A sprite: its file name in art/sprites, centre, size in px, rotation in degrees. */
export interface Put {
  name: string;
  x: number;
  y: number;
  size: number;
  rot?: number;
}

export interface Scene {
  w: number;
  h: number;
  /** CSS background of the picture (gradients welcome). */
  background: string;
  sprites: Put[];
  /** Soft glows ("a merge flash"): centre and radius. */
  flashes: { x: number; y: number; r: number }[];
  title?: { text: string; x: number; y: number; size: number; anchor: 'start' | 'middle' };
}

const BG =
  'radial-gradient(circle at 30% 25%, rgba(255,255,255,.35), transparent 45%), linear-gradient(160deg, #8f83f5, #4b3fb5)';

/** Sprites scattered as a "field" — replace with your game's best moment. */
function scatter(w: number, h: number, size: number, n: number, seed = 7): Put[] {
  let s = seed;
  const rnd = (): number => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out: Put[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      name: i % 3 === 0 ? 'tower-blue' : 'tile-a',
      x: Math.round(w * (0.08 + 0.84 * rnd())),
      y: Math.round(h * (0.2 + 0.72 * rnd())),
      size: Math.round(size * (0.7 + 0.5 * rnd())),
      rot: Math.round((rnd() - 0.5) * 20),
    });
  }
  return out;
}

export const ICON: Scene = {
  w: 512,
  h: 512,
  background: BG,
  sprites: [
    { name: 'tower-blue', x: 150, y: 360, size: 170, rot: -8 },
    { name: 'tower-red', x: 362, y: 380, size: 150, rot: 10 },
    { name: 'keep-blue', x: 256, y: 230, size: 330 },
  ],
  flashes: [{ x: 256, y: 230, r: 150 }],
};

export function cover(title: string, lang: string): Scene {
  return {
    w: 800,
    h: 470,
    background: BG,
    sprites: [...scatter(800, 470, 90, 9), { name: 'keep-red', x: 600, y: 300, size: 220 }],
    flashes: [{ x: 600, y: 300, r: 110 }],
    title: { text: title, x: 44, y: 60, size: lang === 'ru' ? 110 : 96, anchor: 'start' },
  };
}

export const HERO: Scene = {
  w: 1560,
  h: 520,
  background: BG,
  sprites: [...scatter(1560, 520, 110, 16, 11), { name: 'keep-blue', x: 780, y: 280, size: 260 }],
  flashes: [{ x: 780, y: 280, r: 130 }],
};

/** The README banner (docs/media/banner.png). */
export function banner(title: string): Scene {
  return {
    w: 1280,
    h: 420,
    background: BG,
    sprites: scatter(1280, 420, 90, 14, 5),
    flashes: [],
    title: { text: title, x: 0, y: 140, size: 130, anchor: 'middle' },
  };
}

/** The last 3 seconds of a video: the title over the game's art. */
export function titleCard(title: string, w: number, h: number): Scene {
  const portrait = h > w;
  return {
    w,
    h,
    background: BG,
    sprites: scatter(w, h, portrait ? 150 : 120, 12, 3),
    flashes: [{ x: w / 2, y: h * 0.62, r: Math.min(w, h) * 0.22 }],
    title: {
      text: title,
      x: 0,
      y: Math.round(h * (portrait ? 0.3 : 0.22)),
      size: Math.round(Math.min(w / Math.max(4, title.length * 0.62), h * 0.24)),
      anchor: 'middle',
    },
  };
}

/** §9: 4 gameplay screenshots per device and language — moments of a battle (Stage 5 picks them). */
export const SHOTS: { seconds: number }[] = [
  { seconds: 20 },
  { seconds: 45 },
  { seconds: 80 },
  { seconds: 125 },
];

/**
 * §9 video (≤ 28 s, gameplay ≥ 70% of it): the level `level` played by the bot `bot` from the
 * start for at most `playSeconds`, then the result window for `resultSeconds` (if it comes),
 * then the title for 3 s. Frames are stepped, not recorded: exact and smooth.
 */
export const VIDEO = { playSeconds: 21, resultSeconds: 2 };
