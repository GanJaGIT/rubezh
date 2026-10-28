/**
 * §4.3: the player's input in a battle, through DOM Pointer Events (Phaser input is off): touch,
 * mouse and pen take one path; only the first finger counts (INP-07).
 *
 * - INP-01: drag a card from the hand onto the field. The allowed cells light up, the cell under
 *   the finger shows the silhouette and the range; the card is drawn 32 px above a finger (under
 *   the mouse). Released over an allowed cell — played; anywhere else — cancelled.
 * - INP-02: tap a card (it lifts), then tap a cell; tapping the card again drops it.
 * - INP-03: a card the player cannot pay for does not go.
 * - INP-04: a tap on a building with no card chosen shows its plate.
 * - INP-05: Digit1–Digit4 choose a card (App routes the keys).
 */

import {
  CARDS,
  cardLevel,
  cellAllowed,
  cellIndex,
  COLS,
  ROWS,
  UNIT,
  viewOf,
  type BattleState,
  type Building,
  type CardId,
} from '../sim';
import { cellAt } from '../ui/layout';
import { cardArt, type Hand } from '../ui/hand';
import type { FieldScene, Preview } from './FieldScene';

/** INP-01: the card is drawn this far above a finger. */
const FINGER_LIFT = 32;
/** A press that moves less than this is a tap. */
const TAP_SLOP = 10;

export interface InputDeps {
  ui: HTMLElement;
  stage: HTMLElement;
  field: HTMLElement;
  scene: FieldScene;
  hand: Hand;
  state(): BattleState | null;
  /** A window is open, the battle is paused or an ad shows: input goes nowhere. */
  blocked(): boolean;
  play(card: CardId, x: number, y: number): void;
  /** A card that cannot go: no elixir or a cell it may not take. */
  refused(): void;
  /** INP-04: the plate of a building (null — hide it). */
  info(b: Building | null): void;
  /** Something was chosen or let go (sound, tutorial). */
  chose(i: number): void;
}

interface Drag {
  i: number;
  pointer: number;
  x0: number;
  y0: number;
  moved: boolean;
  touch: boolean;
}

export class BattleInput {
  private selected = -1;
  private drag: Drag | null = null;
  private hover: { x: number; y: number } | null = null;
  private readonly ghost: HTMLElement;
  private readonly ghostArt: HTMLImageElement;

  constructor(private readonly d: InputDeps) {
    this.ghost = document.createElement('div');
    this.ghost.className = 'drag-card';
    this.ghost.hidden = true;
    this.ghostArt = document.createElement('img');
    this.ghostArt.alt = '';
    this.ghost.appendChild(this.ghostArt);
    d.ui.appendChild(this.ghost);
    d.field.addEventListener('pointerdown', (e) => this.fieldDown(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e, true));
    window.addEventListener('pointercancel', (e) => this.up(e, false));
  }

  /** The chosen card's index in the hand, or -1. */
  current(): number {
    return this.selected;
  }

  /** A card went down in the hand (Hand → here). */
  press(i: number, e: PointerEvent): void {
    if (!e.isPrimary || e.button > 0 || this.d.blocked() || this.drag) return;
    const card = this.card(i);
    if (!card) return;
    e.preventDefault();
    if (!this.affordable(card)) {
      this.d.refused();
      return;
    }
    this.drag = {
      i,
      pointer: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
      touch: e.pointerType !== 'mouse',
    };
  }

  /** INP-05: a key chose card i (or let it go). */
  choose(i: number): void {
    if (this.d.blocked()) return;
    const card = this.card(i);
    if (!card) return;
    if (this.selected === i) {
      this.cancel();
      return;
    }
    if (!this.affordable(card)) {
      this.d.refused();
      return;
    }
    this.selected = i;
    this.d.hand.select(i);
    this.d.chose(i);
    this.refresh();
  }

  /** Lets the chosen card go; true if there was one (Escape first drops the card, INP-05). */
  cancel(): boolean {
    const had = this.selected >= 0 || this.drag !== null;
    this.selected = -1;
    this.drag = null;
    this.hover = null;
    this.ghost.hidden = true;
    this.d.hand.select(-1);
    this.d.scene.setPreview(null);
    if (had) this.d.chose(-1);
    return had;
  }

