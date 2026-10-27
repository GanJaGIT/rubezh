/**
 * §4.2: the battle screen layout in CSS pixels of the active area. Pure, shared by the DOM and
 * Phaser (the field is drawn exactly where the DOM expects it), and unit-tested.
 */

import { COLS, ROWS } from '../sim/rules';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  /** UI-10: opponent, timer, crowns, pause. */
  header: Rect;
  /** The 7×10 grid itself: cells of `cell` px. */
  field: Rect;
  cell: number;
  /** UI-10: the elixir bar under the field. */
  elixir: Rect;
  /** UI-10: 4 cards and the next one — under the elixir (portrait) or a column on the right. */
  hand: Rect;
}

/** UI-10: heights of the bands around the field. */
export const HEADER_H = 48;
export const ELIXIR_H = 16;
export const HAND_H = 88;
/** UI-11: the hand column in landscape (a 64 px card and its margins). */
export const HAND_COL_W = 88;
/** UI-10: a phone cell is at least 40 px; a big screen does not blow the field up. */
export const MIN_CELL = 40;
export const MAX_CELL = 72;
export const GAP = 8;

/**
 * UI-13: on a computer the active area is never wider than 2:1 nor narrower than 1:2 and touches
 * the short side of the window. A phone always uses the whole screen (no bars on long phones).
 */
export function fitActiveArea(
  vw: number,
  vh: number,
  desktop: boolean,
): { width: number; height: number } {
  if (!desktop) return { width: Math.floor(vw), height: Math.floor(vh) };
  return {
    width: Math.floor(Math.min(vw, vh * 2)),
    height: Math.floor(Math.min(vh, vw * 2)),
  };
}

/**
 * UI-10 (portrait, top to bottom): header, field, elixir, hand — 48 + 10 cells + 16 + 88, so a
 * 360×560 screen gets 40 px cells. UI-11 (landscape and computers): the header over the field,
 * the field in the middle, the elixir under it, the hand as a column on its right.
 */
export function computeLayout(width: number, height: number): Layout {
  const landscape = width > height;
  if (!landscape) {
    const room = height - HEADER_H - ELIXIR_H - HAND_H;
    const cell = Math.max(1, Math.floor(Math.min(MAX_CELL, width / COLS, room / ROWS)));
    const fw = cell * COLS;
    const fh = cell * ROWS;
    // What is left over goes evenly above and below the field.
    const spare = Math.max(0, room - fh);
    const fy = HEADER_H + Math.floor(spare / 2);
    const field: Rect = { x: Math.round((width - fw) / 2), y: fy, w: fw, h: fh };
    return {
      width,
      height,
      orientation: 'portrait',
      header: { x: 0, y: 0, w: width, h: HEADER_H },
      field,
      cell,
      elixir: { x: field.x, y: fy + fh, w: fw, h: ELIXIR_H },
      hand: { x: 0, y: height - HAND_H, w: width, h: HAND_H },
    };
  }
  const room = height - HEADER_H - ELIXIR_H - 2 * GAP;
  const cell = Math.max(
    1,
    Math.floor(Math.min(MAX_CELL, (width - 2 * (HAND_COL_W + GAP)) / COLS, room / ROWS)),
  );
  const fw = cell * COLS;
  const fh = cell * ROWS;
  const fx = Math.round((width - fw) / 2);
  const fy = HEADER_H + GAP + Math.floor(Math.max(0, room - fh) / 2);
  return {
    width,
    height,
    orientation: 'landscape',
    header: { x: 0, y: 0, w: width, h: HEADER_H },
    field: { x: fx, y: fy, w: fw, h: fh },
    cell,
    elixir: { x: fx, y: fy + fh + GAP / 2, w: fw, h: ELIXIR_H },
    hand: { x: fx + fw + GAP, y: fy, w: HAND_COL_W, h: fh },
  };
}

/** The cell under a point of the active area, or null outside the field. */
export function cellAt(l: Layout, px: number, py: number): { x: number; y: number } | null {
  if (px < l.field.x || py < l.field.y) return null;
  const x = Math.floor((px - l.field.x) / l.cell);
  const y = Math.floor((py - l.field.y) / l.cell);
  if (x >= COLS || y >= ROWS) return null;
  return { x, y };
}
