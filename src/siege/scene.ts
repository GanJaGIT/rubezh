/**
 * The siege field: both rings, buildings, monsters, the heroes and the effects. The player's own
 * field is below; the opponent's is above, turned half a circle, so the two gates face each other.
 * Positions between ticks are interpolated; effects are drawn into one Graphics per field.
 */

import Phaser from 'phaser';
import { baseKey, enemyKey, headKey, makeArt, R, TURNS } from './art';
import {
  cellCenter,
  CELLS,
  COLS,
  GATE,
  RING,
  ringPoint,
  ROWS,
  U,
  type Building,
  type Pt,
  type Side,
  type SiegeEvent,
  type SiegeState,
} from './sim';

/** Field extent in thousandths around the grid (the ring and a margin). */
const EXT = { x0: -1250, y0: -1300, x1: COLS * U + 1250, y1: ROWS * U + 1250 };
const MID = { x: (COLS * U) / 2, y: (ROWS * U) / 2 };
export const FIELD_W = (EXT.x1 - EXT.x0) / U;
export const FIELD_H = (EXT.y1 - EXT.y0) / U;

export interface Geo {
  cx: number;
  cy: number;
  /** CSS pixels per cell. */
  px: number;
  flip: boolean;
}

const SIZE: Record<string, number> = {
  imp: 0.46,
  runner: 0.42,
  swarm: 0.26,
  brute: 0.6,
  bat: 0.54,
  splitter: 0.52,
  golem: 1.0,
};

interface Fx {
  kind: 'bolt' | 'ball' | 'beam' | 'zap' | 'flame' | 'ring' | 'burst' | 'coin' | 'hit';
  from: Pt;
  to: Pt[];
  t0: number;
  dur: number;
  color: number;
  size: number;
}

interface View {
  box: Phaser.GameObjects.Container;
  ground: Phaser.GameObjects.Graphics;
  under: Phaser.GameObjects.Graphics;
  fx: Phaser.GameObjects.Graphics;
  gate: Phaser.GameObjects.Image;
  hero: Phaser.GameObjects.Image;
  bases: (Phaser.GameObjects.Image | null)[];
  heads: (Phaser.GameObjects.Image | null)[];
  ids: number[];
  pop: number[];
  enemies: Map<number, Phaser.GameObjects.Image>;
  prev: Map<number, Pt>;
  heroPrev: Pt;
  effects: Fx[];
  shake: number;
}

const toLocal = (p: Pt): { x: number; y: number } => ({
  x: ((p.x - MID.x) / U) * R,
  y: ((p.y - MID.y) / U) * R,
});

export class SiegeScene extends Phaser.Scene {
  state: SiegeState | null = null;
  /** Cells to frame on the player's field: allowed (green) and merge targets (gold). */
  marks: { ok: Set<number>; merge: Set<number>; from: number } | null = null;
  /** Called every frame with the time since the last one (ms). */
  onFrame: ((dt: number) => void) | null = null;
  /** Fraction of the current tick passed, for interpolation. */
  alpha = 0;
  private views: View[] = [];
  private geos: Geo[] = [];
  private dpr = 1;
  private ready = false;

  constructor(private readonly onReady: () => void) {
    super('siege');
  }

  create(): void {
    makeArt(this);
    this.cameras.main.setOrigin(0, 0);
    this.cameras.main.setZoom(this.dpr);
    for (let s = 0; s < 2; s++) this.views.push(this.makeView());
    this.ready = true;
    this.applyGeo();
    this.onReady();
  }

  setDpr(dpr: number): void {
    this.dpr = dpr;
    if (this.ready) this.cameras.main.setZoom(dpr);
  }

  setGeo(geos: Geo[]): void {
    this.geos = geos;
    if (this.ready) this.applyGeo();
  }

  geo(side: Side): Geo {
    return this.geos[side];
  }

