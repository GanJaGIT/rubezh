/**
 * INP-01, INP-07: input on the field through DOM Pointer Events (Phaser input is off): touch,
 * mouse and pen take one path, and the interface over the field cannot "punch through" to it
 * (its controls catch their own events, the rest of #ui lets them pass). Only the first finger
 * counts. Stage 0 reports taps on cells; dragging cards from the hand arrives in Stage 2.
 */

import { cellAt, type Layout } from '../ui/layout';

export class FieldInput {
  constructor(
    target: HTMLElement,
    private readonly stage: HTMLElement,
    private readonly layout: () => Layout,
    private readonly onTap: (x: number, y: number) => void,
    /** A window is open, the battle is paused or an ad shows: input goes nowhere. */
    private readonly blocked: () => boolean,
  ) {
    target.addEventListener('pointerdown', (e) => this.down(e));
  }

  private down(e: PointerEvent): void {
    if (!e.isPrimary || e.button > 0 || this.blocked()) return;
    const r = this.stage.getBoundingClientRect();
    const c = cellAt(this.layout(), e.clientX - r.left, e.clientY - r.top);
    if (!c) return;
    e.preventDefault();
    this.onTap(c.x, c.y);
  }
}
