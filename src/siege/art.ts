/**
 * Siege art, drawn with Phaser Graphics into textures at start (a prototype: the final art goes
 * through the sprite pipeline). Teen style (docs/art-style.md): dark stone and iron, fire and
 * cold glows, sharp shapes. A building is a base (its rim shows the tier) and a head (its look
 * shows the kind, tier and branch). Textures are drawn at R pixels per cell.
 */

import type Phaser from 'phaser';
import { BKINDS, type BKind, type Branch, type EKind } from './sim';

export const R = 128;

type G = Phaser.GameObjects.Graphics;

const C = {
  dark: 0x15171c,
  stone: 0x3b4049,
  stone2: 0x4b525d,
  iron: 0x8c96a3,
  bronze: 0xc9853d,
  gold: 0xffd25e,
  fire: 0xff6a1a,
  ember: 0xffb02e,
  frost: 0x6fd3ff,
  ice: 0xd8f6ff,
  volt: 0xb994ff,
  wood: 0x6b4426,
  red: 0xd8332a,
  corrupt: 0xb04dff,
};

const RIM = [C.stone2, C.iron, C.bronze, C.gold];

export const headKey = (kind: BKind, tier: number, branch: Branch): string =>
  `h-${kind}-${String(tier)}-${String(branch)}`;
export const baseKey = (tier: number): string => `base-${String(tier)}`;
export const enemyKey = (kind: EKind): string => `e-${kind}`;
/** Heads that turn to their target. */
export const TURNS: ReadonlySet<BKind> = new Set<BKind>(['crossbow', 'cannon']);

function poly(g: G, pts: number[][], fill: number, alpha = 1): void {
  g.fillStyle(fill, alpha);
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
  g.closePath();
  g.fillPath();
}

function octagon(cx: number, cy: number, r: number): number[][] {
  const k = r * 0.414;
  return [
    [cx - k, cy - r],
    [cx + k, cy - r],
    [cx + r, cy - k],
    [cx + r, cy + k],
    [cx + k, cy + r],
    [cx - k, cy + r],
    [cx - r, cy + k],
    [cx - r, cy - k],
  ];
}

function make(scene: Phaser.Scene, key: string, size: number, draw: (g: G) => void): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, size, size);
  g.destroy();
}

function base(g: G, tier: number): void {
  const c = R / 2;
  if (tier === 4) {
    g.fillStyle(C.ember, 0.18);
    g.fillCircle(c, c, 60);
  }
  poly(g, octagon(c, c + 4, 50), C.dark);
  poly(g, octagon(c, c, 50), RIM[tier - 1]);
  poly(g, octagon(c, c, 42), C.stone);
  poly(g, octagon(c, c, 34), 0x30353d);
  // Rivets: one per tier.
  g.fillStyle(tier >= 3 ? C.ember : C.iron, 1);
  const spots = [
    [c - 38, c - 38],
    [c + 38, c - 38],
    [c + 38, c + 38],
    [c - 38, c + 38],
  ];
  for (let i = 0; i < tier; i++) g.fillCircle(spots[i][0], spots[i][1], 4);
}