  /** Screen (CSS px) to field thousandths for a side. */
  toField(side: Side, sx: number, sy: number): Pt {
    const g = this.geos[side];
    const k = g.flip ? -1 : 1;
    return {
      x: Math.round(MID.x + ((sx - g.cx) / g.px) * U * k),
      y: Math.round(MID.y + ((sy - g.cy) / g.px) * U * k),
    };
  }

  toScreen(side: Side, p: Pt): { x: number; y: number } {
    const g = this.geos[side];
    const k = g.flip ? -1 : 1;
    return {
      x: g.cx + ((p.x - MID.x) / U) * g.px * k,
      y: g.cy + ((p.y - MID.y) / U) * g.px * k,
    };
  }

  /** The cell under a field point, or -1. */
  cellAt(p: Pt): number {
    if (p.x < 0 || p.y < 0 || p.x >= COLS * U || p.y >= ROWS * U) return -1;
    return Math.floor(p.y / U) * COLS + Math.floor(p.x / U);
  }

  setState(st: SiegeState | null): void {
    this.state = st;
    for (const v of this.views) {
      for (const e of v.enemies.values()) e.destroy();
      v.enemies.clear();
      v.prev.clear();
      v.effects.length = 0;
      for (let c = 0; c < CELLS; c++) {
        v.bases[c]?.destroy();
        v.heads[c]?.destroy();
        v.bases[c] = null;
        v.heads[c] = null;
        v.ids[c] = 0;
      }
    }
  }

  /** Before a tick: keep where everything stood, for interpolation. */
  beforeStep(): void {
    const st = this.state;
    if (!st) return;
    st.sides.forEach((s, i) => {
      const v = this.views[i];
      v.prev.clear();
      for (const e of s.enemies) v.prev.set(e.id, { x: e.x, y: e.y });
      v.heroPrev = { x: s.hero.x, y: s.hero.y };
    });
  }

  feed(list: readonly SiegeEvent[]): void {
    const now = this.time.now;
    const st = this.state;
    if (!st) return;
    for (const e of list) {
      switch (e.type) {
        case 'shot': {
          const v = this.views[e.side];
          const from = cellCenter(e.cell);
          const fx = (kind: Fx['kind'], color: number, dur: number, size = 1): void => {
            v.effects.push({ kind, from, to: e.to, t0: now, dur, color, size });
          };
          if (e.kind === 'crossbow') fx('bolt', e.branch === 1 ? 0xff5533 : 0xe8d9b0, 110);
          else if (e.kind === 'cannon' && e.branch === 2) fx('flame', 0xff7a1a, 160);
          else if (e.kind === 'cannon') fx('ball', 0x22252b, e.branch === 1 ? 320 : 180, e.tier);
          else if (e.kind === 'frost') fx('beam', 0x8fe3ff, 140, e.branch === 1 ? 2 : 1);
          else if (e.kind === 'tesla') fx('zap', 0xc9a8ff, 130);
          this.views[e.side].heads[e.cell]?.setData('aim', e.to[0]);
          break;
        }
        case 'hero-hit':
          this.views[e.side].effects.push({
            kind: 'hit',
            from: e.to,
            to: [e.to],
            t0: now,
            dur: 160,
            color: 0x9fe6ff,
            size: 1,
          });
          break;
        case 'kill':
          this.views[e.side].effects.push({
            kind: 'burst',
            from: e.at,
            to: [e.at],
            t0: now,
            dur: 420,
            color: e.corrupt ? 0xc06bff : e.kind === 'golem' ? 0xff8a2a : 0xffc46b,
            size: e.kind === 'golem' ? 3 : e.kind === 'swarm' ? 0.6 : 1,
          });
          break;
        case 'ore':
          this.views[e.side].effects.push({
            kind: 'coin',
            from: cellCenter(e.cell),
            to: [],
            t0: now,
            dur: 700,
            color: 0xffd25e,
            size: 1,
          });
          break;
        case 'ability':
        case 'stomp':
          this.views[e.side].effects.push({
            kind: 'ring',
            from: e.at,
            to: [],
            t0: now,
            dur: 420,
            color: e.type === 'ability' ? 0x6fd3ff : 0xb07a45,
            size: 1.8,
          });
          break;
        case 'merged':
          this.views[e.side].pop[e.cell] = now;
          this.views[e.side].effects.push({
            kind: 'ring',
            from: cellCenter(e.cell),
            to: [],
            t0: now,
            dur: 500,
            color: 0xffd25e,
            size: 0.9,
          });
          break;
        case 'built':
          this.views[e.side].pop[e.cell] = now;
          break;
        case 'strike':
          this.views[e.side].shake = now;
          break;
        default:
          break;
      }
    }
  }