  /** Every tick: elixir and the zone change, so does what the chosen card may do. */
  refresh(): void {
    const i = this.drag?.moved ? this.drag.i : this.selected;
    const card = i >= 0 ? this.card(i) : undefined;
    const s = this.d.state();
    if (!card || !s) {
      this.d.scene.setPreview(null);
      return;
    }
    if (!this.affordable(card)) {
      // The elixir went (a spell of the opponent, a tick of a new hand): the choice goes too.
      if (!this.drag) this.cancel();
      return;
    }
    this.d.scene.setPreview(this.previewOf(s, card));
  }

  private card(i: number): CardId | undefined {
    return this.d.state()?.hand[0][i];
  }

  private affordable(card: CardId): boolean {
    const s = this.d.state();
    return !!s && s.elixir[0] >= CARDS[card].cost * UNIT;
  }

  private previewOf(s: BattleState, card: CardId): Preview {
    const view = viewOf(s);
    const allowed = new Set<number>();
    const stack = new Set<number>();
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!cellAllowed(s, 0, card, x, y, view)) continue;
        const i = cellIndex(x, y);
        allowed.add(i);
        if ((view.occ[i] ?? 0) > 0) stack.add(i);
      }
    }
    return { card, side: 0, level: cardLevel(s, 0, card), allowed, stack, hover: this.hover };
  }

  private cellUnder(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.d.stage.getBoundingClientRect();
    return cellAt(this.d.scene.getLayout(), clientX - r.left, clientY - r.top);
  }

  private move(e: PointerEvent): void {
    const g = this.drag;
    if (!g || e.pointerId !== g.pointer) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < TAP_SLOP) return;
    if (!g.moved) {
      g.moved = true;
      const card = this.card(g.i);
      if (card) this.ghostArt.src = cardArt(card);
      this.ghost.hidden = false;
      this.d.hand.select(g.i);
      this.d.chose(g.i);
    }
    const r = this.d.stage.getBoundingClientRect();
    this.ghost.style.transform = `translate(${String(e.clientX - r.left)}px, ${String(
      e.clientY - r.top - (g.touch ? FINGER_LIFT : 0),
    )}px) translate(-50%, -50%)`;
    const cell = this.cellUnder(e.clientX, e.clientY);
    if (cell?.x !== this.hover?.x || cell?.y !== this.hover?.y) {
      this.hover = cell;
      this.refresh();
    }
  }

  private up(e: PointerEvent, released: boolean): void {
    const g = this.drag;
    if (!g || e.pointerId !== g.pointer) return;
    this.drag = null;
    this.ghost.hidden = true;
    if (!g.moved) {
      // INP-02: a tap chooses the card; a tap on the chosen card lets it go.
      if (released) this.choose(g.i);
      return;
    }
    const card = this.card(g.i);
    const cell = released ? this.cellUnder(e.clientX, e.clientY) : null;
    const s = this.d.state();
    this.hover = null;
    this.selected = -1;
    this.d.hand.select(-1);
    this.d.scene.setPreview(null);
    this.d.chose(-1);
    if (!card || !cell || !s || this.d.blocked()) return;
    if (cellAllowed(s, 0, card, cell.x, cell.y) && this.affordable(card)) {
      this.d.play(card, cell.x, cell.y);
    } else this.d.refused();
  }

  private fieldDown(e: PointerEvent): void {
    if (!e.isPrimary || e.button > 0 || this.d.blocked() || this.drag) return;
    const cell = this.cellUnder(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    const s = this.d.state();
    const card = this.selected >= 0 ? this.card(this.selected) : undefined;
    if (!card || !s) {
      // INP-04: the plate of the building under the finger.
      this.d.info(this.d.scene.buildingAt(cell.x, cell.y));
      return;
    }
    this.d.info(null);
    if (cellAllowed(s, 0, card, cell.x, cell.y) && this.affordable(card)) {
      this.cancel();
      this.d.play(card, cell.x, cell.y);
    } else this.d.refused();
  }
}