/** Heads point "up" (towards -y); the scene turns them. */
function head(g: G, kind: BKind, tier: number, branch: Branch): void {
  const c = R / 2;
  const glow = tier === 4;
  const metal = RIM[tier - 1];
  switch (kind) {
    case 'crossbow': {
      const arms = branch === 1 ? 40 : 30 + tier * 3;
      g.lineStyle(8 + tier, C.wood, 1);
      g.beginPath();
      g.arc(c, c + 12, arms, Math.PI * 1.15, Math.PI * 1.85, false);
      g.strokePath();
      g.lineStyle(3, metal, 1);
      g.beginPath();
      g.arc(c, c + 12, arms, Math.PI * 1.15, Math.PI * 1.85, false);
      g.strokePath();
      const bolts = branch === 2 ? [-14, 0, 14] : [0];
      for (const dx of bolts) {
        const len = branch === 1 ? 52 : 38;
        g.fillStyle(C.dark, 1);
        g.fillRect(c + dx - 4, c - len + 10, 8, len + 8);
        g.fillStyle(metal, 1);
        g.fillRect(c + dx - 2, c - len + 10, 4, len + 6);
        poly(
          g,
          [
            [c + dx, c - len - 2],
            [c + dx + 7, c - len + 12],
            [c + dx - 7, c - len + 12],
          ],
          glow ? C.fire : C.iron,
        );
      }
      if (branch === 1) poly(g, octagon(c, c + 22, 10), C.red);
      break;
    }
    case 'cannon': {
      const barrels = tier === 4 ? [-12, 12] : [0];
      for (const dx of barrels) {
        const w = branch === 1 ? 30 : branch === 2 ? 16 : 18 + tier * 2;
        const len = branch === 1 ? 30 : branch === 2 ? 44 : 38 + tier * 2;
        g.fillStyle(C.dark, 1);
        g.fillRect(c + dx - w / 2 - 3, c - len, w + 6, len + 10);
        g.fillStyle(0x2a2e35, 1);
        g.fillRect(c + dx - w / 2, c - len + 2, w, len + 6);
        g.fillStyle(metal, 1);
        g.fillRect(c + dx - w / 2 - 3, c - len, w + 6, 6);
        if (tier >= 2) g.fillRect(c + dx - w / 2 - 2, c - len / 2, w + 4, 4);
        if (branch === 2) {
          poly(
            g,
            [
              [c + dx - 6, c - len],
              [c + dx + 6, c - len],
              [c + dx + 12, c - len - 18],
              [c + dx, c - len - 10],
              [c + dx - 12, c - len - 18],
            ],
            C.fire,
          );
        }
      }
      g.fillStyle(C.dark, 1);
      g.fillCircle(c, c + 6, 22);
      g.fillStyle(metal, 1);
      g.fillCircle(c, c + 6, 16);
      g.fillStyle(glow ? C.fire : 0x2a2e35, 1);
      g.fillCircle(c, c + 6, 7);
      break;
    }
    case 'frost': {
      const shard = (x: number, y: number, h: number, w: number): void => {
        poly(
          g,
          [
            [x, y - h],
            [x + w, y],
            [x, y + h * 0.45],
            [x - w, y],
          ],
          C.dark,
        );
        poly(
          g,
          [
            [x, y - h + 5],
            [x + w - 4, y],
            [x, y + h * 0.45 - 4],
            [x - w + 4, y],
          ],
          C.frost,
        );
        poly(
          g,
          [
            [x, y - h + 8],
            [x + w / 3, y - 4],
            [x, y],
          ],
          C.ice,
        );
      };
      if (branch === 1) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          shard(c + Math.cos(a) * 26, c + Math.sin(a) * 26 + 6, 18, 8);
        }
        shard(c, c + 4, 30, 12);
      } else if (branch === 2) {
        shard(c, c + 10, 56, 16);
        shard(c - 22, c + 18, 22, 8);
        shard(c + 22, c + 18, 22, 8);
      } else {
        shard(c, c + 6, 26 + tier * 6, 12 + tier);
        if (tier >= 2) {
          shard(c - 20, c + 16, 18, 7);
          shard(c + 20, c + 16, 18, 7);
        }
      }
      if (glow) {
        g.lineStyle(3, C.ice, 0.8);
        g.strokeCircle(c, c, 44);
      }
      break;
    }
    case 'tesla': {
      for (let i = 0; i < 3; i++) {
        g.fillStyle(C.dark, 1);
        g.fillEllipse(c, c + 26 - i * 13, 44 - i * 6, 14);
        g.fillStyle(metal, 1);
        g.fillEllipse(c, c + 24 - i * 13, 38 - i * 6, 9);
      }
      const orbs = branch === 1 ? [-16, 16] : [0];
      for (const dx of orbs) {
        g.fillStyle(C.volt, 0.35);
        g.fillCircle(c + dx, c - 22, 22);
        g.fillStyle(C.volt, 1);
        g.fillCircle(c + dx, c - 22, 13 + tier);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(c + dx - 4, c - 26, 4);
      }
      if (branch === 2) {
        g.lineStyle(4, 0xffffff, 1);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.lineBetween(
            c + Math.cos(a) * 16,
            c - 22 + Math.sin(a) * 16,
            c + Math.cos(a) * 30,
            c - 22 + Math.sin(a) * 30,
          );
        }
      }
      if (tier >= 2) {
        g.lineStyle(3, C.volt, 1);
        g.lineBetween(c - 26, c + 26, c - 34, c - 8);
        g.lineBetween(c + 26, c + 26, c + 34, c - 8);
      }
      break;
    }
    case 'mine': {
      if (branch === 1) {
        // The vault: a strongbox spilling gold.
        g.fillStyle(C.dark, 1);
        g.fillRect(c - 32, c - 16, 64, 44);
        g.fillStyle(C.wood, 1);
        g.fillRect(c - 28, c - 12, 56, 36);
        g.fillStyle(metal, 1);
        g.fillRect(c - 30, c - 4, 60, 6);
        g.fillRect(c - 5, c - 8, 10, 14);
        for (const [x, y] of [
          [-16, -22],
          [0, -26],
          [16, -22],
        ]) {
          g.fillStyle(C.gold, 1);
          g.fillCircle(c + x, c + y, 9);
        }
      } else if (branch === 2) {
        // The forge: an anvil over a fire.
        poly(
          g,
          [
            [c - 26, c + 30],
            [c + 26, c + 30],
            [c + 14, c + 8],
            [c - 14, c + 8],
          ],
          C.fire,
        );
        g.fillStyle(C.dark, 1);
        g.fillRect(c - 34, c - 14, 68, 22);
        g.fillStyle(metal, 1);
        g.fillRect(c - 30, c - 12, 60, 14);
        poly(
          g,
          [
            [c + 30, c - 12],
            [c + 44, c - 6],
            [c + 30, c + 2],
          ],
          metal,
        );
      } else {
        g.fillStyle(C.dark, 1);
        g.fillCircle(c, c + 4, 30);
        g.fillStyle(0x24272d, 1);
        g.fillCircle(c, c + 4, 24);
        const n = 2 + tier;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          g.fillStyle(C.gold, 1);
          g.fillCircle(c + Math.cos(a) * 12, c + 4 + Math.sin(a) * 12, 6 + tier);
        }
        g.lineStyle(6, C.wood, 1);
        g.lineBetween(c - 30, c + 30, c + 24, c - 26);
        g.fillStyle(metal, 1);
        poly(
          g,
          [
            [c + 10, c - 36],
            [c + 40, c - 18],
            [c + 26, c - 14],
          ],
          metal,
        );
      }
      if (glow) {
        g.fillStyle(C.gold, 0.25);
        g.fillCircle(c, c, 46);
      }
      break;
    }
    case 'banner': {
      const flags = branch ? 1 : tier;
      for (let i = 0; i < Math.min(3, flags); i++) {
        const x = c - 10 + (i - (Math.min(3, flags) - 1) / 2) * 22;
        g.fillStyle(C.dark, 1);
        g.fillRect(x - 3, c - 40, 6, 72);
        g.fillStyle(metal, 1);
        g.fillRect(x - 2, c - 40, 4, 70);
        poly(
          g,
          [
            [x + 2, c - 38],
            [x + 34, c - 30],
            [x + 24, c - 18],
            [x + 34, c - 6],
            [x + 2, c - 10],
          ],
          C.red,
        );
      }
      if (branch === 1) {
        g.lineStyle(10, C.bronze, 1);
        g.beginPath();
        g.arc(c, c + 6, 26, Math.PI * 0.2, Math.PI * 1.1, false);
        g.strokePath();
        g.fillStyle(C.gold, 1);
        g.fillCircle(c - 25, c + 2, 9);
      }
      if (branch === 2) {
        g.fillStyle(C.dark, 1);
        g.fillRect(c - 22, c + 10, 44, 20);
        g.fillStyle(metal, 1);
        g.fillRect(c - 18, c + 12, 36, 14);
        poly(
          g,
          [
            [c - 14, c + 12],
            [c, c - 22],
            [c + 14, c + 12],
          ],
          C.fire,
        );
        poly(
          g,
          [
            [c - 6, c + 12],
            [c, c - 6],
            [c + 6, c + 12],
          ],
          C.ember,
        );
      }
      break;
    }
  }
}

