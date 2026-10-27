/**
 * The battle numbers from src/content/*.json turned into the simulation's units: ticks (SIM-01)
 * and thousandths (SIM-04). Content changes only in the JSON (§0); the code reads it here.
 */

import { config } from '../config';
import battle from '../content/battle.json';
import towers from '../content/towers.json';

export const COLS = 7;
export const ROWS = 10;
export const TICKS_PER_SEC = 1000 / config.tickMs;
/** SIM-04: one unit (of elixir, of hit points) is 1000. */
export const UNIT = 1000;

export const secToTicks = (sec: number): number => Math.round(sec * TICKS_PER_SEC);

export interface StaticStats {
  /** Thousandths. */
  hp: number;
  dmg: number;
  cooldownTicks: number;
  /** Thousandths of a cell. */
  range: number;
}

const stats = (t: { hp: number; dmg: number; cooldown: number; range: number }): StaticStats => ({
  hp: t.hp * UNIT,
  dmg: t.dmg * UNIT,
  cooldownTicks: secToTicks(t.cooldown),
  range: Math.round(t.range * UNIT),
});

export const RULES = {
  mainTicks: secToTicks(battle.mainSec),
  doubleFromTick: secToTicks(battle.doubleElixirFromSec),
  overtimeTicks: secToTicks(battle.overtimeSec),
  elixirStart: battle.elixir.start * UNIT,
  elixirMax: battle.elixir.max * UNIT,
  /** GD-20: ticks per unit of elixir (56); twice as fast from 2:00. */
  regenTicks: secToTicks(battle.elixir.regenSec),
  deployTicks: secToTicks(battle.deploySec),
  handSize: battle.handSize,
  tower: stats(towers.tower),
  keep: stats(towers.keep),
  playerLevelGrowthPercent: towers.playerLevelGrowthPercent,
  keepAt: towers.layout.keep as [number, number],
  towersAt: towers.layout.towers as [number, number][],
} as const;

/**
 * CRD-03, LVL-04: a value grown by `percent` per level above 1, rounded at every step. Integer
 * arithmetic only — Math.pow may differ between engines, and the result must not (SIM-40).
 */
export function grow(base: number, level: number, percent: number): number {
  let v = base;
  for (let i = 1; i < level; i++) v = Math.floor((v * percent + 50) / 100);
  return v;
}

/** GD-10: a cell in a side's own system → side 0's system (side 1 is turned by 180°). */
export function toBoard(side: 0 | 1, x: number, y: number): { x: number; y: number } {
  return side === 0 ? { x, y } : { x: COLS - 1 - x, y: ROWS - 1 - y };
}
