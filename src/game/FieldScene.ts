/**
 * The battle field (TECH-02): Phaser draws only what the simulation state says and reacts to its
 * events. It never changes the battle — input goes through actions queued on the session.
 * Stage 0: the grass grid, the line between the halves, the keeps and towers with their hit
 * points. Cards, shots and effects (FX-01…FX-05) come in Stage 2.
 */

import Phaser from 'phaser';
import { COLS, ROWS, type BattleEvent, type Building } from '../sim';
import { computeLayout, type Layout } from '../ui/layout';
import { ATLAS, loadArt } from './art';
import type { BattleSession } from './session';

/** Atlas frames are 160 px wide for 128 SVG units. */
const FRAME = 160;
/** ART-01: a building sprite is 168 units tall; its cell is the bottom 128, centred at y = 104. */
const ORIGIN_Y = 104 / 168;
const SIZE: Partial<Record<Building['kind'], number>> = { keep: 1.12, tower: 0.92 };
const BAR_W = 0.8;
const BAR_H = 6;
const COLORS = { 0: 0x3d7fe0, 1: 0xe0473f } as const;

interface BuildingView {
  img: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  /** The hit points the bar shows (redrawn only when they change). */
  shownHp: number;
}

export class FieldScene extends Phaser.Scene {
  private layout: Layout = computeLayout(360, 640);
  private session: BattleSession | null = null;
  private tiles: Phaser.GameObjects.Image[] = [];
  private divider: Phaser.GameObjects.Graphics | null = null;
  private readonly views = new Map<number, BuildingView>();
  private readonly simEvents: BattleEvent[] = [];
  private dpr = 1;
  private ready = false;

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
    if (session) session.onTick((events) => this.simEvents.push(...events));
    if (this.ready) this.sync();
  }

  cellCenter(x: number, y: number): { x: number; y: number } {
    const l = this.layout;
    return { x: l.field.x + (x + 0.5) * l.cell, y: l.field.y + (y + 0.5) * l.cell };
  }

  override update(_time: number, delta: number): void {
    const s = this.session;
    if (!s) return;
    s.advance(delta);
    this.simEvents.length = 0;
    this.sync();
  }

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
      if (v.shownHp !== b.hp) this.drawBar(v, b);
    }
    for (const [id, v] of this.views) {
      if (alive.has(id)) continue;
      this.destroyView(v);
      this.views.delete(id);
    }
  }

  private frameOf(b: Building): string {
    // Stage 0 draws only the keeps and towers; card buildings get their sprites in Stage 2.
    const kind = b.kind === 'keep' ? 'keep' : 'tower';
    return `${kind}-${b.side === 0 ? 'blue' : 'red'}`;
  }

  private createView(b: Building): BuildingView {
    const img = this.add.image(0, 0, ATLAS, this.frameOf(b)).setOrigin(0.5, ORIGIN_Y);
    const bar = this.add.graphics();
    const v = { img, bar, shownHp: -1 };
    this.place(v, b);
    return v;
  }

  private place(v: BuildingView, b: Building): void {
    const p = this.cellCenter(b.x, b.y);
    const scale = (this.layout.cell / FRAME) * (SIZE[b.kind] ?? 0.9);
    // Lower rows are nearer to the viewer: they are drawn over the rows behind them.
    v.img
      .setPosition(p.x, p.y)
      .setScale(scale)
      .setDepth(10 + b.y);
    v.bar.setDepth(30 + b.y);
    v.shownHp = -1;
  }

  /**
   * The hit points bar at the foot of a building, in its side's colour (UI-12): there it never
   * covers the flag or the building in the row behind.
   */
  private drawBar(v: BuildingView, b: Building): void {
    const c = this.layout.cell;
    const p = this.cellCenter(b.x, b.y);
    const w = Math.round(c * BAR_W);
    const x = Math.round(p.x - w / 2);
    const y = Math.round(p.y + c * 0.5 - BAR_H - 4);
    const share = Math.max(0, b.hp) / b.maxHp;
    v.bar.clear();
    v.bar.fillStyle(0x33261b, 0.85).fillRoundedRect(x - 2, y - 2, w + 4, BAR_H + 4, 4);
    v.bar.fillStyle(COLORS[b.side], 1).fillRoundedRect(x, y, Math.max(2, w * share), BAR_H, 3);
    v.shownHp = b.hp;
  }

  private destroyView(v: BuildingView): void {
    v.img.destroy();
    v.bar.destroy();
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
    // GD-10: the line between the halves — a dashed border of light earth.
    const l = this.layout;
    const g = this.add.graphics().setDepth(2);
    const mid = l.field.y + (ROWS / 2) * l.cell;
    const dash = l.cell / 4;
    g.fillStyle(0xf3e3b5, 0.85);
    for (let x = l.field.x; x < l.field.x + l.field.w; x += dash * 2) {
      g.fillRoundedRect(x + dash / 4, mid - 2, Math.min(dash, l.field.x + l.field.w - x), 4, 2);
    }
    this.divider = g;
    for (const b of this.session?.state.buildings ?? []) {
      const v = this.views.get(b.id);
      if (v) this.place(v, b);
    }
    this.sync();
  }
}