function enemy(g: G, kind: EKind): void {
  const c = 32;
  switch (kind) {
    case 'imp':
      g.fillStyle(C.dark, 1);
      g.fillCircle(c, c + 2, 22);
      g.fillStyle(0xd6452b, 1);
      g.fillCircle(c, c, 19);
      poly(
        g,
        [
          [c - 16, c - 8],
          [c - 22, c - 28],
          [c - 6, c - 16],
        ],
        C.dark,
      );
      poly(
        g,
        [
          [c + 16, c - 8],
          [c + 22, c - 28],
          [c + 6, c - 16],
        ],
        C.dark,
      );
      g.fillStyle(C.ember, 1);
      g.fillCircle(c - 7, c - 2, 4);
      g.fillCircle(c + 7, c - 2, 4);
      break;
    case 'runner':
      poly(
        g,
        [
          [c, c - 26],
          [c + 18, c + 20],
          [c, c + 10],
          [c - 18, c + 20],
        ],
        C.dark,
      );
      poly(
        g,
        [
          [c, c - 20],
          [c + 13, c + 15],
          [c, c + 6],
          [c - 13, c + 15],
        ],
        0x8fd13a,
      );
      g.fillStyle(0xffffff, 1);
      g.fillCircle(c, c - 4, 4);
      break;
    case 'swarm':
      g.fillStyle(C.dark, 1);
      g.fillCircle(c, c, 22);
      g.fillStyle(C.ember, 1);
      g.fillCircle(c, c, 17);
      g.fillStyle(C.fire, 1);
      g.fillCircle(c + 4, c + 4, 8);
      break;
    case 'brute':
      poly(g, octagon(c, c + 2, 28), C.dark);
      poly(g, octagon(c, c, 25), 0x6d737d);
      poly(g, octagon(c, c, 16), 0x9aa3ad);
      for (const [x, y] of [
        [-26, -26],
        [26, -26],
        [26, 26],
        [-26, 26],
      ]) {
        poly(
          g,
          [
            [c + x * 0.6, c + y * 0.35],
            [c + x, c + y],
            [c + x * 0.35, c + y * 0.6],
          ],
          C.dark,
        );
      }
      g.fillStyle(C.fire, 1);
      g.fillRect(c - 10, c - 4, 20, 5);
      break;
    case 'bat':
      poly(
        g,
        [
          [c, c - 6],
          [c + 30, c - 18],
          [c + 22, c + 4],
          [c + 30, c + 14],
          [c, c + 6],
          [c - 30, c + 14],
          [c - 22, c + 4],
          [c - 30, c - 18],
        ],
        0x6a3fa0,
      );
      g.fillStyle(C.dark, 1);
      g.fillCircle(c, c, 11);
      g.fillStyle(0xff3355, 1);
      g.fillCircle(c - 4, c - 2, 3);
      g.fillCircle(c + 4, c - 2, 3);
      break;
    case 'splitter':
      g.fillStyle(C.dark, 1);
      g.fillCircle(c - 8, c + 2, 20);
      g.fillCircle(c + 8, c + 2, 20);
      g.fillStyle(0x2fb3a0, 1);
      g.fillCircle(c - 8, c, 17);
      g.fillStyle(0x52e0c4, 1);
      g.fillCircle(c + 8, c, 17);
      g.lineStyle(3, C.dark, 1);
      g.lineBetween(c, c - 16, c, c + 16);
      break;
    case 'golem': {
      const rock = (k: number): number[][] => [
        [c - 26 * k, c - 16 * k],
        [c - 12 * k, c - 28 * k],
        [c + 12 * k, c - 28 * k],
        [c + 26 * k, c - 16 * k],
        [c + 30 * k, c + 12 * k],
        [c + 16 * k, c + 29 * k],
        [c - 16 * k, c + 29 * k],
        [c - 30 * k, c + 12 * k],
      ];
      poly(g, rock(1.04), C.dark);
      poly(g, rock(0.92), 0x6b4a32);
      poly(g, rock(0.6), 0x80583a);
      for (const s of [-1, 1]) {
        poly(
          g,
          [
            [c + s * 14, c - 22],
            [c + s * 31, c - 31],
            [c + s * 24, c - 12],
          ],
          0xe8dcc8,
        );
      }
      g.lineStyle(3, C.fire, 1);
      g.lineBetween(c - 18, c + 8, c - 6, c + 20);
      g.lineBetween(c + 20, c + 4, c + 8, c + 22);
      g.lineBetween(c - 4, c - 18, c + 4, c - 8);
      g.fillStyle(C.ember, 1);
      g.fillCircle(c - 10, c - 6, 5);
      g.fillCircle(c + 10, c - 6, 5);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(c - 10, c - 7, 2);
      g.fillCircle(c + 10, c - 7, 2);
      break;
    }
  }
}

