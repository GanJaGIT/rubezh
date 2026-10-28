/**
 * The battle field (TECH-02): Phaser draws only what the simulation state says and reacts to its
 * events (SIM-50). It never changes the battle — input goes through actions queued on the
 * session. Effects FX-01…FX-04: buildings rise with dust, a star flashes on stacking, projectiles
 * fly 150–300 ms (the damage is already counted), numbers float up, the fallen crumble into
 * bricks, the player's zone border is dashed. While a card is chosen the allowed cells light up,
 * a star marks a stacking target and the silhouette with its range follows the finger (INP-01).
 */

import Phaser from 'phaser';
import {
  CARDS,
  COLS,
  ROWS,
  stats,
  type BattleEvent,
  type Building,
  type BuildingKind,
  type CardId,
  type Projectile,
  type Side,
  zoneOf,
} from '../sim';
import { computeLayout, type Layout } from '../ui/layout';
import { ATLAS, loadArt } from './art';
import type { BattleSession } from './session';

/** Atlas frames are 160 px wide for 128 SVG units. */
const FRAME = 160;
/** ART-01: a building sprite is 168 units tall; its cell is the bottom 128, centred at y = 104. */
const ORIGIN_Y = 104 / 168;
const SIZE: Partial<Record<BuildingKind, number>> = { keep: 1.12, tower: 0.95 };
const BAR_W = 0.8;
const BAR_H = 5;
const COLORS = { 0: 0x3f7fff, 1: 0xff4a3d } as const;
const SIDE_NAME = { 0: 'blue', 1: 'red' } as const;

interface BuildingView {
  img: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  stars: Phaser.GameObjects.Image[];
  /** What the bar and the stars show (redrawn only when they change). */
  shownHp: number;
  shownStars: number;
  b: Building;
}

/** INP-01: what the chosen card would do — the cells it may take and the cell under the finger. */
export interface Preview {
  card: CardId;
  side: Side;
  level: number;
  /** Cells allowed for the card (cellIndex → true); stacking targets get a star. */
  allowed: Set<number>;
  stack: Set<number>;
  hover: { x: number; y: number } | null;
}

export class FieldScene extends Phaser.Scene {
  private layout: Layout = computeLayout(360, 640);
  private session: BattleSession | null = null;
  private tiles: Phaser.GameObjects.Image[] = [];
  private divider: Phaser.GameObjects.Graphics | null = null;
  private zoneLine: Phaser.GameObjects.Graphics | null = null;
  private previewG: Phaser.GameObjects.Graphics | null = null;
  private previewStars: Phaser.GameObjects.Image[] = [];
  private ghost: Phaser.GameObjects.Image | null = null;
  private hint: Phaser.GameObjects.Graphics | null = null;
  private hintCell: { x: number; y: number } | null = null;
  private preview: Preview | null = null;
  private readonly views = new Map<number, BuildingView>();
  private readonly simEvents: BattleEvent[] = [];
  /** FX-02: projectiles come from a pool (PERF-03). */
  private readonly pool: Phaser.GameObjects.Image[] = [];
  private dpr = 1;
  private ready = false;
  /** FX-02: damage numbers on hits (a setting may switch them off). */
  showNumbers = true;

  constructor(private readonly onFirstFrame: () => void) {
    super('field');
  }

  preload(): void {
    loadArt(this);
  }

