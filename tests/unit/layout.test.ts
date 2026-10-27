import { describe, expect, it } from 'vitest';
import { COLS, ROWS } from '../../src/sim';
import {
  cellAt,
  computeLayout,
  ELIXIR_H,
  fitActiveArea,
  HAND_H,
  HEADER_H,
  MIN_CELL,
} from '../../src/ui/layout';

const SIZES: [number, number][] = [
  [360, 560],
  [360, 640],
  [390, 844],
  [412, 915],
  [768, 1024],
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1920, 1080],
  [2160, 1080],
];

const inside = (r: { x: number; y: number; w: number; h: number }, w: number, h: number): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const overlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('battle layout (§4.2, UI-10, UI-11, UI-13)', () => {
  it('UI-13: the desktop area is at most 2:1 and 1:2; a phone uses the whole screen', () => {
    expect(fitActiveArea(2560, 1080, true)).toEqual({ width: 2160, height: 1080 });
    expect(fitActiveArea(800, 2000, true)).toEqual({ width: 800, height: 1600 });
    expect(fitActiveArea(390, 844, false)).toEqual({ width: 390, height: 844 });
  });

  it('UI-10: 360×560 — header 48, 40 px cells (280×400), elixir 16, hand 88', () => {
    const l = computeLayout(360, 560);
    expect(l.cell).toBe(MIN_CELL);
    expect([l.field.w, l.field.h]).toEqual([280, 400]);
    expect(HEADER_H + l.field.h + ELIXIR_H + HAND_H).toBe(552);
    expect(l.elixir.y).toBe(l.field.y + l.field.h);
    expect(l.hand.y + l.hand.h).toBe(560);
  });

  it('every size: cells of at least 40 px, the bands inside the screen and apart', () => {
    for (const [w, h] of SIZES) {
      const l = computeLayout(w, h);
      const at = `${String(w)}×${String(h)}`;
      expect(l.cell, at).toBeGreaterThanOrEqual(MIN_CELL);
      expect([l.field.w, l.field.h], at).toEqual([l.cell * COLS, l.cell * ROWS]);
      for (const r of [l.header, l.field, l.elixir, l.hand]) expect(inside(r, w, h), at).toBe(true);
      expect(overlap(l.field, l.header), at).toBe(false);
      expect(overlap(l.field, l.hand), at).toBe(false);
      expect(overlap(l.field, l.elixir), at).toBe(false);
      expect(overlap(l.elixir, l.hand), at).toBe(false);
    }
  });

  it('UI-11: landscape puts the hand in a column right of the field', () => {
    const l = computeLayout(1280, 720);
    expect(l.orientation).toBe('landscape');
    expect(l.hand.x).toBeGreaterThanOrEqual(l.field.x + l.field.w);
    expect(l.header.y + l.header.h).toBeLessThanOrEqual(l.field.y);
  });

  it('finds the cell under a point', () => {
    const l = computeLayout(360, 640);
    expect(cellAt(l, l.field.x + 1, l.field.y + 1)).toEqual({ x: 0, y: 0 });
    expect(cellAt(l, l.field.x + l.field.w - 1, l.field.y + l.field.h - 1)).toEqual({ x: 6, y: 9 });
    expect(cellAt(l, l.field.x - 1, l.field.y)).toBeNull();
    expect(cellAt(l, l.field.x + l.field.w, l.field.y)).toBeNull();
  });
});