function hero(g: G): void {
  const c = R / 2;
  g.fillStyle(0x6fd3ff, 0.16);
  g.fillCircle(c, c, 58);
  poly(g, octagon(c, c + 4, 36), C.dark);
  poly(g, octagon(c, c, 34), 0x4a5260);
  g.fillStyle(0x6b7482, 1);
  g.fillCircle(c - 34, c, 14);
  g.fillCircle(c + 34, c, 14);
  poly(g, octagon(c, c - 4, 22), 0x2a2f37);
  g.fillStyle(0x6fd3ff, 1);
  g.fillRect(c - 16, c - 9, 32, 7);
  g.fillStyle(0xffffff, 1);
  g.fillRect(c - 8, c - 8, 10, 4);
  // The hammer.
  g.fillStyle(C.wood, 1);
  g.fillRect(c + 36, c - 36, 6, 46);
  g.fillStyle(C.iron, 1);
  g.fillRect(c + 26, c - 46, 26, 16);
}

function gate(g: G): void {
  const w = 192;
  const h = 96;
  g.fillStyle(C.dark, 1);
  g.fillRect(8, 20, w - 16, h - 24);
  g.fillStyle(C.stone2, 1);
  g.fillRect(12, 24, w - 24, h - 32);
  for (const x of [12, w - 44]) {
    g.fillStyle(C.dark, 1);
    g.fillRect(x - 4, 4, 40, h - 4);
    g.fillStyle(C.stone, 1);
    g.fillRect(x, 8, 32, h - 12);
    g.fillStyle(C.ember, 1);
    g.fillRect(x + 10, 20, 12, 10);
  }
  g.fillStyle(C.wood, 1);
  g.fillRect(58, 34, w - 116, h - 42);
  g.lineStyle(4, C.iron, 1);
  for (let x = 66; x < w - 58; x += 16) g.lineBetween(x, 34, x, h - 8);
  g.lineBetween(58, 50, w - 58, 50);
}

export function makeArt(scene: Phaser.Scene): void {
  for (let t = 1; t <= 4; t++) make(scene, baseKey(t), R, (g) => base(g, t));
  for (const k of BKINDS) {
    for (let t = 1; t <= 4; t++) {
      const branches: Branch[] = t >= 3 ? [1, 2] : [0];
      for (const b of branches) make(scene, headKey(k, t, b), R, (g) => head(g, k, t, b));
    }
  }
  const kinds: EKind[] = ['imp', 'runner', 'swarm', 'brute', 'bat', 'splitter', 'golem'];
  for (const k of kinds) make(scene, enemyKey(k), 64, (g) => enemy(g, k));
  make(scene, 'hero', R, hero);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  gate(g);
  g.generateTexture('gate', 192, 96);
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(8, 8, 8);
  g.generateTexture('dot', 16, 16);
  g.destroy();
}