  create(): void {
    this.cameras.main.setOrigin(0, 0);
    this.cameras.main.setZoom(this.dpr);
    this.ready = true;
    this.relayout();
    // YG-02: LoadingAPI.ready() waits for the first drawn frame.
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => this.onFirstFrame());
  }

  /** Size of the active area in CSS pixels and the device pixel ratio. */
  resize(width: number, height: number, dpr: number): void {
    // A hidden page can report 0×0 at start: keep the last good layout (lesson of game 1).
    if (width <= 0 || height <= 0) return;
    this.dpr = dpr;
    this.layout = computeLayout(width, height);
    if (!this.ready) return;
    this.cameras.main.setZoom(dpr);
    this.relayout();
  }

  getLayout(): Layout {
    return this.layout;
  }

  setSession(session: BattleSession | null): void {
    this.session = session;
    this.simEvents.length = 0;
    for (const v of this.views.values()) this.destroyView(v);
    this.views.clear();
    this.preview = null;
    this.hintCell = null;
    if (session) session.onTick((events) => this.simEvents.push(...events));
    if (this.ready) {
      this.drawPreview();
      this.drawHint();
      this.sync();
      this.drawZone(false);
    }
  }

  cellCenter(x: number, y: number): { x: number; y: number } {
    const l = this.layout;
    return { x: l.field.x + (x + 0.5) * l.cell, y: l.field.y + (y + 0.5) * l.cell };
  }

  /** The building on a cell, for the info plate (INP-04). */
  buildingAt(x: number, y: number): Building | null {
    return this.session?.state.buildings.find((b) => b.x === x && b.y === y) ?? null;
  }

  setPreview(p: Preview | null): void {
    this.preview = p;
    if (this.ready) this.drawPreview();
  }

  /** TUT: a pulsing frame on the cell the tutorial points at (null — none). */
  setHint(cell: { x: number; y: number } | null): void {
    this.hintCell = cell;
    if (this.ready) this.drawHint();
  }

  override update(time: number, delta: number): void {
    const s = this.session;
    if (!s) return;
    s.advance(delta);
    for (const e of this.simEvents.splice(0)) this.react(e);
    this.sync();
    if (this.hint) this.hint.setAlpha(0.55 + 0.45 * Math.sin(time / 180));
  }

  // -------------------------------------------------------------------------------------------
  // Buildings

  /** The buildings on screen follow the state: new ones appear, destroyed ones go. */
  private sync(): void {
    const buildings = this.session?.state.buildings ?? [];
    const alive = new Set<number>();
    for (const b of buildings) {
      alive.add(b.id);
      let v = this.views.get(b.id);
      if (!v) {
        v = this.createView(b);
        this.views.set(b.id, v);
      }
      v.b = b;
      if (v.shownHp !== b.hp) this.drawBar(v, b);
      if (v.shownStars !== b.stars) this.drawStars(v, b);
    }
    for (const [id, v] of this.views) {
      if (alive.has(id)) continue;
      this.destroyView(v);
      this.views.delete(id);
    }
  }

  private frameOf(kind: BuildingKind, side: Side): string {
    return `${kind}-${SIDE_NAME[side]}`;
  }

  private scaleOf(kind: BuildingKind): number {
    return (this.layout.cell / FRAME) * (SIZE[kind] ?? 0.92);
  }

  private createView(b: Building): BuildingView {
    const img = this.add.image(0, 0, ATLAS, this.frameOf(b.kind, b.side)).setOrigin(0.5, ORIGIN_Y);
    const v: BuildingView = {
      img,
      bar: this.add.graphics(),
      stars: [],
      shownHp: -1,
      shownStars: 0,
      b,
    };
    this.place(v, b);
    return v;
  }

  private place(v: BuildingView, b: Building): void {
    const p = this.cellCenter(b.x, b.y);
    // Lower rows are nearer to the viewer: they are drawn over the rows behind them.
    v.img
      .setPosition(p.x, p.y)
      .setScale(this.scaleOf(b.kind))
      .setDepth(10 + b.y);
    v.bar.setDepth(30 + b.y);
    v.shownHp = -1;
    v.shownStars = 0;
  }

  /**
   * The hit points bar at the foot of a building, in its side's colour (UI-12); a card building
   * shows it only once it is hurt — a full field of full bars is noise.
   */
  private drawBar(v: BuildingView, b: Building): void {
    v.bar.clear();
    v.shownHp = b.hp;
    const fort = b.kind === 'keep' || b.kind === 'tower';
    if (!fort && b.hp >= b.maxHp) return;
    const c = this.layout.cell;
    const p = this.cellCenter(b.x, b.y);
    const w = Math.round(c * BAR_W);
    const x = Math.round(p.x - w / 2);
    const y = Math.round(p.y + c * 0.5 - BAR_H - 4);
    const share = Math.max(0, b.hp) / b.maxHp;
    v.bar.fillStyle(0x0b0c0f, 0.85).fillRoundedRect(x - 2, y - 2, w + 4, BAR_H + 4, 3);
    v.bar.fillStyle(COLORS[b.side], 1).fillRoundedRect(x, y, Math.max(2, w * share), BAR_H, 2);
  }

  /** GD-50: the stars of a stacked building above it. */
  private drawStars(v: BuildingView, b: Building): void {
    for (const s of v.stars) s.destroy();
    v.stars = [];
    v.shownStars = b.stars;
    if (b.stars < 2) return;
    const c = this.layout.cell;
    const p = this.cellCenter(b.x, b.y);
    const size = (c * 0.26) / 80;
    for (let i = 0; i < b.stars; i++) {
      const x = p.x + (i - (b.stars - 1) / 2) * c * 0.24;
      v.stars.push(
        this.add
          .image(x, p.y - c * 0.62, ATLAS, 'fx-star')
          .setScale(size)
          .setDepth(40 + b.y),
      );
    }
  }

  private destroyView(v: BuildingView): void {
    v.img.destroy();
    v.bar.destroy();
    for (const s of v.stars) s.destroy();
  }

  // -------------------------------------------------------------------------------------------
  // Events (SIM-50 → FX)

  private react(e: BattleEvent): void {
    switch (e.type) {
      case 'placed': {
        const v = this.views.get(e.id) ?? this.createViewFor(e.id);
        if (!v) break;
        // FX-01: the building rises from the ground in a puff of dust.
        const full = this.scaleOf(e.kind);
        v.img.setScale(full * 0.2);
        this.tweens.add({ targets: v.img, scale: full, duration: 260, ease: 'Back.easeOut' });
        const p = this.cellCenter(e.x, e.y);
        this.burst(p.x, p.y + this.layout.cell * 0.25, 'fx-dust', 7, 0.18, 0x9b8c74);
        break;
      }
      case 'stacked': {
        const v = this.views.get(e.id);
        if (!v) break;
        const p = this.cellCenter(v.b.x, v.b.y);
        // FX-01: a flash and a new star.
        this.ring(p.x, p.y, 0xffcf3a);
        const full = this.scaleOf(v.b.kind);
        this.tweens.add({ targets: v.img, scale: full * 1.18, duration: 120, yoyo: true });
        this.burst(p.x, p.y - this.layout.cell * 0.3, 'fx-star', 6, 0.12);
        break;
      }
      case 'shot':
        this.projectile(e.from, e.to, e.projectile);
        break;
      case 'damaged': {
        if (!this.showNumbers) break;
        const v = this.views.get(e.id);
        if (v) this.number(v.b.x, v.b.y, `-${String(Math.round(e.amount / 1000))}`, '#ffe3d6');
        break;
      }
      case 'healed': {
        // Healers heal every tick: only the bigger heals (repair) get a number.
        const v = this.views.get(e.id);
        if (v && e.amount >= 20_000)
          this.number(v.b.x, v.b.y, `+${String(Math.round(e.amount / 1000))}`, '#7dffb0');
        break;
      }
      case 'destroyed': {
        const p = this.cellCenter(e.x, e.y);
        const fort = e.kind === 'keep' || e.kind === 'tower';
        // FX-03: it crumbles into bricks; a tower or the keep — a big collapse.
        this.burst(p.x, p.y, 'fx-brick', fort ? 18 : 9, fort ? 0.2 : 0.14);
        this.burst(p.x, p.y + this.layout.cell * 0.2, 'fx-dust', fort ? 12 : 6, 0.22, 0x9b8c74);
        if (fort) this.cameras.main.shake(260, 0.006);
        break;
      }
      case 'spell':
        this.spellFx(e.card, e.x, e.y);
        break;
      case 'zoneChanged':
        this.drawZone(true);
        break;
      default:
        break;
    }
  }

  /** A building placed this tick that sync() has not drawn yet. */
  private createViewFor(id: number): BuildingView | null {
    const b = this.session?.state.buildings.find((x) => x.id === id);
    if (!b) return null;
    const v = this.createView(b);
    this.views.set(id, v);
    return v;
  }

  /** FX-02: a projectile flies from the shooter to the target in 150–300 ms. */
  private projectile(from: number, to: number, kind: Projectile): void {
    const a = this.views.get(from);
    const b = this.views.get(to);
    if (!a || !b) return;
    const c = this.layout.cell;
    const p0 = this.cellCenter(a.b.x, a.b.y);
    const p1 = this.cellCenter(b.b.x, b.b.y);
    const y0 = p0.y - c * 0.35;
    const y1 = p1.y - c * 0.2;
    const dist = Math.hypot(p1.x - p0.x, y1 - y0) / c;
    const duration = Math.min(300, 150 + dist * 30);
    const img = this.pool.pop() ?? this.add.image(0, 0, ATLAS, `shot-${kind}`);
    img
      .setFrame(`shot-${kind}`)
      .setVisible(true)
      .setAlpha(1)
      .setDepth(50)
      .setScale((c * (kind === 'ball' || kind === 'stone' ? 0.26 : 0.4)) / 80)
      .setPosition(p0.x, y0)
      .setRotation(Math.atan2(y1 - y0, p1.x - p0.x));
    // Balls and stones fly in an arc; arrows, bolts and shards straight.
    const arc = kind === 'ball' || kind === 'stone' ? c * 0.6 : 0;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        img.setPosition(p0.x + (p1.x - p0.x) * t, y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * arc);
      },
      onComplete: () => {
        img.setVisible(false);
        this.pool.push(img);
        this.burst(p1.x, y1, 'fx-sparkle', 3, 0.1, 0xffe0a0);
      },
    });
  }

  private spellFx(card: CardId, x: number, y: number): void {
    const sp = CARDS[card].spell;
    if (!sp) return;
    const [x0, y0] = sp.anchor === 'corner' ? [x, y] : [x - 1, y - 1];
    const c = this.layout.cell;
    const l = this.layout;
    const color = card === 'repair' ? 0x3fd17a : card === 'quake' ? 0xb08a5a : 0xff7a1a;
    const g = this.add.graphics().setDepth(55);
    g.fillStyle(color, 0.35);
    const cx0 = Math.max(0, x0);
    const cy0 = Math.max(0, y0);
    const cx1 = Math.min(COLS, x0 + sp.area[0]);
    const cy1 = Math.min(ROWS, y0 + sp.area[1]);
    g.fillRect(l.field.x + cx0 * c, l.field.y + cy0 * c, (cx1 - cx0) * c, (cy1 - cy0) * c);
    this.tweens.add({ targets: g, alpha: 0, duration: 600, onComplete: () => g.destroy() });
    const mid = this.cellCenter((cx0 + cx1 - 1) / 2, (cy0 + cy1 - 1) / 2);
    if (card === 'fireball') this.burst(mid.x, mid.y, 'fx-fire', 14, 0.3);
    if (card === 'quake') {
      this.cameras.main.shake(320, 0.01);
      this.burst(mid.x, mid.y, 'fx-dust', 14, 0.25, 0x9b8c74);
    }
    if (card === 'repair') this.ring(mid.x, mid.y, 0x3fd17a);
  }

  // -------------------------------------------------------------------------------------------
  // The zone, the preview, the tutorial hint

  /** FX-04: the border of the player's building zone, dashed; it flashes when it changes. */
  private drawZone(flash: boolean): void {
    this.zoneLine?.destroy();
    this.zoneLine = null;
    const s = this.session;
    if (!s) return;
    const zone = zoneCells(s.state, 0);
    const l = this.layout;
    const c = l.cell;
    const g = this.add.graphics().setDepth(3);
    g.lineStyle(Math.max(2, c * 0.05), 0x9cc4ff, 0.9);
    const inZone = (x: number, y: number): boolean =>
      x >= 0 && x < COLS && y >= 0 && y < ROWS && zone.has(y * COLS + x);
    const dash = (x0: number, y0: number, x1: number, y1: number): void => {
      const n = 4;
      for (let i = 0; i < n; i += 2) {
        g.lineBetween(
          x0 + ((x1 - x0) * i) / n,
          y0 + ((y1 - y0) * i) / n,
          x0 + ((x1 - x0) * (i + 1)) / n,
          y0 + ((y1 - y0) * (i + 1)) / n,
        );
      }
    };
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!inZone(x, y)) continue;
        const px = l.field.x + x * c;
        const py = l.field.y + y * c;
        if (!inZone(x, y - 1) && y > 0) dash(px, py, px + c, py);
        if (!inZone(x - 1, y) && x > 0) dash(px, py, px, py + c);
        if (!inZone(x + 1, y) && x < COLS - 1) dash(px + c, py, px + c, py + c);
      }
    }
    this.zoneLine = g;
    if (flash) {
      g.setAlpha(0.2);
      this.tweens.add({ targets: g, alpha: 1, duration: 300 });
    }
  }

  private drawPreview(): void {
    this.previewG?.destroy();
    this.previewG = null;
    for (const s of this.previewStars) s.destroy();
    this.previewStars = [];
    this.ghost?.destroy();
    this.ghost = null;
    const p = this.preview;
    if (!p) return;
    const l = this.layout;
    const c = l.cell;
    const g = this.add.graphics().setDepth(4);
    // INP-01: the allowed cells light up; a stacking target gets a star.
    for (const i of p.allowed) {
      const x = i % COLS;
      const y = Math.floor(i / COLS);
      g.fillStyle(0xffffff, p.stack.has(i) ? 0.1 : 0.18);
      g.fillRect(l.field.x + x * c + 2, l.field.y + y * c + 2, c - 4, c - 4);
      if (p.stack.has(i)) {
        const pc = this.cellCenter(x, y);
        this.previewStars.push(
          this.add
            .image(pc.x, pc.y - c * 0.62, ATLAS, 'fx-star')
            .setScale((c * 0.32) / 80)
            .setDepth(45),
        );
      }
    }
    const h = p.hover;
    if (h) {
      const ok = p.allowed.has(h.y * COLS + h.x);
      const pc = this.cellCenter(h.x, h.y);
      const sp = CARDS[p.card].spell;
      if (sp) {
        // The spell's area (clipped by the edge).
        const [x0, y0] = sp.anchor === 'corner' ? [h.x, h.y] : [h.x - 1, h.y - 1];
        const ax = Math.max(0, x0);
        const ay = Math.max(0, y0);
        const bx = Math.min(COLS, x0 + sp.area[0]);
        const by = Math.min(ROWS, y0 + sp.area[1]);
        g.lineStyle(3, ok ? 0xffd34d : 0xff4a3d, 1);
        g.fillStyle(ok ? 0xffd34d : 0xff4a3d, 0.22);
        g.fillRect(l.field.x + ax * c, l.field.y + ay * c, (bx - ax) * c, (by - ay) * c);
        g.strokeRect(l.field.x + ax * c, l.field.y + ay * c, (bx - ax) * c, (by - ay) * c);
      } else {
        // The silhouette above the cell and the circle of its range.
        const st = stats(p.card, p.level, 1);
        g.lineStyle(3, ok ? 0xffffff : 0xff4a3d, 0.9);
        g.strokeRect(l.field.x + h.x * c + 1, l.field.y + h.y * c + 1, c - 2, c - 2);
        if (st.dmg > 0 && st.line === 0) {
          g.lineStyle(2, 0xffffff, 0.7);
          g.strokeCircle(pc.x, pc.y, st.range * c);
          if (CARDS[p.card].minRange > 0) {
            g.lineStyle(2, 0xff9a8f, 0.6);
            g.strokeCircle(pc.x, pc.y, CARDS[p.card].minRange * c);
          }
        } else if (st.line > 0) {
          const dir = p.side === 0 ? -1 : 1;
          g.fillStyle(0xffffff, 0.15);
          g.fillRect(
            l.field.x + h.x * c,
            pc.y + (dir < 0 ? -st.line * c - c / 2 : c / 2),
            c,
            st.line * c,
          );
        }
        this.ghost = this.add
          .image(pc.x, pc.y, ATLAS, this.frameOf(p.card, p.side))
          .setOrigin(0.5, ORIGIN_Y)
          .setScale(this.scaleOf(p.card))
          .setAlpha(ok ? 0.7 : 0.35)
          .setDepth(48);
      }
    }
    this.previewG = g;
  }

  private drawHint(): void {
    this.hint?.destroy();
    this.hint = null;
    const h = this.hintCell;
    if (!h) return;
    const l = this.layout;
    const c = l.cell;
    const g = this.add.graphics().setDepth(46);
    g.lineStyle(Math.max(3, c * 0.08), 0xffd34d, 1);
    g.strokeRoundedRect(l.field.x + h.x * c + 2, l.field.y + h.y * c + 2, c - 4, c - 4, 6);
    this.hint = g;
  }

  // -------------------------------------------------------------------------------------------
  // Small effects

  private burst(x: number, y: number, frame: string, n: number, size: number, tint?: number): void {
    const k = (this.layout.cell * size) / 80;
    const p = this.add.particles(x, y, ATLAS, {
      frame,
      speed: { min: 40, max: 160 },
      lifespan: 520,
      scale: { start: k, end: 0 },
      alpha: { start: 1, end: 0 },
      rotate: { min: -180, max: 180 },
      gravityY: 220,
      emitting: false,
      ...(tint !== undefined ? { tint } : {}),
    });
    p.setDepth(60);
    p.explode(n);
    this.time.delayedCall(600, () => p.destroy());
  }

  private ring(x: number, y: number, tint: number): void {
    const img = this.add
      .image(x, y, ATLAS, 'fx-ring')
      .setDepth(58)
      .setTint(tint)
      .setScale((this.layout.cell * 0.4) / 160)
      .setAlpha(0.9);
    this.tweens.add({
      targets: img,
      scale: img.scale * 2.4,
      alpha: 0,
      duration: 420,
      onComplete: () => img.destroy(),
    });
  }

  /** FX-02: a damage number (12 px is allowed for them, ACC-02). */
  private number(x: number, y: number, text: string, color: string): void {
    const p = this.cellCenter(x, y);
    const t = this.add
      .text(
        p.x + (Math.random() - 0.5) * this.layout.cell * 0.3,
        p.y - this.layout.cell * 0.3,
        text,
        {
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontStyle: '900',
          fontSize: '13px',
          color,
          stroke: '#14161b',
          strokeThickness: 4,
          resolution: this.dpr,
        },
      )
      .setOrigin(0.5)
      .setDepth(70);
    this.tweens.add({
      targets: t,
      y: t.y - this.layout.cell * 0.5,
      alpha: 0,
      duration: 650,
      onComplete: () => t.destroy(),
    });
  }

  private relayout(): void {
    for (const t of this.tiles) t.destroy();
    this.tiles = [];
    this.divider?.destroy();
    const scale = this.layout.cell / FRAME;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const p = this.cellCenter(x, y);
        const frame = (x + y) % 2 === 0 ? 'tile-a' : 'tile-b';
        // Slightly larger than the cell: no seams between the tiles at fractional zoom.
        this.tiles.push(
          this.add
            .image(p.x, p.y, ATLAS, frame)
            .setScale(scale * 1.01)
            .setDepth(1),
        );
      }
    }
    // GD-10: the line between the halves.
    const l = this.layout;
    const g = this.add.graphics().setDepth(2);
    const mid = l.field.y + (ROWS / 2) * l.cell;
    g.fillStyle(0x14161b, 0.55);
    g.fillRect(l.field.x, mid - 2, l.field.w, 4);
    this.divider = g;
    for (const v of this.views.values()) {
      this.place(v, v.b);
      this.drawStars(v, v.b);
    }
    this.drawZone(false);
    this.drawPreview();
    this.drawHint();
    this.sync();
  }
}

/** GD-40: the cells of a side's zone, for the dashed border (the simulation's own rule). */
function zoneCells(s: BattleSession['state'], side: Side): Set<number> {
  const out = new Set<number>();
  const z = zoneOf(s, side);
  z.forEach((v, i) => {
    if (v === 1) out.add(i);
  });
  return out;
}