  override update(_time: number, delta: number): void {
    this.onFrame?.(delta);
    const st = this.state;
    if (!st || !this.ready) return;
    st.sides.forEach((s, i) => this.drawSide(i as Side, s));
  }

  private makeView(): View {
    const box = this.add.container(0, 0);
    const ground = this.add.graphics();
    const under = this.add.graphics();
    const fx = this.add.graphics();
    const gate = this.add.image(toLocal(GATE).x, toLocal(GATE).y - 6, 'gate').setScale(0.8);
    const hero = this.add.image(0, 0, 'hero').setScale(0.74);
    box.add([ground, under, gate]);
    this.drawGround(ground);
    const v: View = {
      box,
      ground,
      under,
      fx,
      gate,
      hero,
      bases: Array.from({ length: CELLS }, () => null),
      heads: Array.from({ length: CELLS }, () => null),
      ids: Array.from({ length: CELLS }, () => 0),
      pop: Array.from({ length: CELLS }, () => 0),
      enemies: new Map(),
      prev: new Map(),
      heroPrev: { x: 0, y: 0 },
      effects: [],
      shake: 0,
    };
    // Buildings and monsters go between the ground and the effects; the hero above monsters.
    box.add(hero);
    box.add(fx);
    return v;
  }

  private drawGround(g: Phaser.GameObjects.Graphics): void {
    const tl = toLocal({ x: EXT.x0, y: EXT.y0 });
    const br = toLocal({ x: EXT.x1, y: EXT.y1 });
    g.fillStyle(0x1a1e1a, 1);
    g.fillRoundedRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y, 28);
    g.lineStyle(6, 0x0c0e10, 1);
    g.strokeRoundedRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y, 28);
    // The road.
    const pts = RING.pts.map(toLocal);
    const road = (w: number, color: number): void => {
      g.lineStyle(w, color, 1);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.closePath();
      g.strokePath();
      for (const p of pts) {
        g.fillStyle(color, 1);
        g.fillCircle(p.x, p.y, w / 2);
      }
    };
    road(R * 0.86, 0x0e1012);
    road(R * 0.74, 0x3a3227);
    road(R * 0.5, 0x433a2d);
    // Arrows along the way (clockwise).
    g.fillStyle(0x5a4d3a, 1);
    for (let s = 600; s < RING.length; s += 1800) {
      const a = toLocal(ringPoint(s % RING.length));
      const b = toLocal(ringPoint((s + 200) % RING.length));
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const p = (d: number, side: number): number[] => [
        a.x + Math.cos(ang) * d - Math.sin(ang) * side,
        a.y + Math.sin(ang) * d + Math.cos(ang) * side,
      ];
      const t = [p(14, 0), p(-8, 10), p(-8, -10)];
      g.beginPath();
      g.moveTo(t[0][0], t[0][1]);
      g.lineTo(t[1][0], t[1][1]);
      g.lineTo(t[2][0], t[2][1]);
      g.closePath();
      g.fillPath();
    }
    // The grid.
    for (let c = 0; c < CELLS; c++) {
      const p = toLocal({ x: (c % COLS) * U, y: Math.floor(c / COLS) * U });
      const dark = ((c % COLS) + Math.floor(c / COLS)) % 2 === 0;
      g.fillStyle(0x0d0f11, 1);
      g.fillRoundedRect(p.x + 4, p.y + 6, R - 8, R - 8, 14);
      g.fillStyle(dark ? 0x2a302b : 0x313833, 1);
      g.fillRoundedRect(p.x + 4, p.y + 4, R - 8, R - 8, 14);
    }
  }

  private applyGeo(): void {
    this.views.forEach((v, i) => {
      const g = this.geos[i];
      if (!g) return;
      v.box.setPosition(g.cx, g.cy);
      v.box.setScale(g.px / R);
      v.box.setRotation(g.flip ? Math.PI : 0);
    });
  }

  private drawSide(side: Side, s: SiegeState['sides'][number]): void {
    const v = this.views[side];
    const now = this.time.now;
    const a = this.alpha;
    // Gate shake on a strike.
    const shook = now - v.shake < 220;
    const g0 = toLocal(GATE);
    v.gate.setPosition(g0.x + (shook ? (Math.random() - 0.5) * 10 : 0), g0.y - 6);
    v.gate.setTint(shook ? 0xff8877 : 0xffffff);
    v.gate.setAlpha(s.fellAt >= 0 ? 0.35 : 1);

    // Buildings.
    for (let c = 0; c < CELLS; c++) this.syncBuilding(v, c, s.cells[c], now);

    // Monsters.
    const seen = new Set<number>();
    for (const e of s.enemies) {
      seen.add(e.id);
      let img = v.enemies.get(e.id);
      if (!img) {
        img = this.add.image(0, 0, enemyKey(e.kind));
        img.setScale((SIZE[e.kind] * R) / 64);
        v.box.addAt(img, v.box.getIndex(v.hero));
        v.enemies.set(e.id, img);
      }
      const p0 = v.prev.get(e.id) ?? e;
      const p = toLocal({ x: p0.x + (e.x - p0.x) * a, y: p0.y + (e.y - p0.y) * a });
      const bob = e.air ? Math.sin(now / 120 + e.id) * 5 : 0;
      img.setPosition(p.x, p.y + bob);
      // Monsters face their way along the ring.
      if (e.x !== p0.x || e.y !== p0.y) {
        img.setRotation(Math.atan2(e.y - p0.y, e.x - p0.x) + Math.PI / 2);
      }
      img.setTint(e.stun > 0 ? 0xfff0a0 : e.slowT > 0 ? 0x9fdcff : e.shadow ? 0xa98cff : 0xffffff);
    }
    for (const [id, img] of v.enemies) {
      if (!seen.has(id)) {
        img.destroy();
        v.enemies.delete(id);
      }
    }

    // The hero.
    const hp = toLocal({
      x: v.heroPrev.x + (s.hero.x - v.heroPrev.x) * a,
      y: v.heroPrev.y + (s.hero.y - v.heroPrev.y) * a,
    });
    v.hero.setPosition(hp.x, hp.y);
    if (side === 1) v.hero.setRotation(Math.PI);

    this.drawUnder(v, s, side);
    this.drawFx(v, s, now);
  }

  private syncBuilding(v: View, c: number, b: Building | null, now: number): void {
    if (!b) {
      if (v.bases[c]) {
        v.bases[c]?.destroy();
        v.heads[c]?.destroy();
        v.bases[c] = null;
        v.heads[c] = null;
        v.ids[c] = 0;
      }
      return;
    }
    const at = toLocal(cellCenter(c));
    const key = headKey(b.kind, b.tier, b.branch);
    let base = v.bases[c];
    let head = v.heads[c];
    if (!base || !head || v.ids[c] !== b.id) {
      base?.destroy();
      head?.destroy();
      base = this.add.image(at.x, at.y, baseKey(b.tier));
      head = this.add.image(at.x, at.y, key);
      // Above the ground and under the monsters.
      v.box.addAt(base, 3);
      v.box.addAt(head, 4);
      v.bases[c] = base;
      v.heads[c] = head;
      v.ids[c] = b.id;
    }
    if (base.texture.key !== baseKey(b.tier)) base.setTexture(baseKey(b.tier));
    if (head.texture.key !== key) head.setTexture(key);
    const t = (now - v.pop[c]) / 260;
    const pop = t < 1 ? 1 + Math.sin(t * Math.PI) * 0.28 : 1;
    const breathe = b.tier === 4 ? 1 + Math.sin(now / 260 + c) * 0.03 : 1;
    base.setScale(0.92 * pop);
    head.setScale(0.92 * pop * breathe);
    head.setTint(b.stun > 0 ? 0x8888aa : 0xffffff);
    if (TURNS.has(b.kind)) {
      const aim = head.getData('aim') as Pt | undefined;
      if (aim) {
        const cc = cellCenter(c);
        const want = Math.atan2(aim.y - cc.y, aim.x - cc.x) + Math.PI / 2;
        const d = Phaser.Math.Angle.Wrap(want - head.rotation);
        head.setRotation(head.rotation + d * 0.35);
      }
    } else if (b.kind === 'tesla' || b.kind === 'frost') {
      head.setRotation(Math.sin(now / 900 + c) * 0.08);
    }
  }

  /** Under the monsters: the hero's reach, the frames for a dragged card, corrupt auras. */
  private drawUnder(v: View, s: SiegeState['sides'][number], side: Side): void {
    const g = v.under;
    g.clear();
    const hp = v.hero;
    g.lineStyle(3, 0x6fd3ff, 0.25);
    g.strokeCircle(hp.x, hp.y, R * 1.6);
    if (s.hero.abilityT === 0) {
      g.fillStyle(0x6fd3ff, 0.08 + Math.sin(this.time.now / 200) * 0.04);
      g.fillCircle(hp.x, hp.y, R * 1.8);
    }
    if (s.lastStandT > 0) {
      g.fillStyle(0xff6a1a, 0.12);
      const tl = toLocal({ x: 0, y: 0 });
      g.fillRect(tl.x, tl.y, COLS * R, ROWS * R);
    }
    for (const e of s.enemies) {
      if (!e.corrupt) continue;
      const img = v.enemies.get(e.id);
      if (!img) continue;
      g.fillStyle(0xb04dff, 0.35 + Math.sin(this.time.now / 140 + e.id) * 0.15);
      g.fillCircle(img.x, img.y, SIZE[e.kind] * R * 0.75);
    }
    const m = side === 0 ? this.marks : null;
    if (m) {
      for (let c = 0; c < CELLS; c++) {
        const ok = m.ok.has(c);
        const merge = m.merge.has(c);
        if (!ok && !merge && c !== m.from) continue;
        const p = toLocal({ x: (c % COLS) * U, y: Math.floor(c / COLS) * U });
        const color = c === m.from ? 0xffffff : merge ? 0xffd25e : 0x7dff8a;
        g.lineStyle(6, color, merge ? 0.95 : 0.6);
        g.strokeRoundedRect(p.x + 8, p.y + 8, R - 16, R - 16, 12);
      }
    }
  }

  private drawFx(v: View, s: SiegeState['sides'][number], now: number): void {
    const g = v.fx;
    g.clear();
    // Health bars of hurt monsters.
    for (const e of s.enemies) {
      if (e.hp >= e.maxHp) continue;
      const img = v.enemies.get(e.id);
      if (!img) continue;
      const w = Math.max(34, SIZE[e.kind] * R * 0.9);
      const y = img.y - SIZE[e.kind] * R * 0.62;
      g.fillStyle(0x000000, 0.7);
      g.fillRect(img.x - w / 2 - 2, y - 2, w + 4, 9);
      g.fillStyle(e.corrupt ? 0xc06bff : 0xff4d3a, 1);
      g.fillRect(img.x - w / 2, y, (w * Math.max(0, e.hp)) / e.maxHp, 5);
    }
    const keep: Fx[] = [];
    for (const f of v.effects) {
      const t = (now - f.t0) / f.dur;
      if (t >= 1) continue;
      keep.push(f);
      const a = toLocal(f.from);
      switch (f.kind) {
        case 'bolt':
        case 'ball': {
          for (const to of f.to) {
            const b = toLocal(to);
            const x = a.x + (b.x - a.x) * t;
            const y = a.y + (b.y - a.y) * t - (f.kind === 'ball' ? Math.sin(t * Math.PI) * 40 : 0);
            if (f.kind === 'bolt') {
              const ang = Math.atan2(b.y - a.y, b.x - a.x);
              g.lineStyle(5, f.color, 1);
              g.lineBetween(x - Math.cos(ang) * 18, y - Math.sin(ang) * 18, x, y);
            } else {
              g.fillStyle(0x000000, 1);
              g.fillCircle(x, y, 10 + f.size * 2);
              g.fillStyle(0xff9a3a, 1);
              g.fillCircle(x - 3, y - 3, 4);
            }
          }
          if (f.kind === 'ball' && t > 0.75) {
            const b = toLocal(f.to[0]);
            const k = (t - 0.75) / 0.25;
            g.fillStyle(0xff8a2a, 0.7 * (1 - k));
            g.fillCircle(b.x, b.y, 30 + k * 60);
          }
          break;
        }
        case 'beam':
          for (const to of f.to) {
            const b = toLocal(to);
            g.lineStyle(7 * f.size, f.color, 0.8 * (1 - t));
            g.lineBetween(a.x, a.y, b.x, b.y);
            g.fillStyle(0xe8fbff, 0.8 * (1 - t));
            g.fillCircle(b.x, b.y, 14);
          }
          break;
        case 'zap': {
          g.lineStyle(5, f.color, 1 - t);
          let p = a;
          for (const to of f.to) {
            const b = toLocal(to);
            g.beginPath();
            g.moveTo(p.x, p.y);
            for (let k = 1; k < 4; k++) {
              g.lineTo(
                p.x + ((b.x - p.x) * k) / 4 + (Math.random() - 0.5) * 26,
                p.y + ((b.y - p.y) * k) / 4 + (Math.random() - 0.5) * 26,
              );
            }
            g.lineTo(b.x, b.y);
            g.strokePath();
            p = b;
          }
          break;
        }
        case 'flame':
          for (const to of f.to) {
            const b = toLocal(to);
            for (let k = 0; k < 5; k++) {
              const q = (k + t * 5) / 5;
              g.fillStyle(k % 2 ? 0xffb02e : 0xff5a1a, 0.8 * (1 - t));
              g.fillCircle(a.x + (b.x - a.x) * q, a.y + (b.y - a.y) * q, 10 + q * 18);
            }
          }
          break;
        case 'hit':
          g.lineStyle(5, f.color, 1 - t);
          g.strokeCircle(a.x, a.y, 16 + t * 26);
          break;
        case 'ring':
          g.lineStyle(10 * (1 - t) + 2, f.color, 1 - t);
          g.strokeCircle(a.x, a.y, R * f.size * (0.3 + t * 0.7));
          break;
        case 'burst':
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2 + f.t0;
            const d = (14 + t * 46) * f.size;
            g.fillStyle(f.color, 1 - t);
            g.fillCircle(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d, (7 - t * 5) * f.size);
          }
          break;
        case 'coin':
          g.fillStyle(f.color, 1 - t);
          g.fillCircle(a.x + 20, a.y - 20 - t * 50, 9);
          g.fillStyle(0xfff3c0, 1 - t);
          g.fillCircle(a.x + 17, a.y - 23 - t * 50, 3);
          break;
      }
    }
    v.effects = keep;
  }
}
