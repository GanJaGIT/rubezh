/**
 * The siege bot: plays the same actions a player does. Its strength is how often it acts and
 * whether it uses the hero well; it never sees anything a player could not.
 */

import {
  canMerge,
  canPlay,
  CELLS,
  CONTENT,
  COLS,
  hornCost,
  neighbours,
  ROWS,
  stats,
  type Action,
  type Branch,
  type BKind,
  type Side,
  type SiegeState,
} from './sim';

export type BotLevel = 'easy' | 'normal' | 'hard';

const EVERY: Record<BotLevel, number> = { easy: 36, normal: 16, hard: 6 };

/** Outer cells see the most of the ring; inner ones are for mines and banners. */
const OUTER = Array.from({ length: CELLS }, (_, c) => c).filter((c) => {
  const x = c % COLS;
  const y = Math.floor(c / COLS);
  return x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
});
const INNER = Array.from({ length: CELLS }, (_, c) => c).filter((c) => !OUTER.includes(c));

/** The preferred branch per kind (A = 1, B = 2): the bot mixes them by the building id. */
const BRANCH: Record<BKind, Branch[]> = {
  crossbow: [2, 1],
  cannon: [1, 2],
  frost: [1, 2],
  tesla: [1, 2],
  mine: [1, 2],
  banner: [2, 1],
};

export function botActions(st: SiegeState, side: Side, level: BotLevel): Action[] {
  const every = EVERY[level];
  if ((st.tick + side * 3) % every !== 0) return [];
  const s = st.sides[side];
  if (s.fellAt >= 0 || st.result) return [];
  const out: Action[] = [];

  // The hero: towards the densest group near the gate's end of the lap.
  if (level !== 'easy' || st.tick % (every * 3) === 0) {
    let best = -1;
    let at: { x: number; y: number } | null = null;
    for (const e of s.enemies) {
      if (e.air) continue;
      let score = 0;
      for (const o of s.enemies) {
        if (Math.abs(o.x - e.x) + Math.abs(o.y - e.y) < 1600) score += o.strike * 2 + 1;
      }
      score += Math.trunc(e.s / 2000);
      if (score > best) {
        best = score;
        at = e;
      }
    }
    if (at) out.push({ type: 'move', side, x: at.x, y: at.y });
    if (level !== 'easy' && s.hero.abilityT === 0) {
      const near = s.enemies.filter(
        (e) => Math.abs(e.x - s.hero.x) + Math.abs(e.y - s.hero.y) < 1800,
      ).length;
      if (near >= (level === 'hard' ? 4 : 6)) out.push({ type: 'ability', side });
    }
  }

  // Merge the first matching pair.
  for (let a = 0; a < CELLS; a++) {
    for (let b = a + 1; b < CELLS; b++) {
      if (!canMerge(st, side, a, b)) continue;
      const t = s.cells[b];
      if (!t) continue;
      const pref = BRANCH[t.kind];
      out.push({ type: 'merge', side, from: a, to: b, branch: pref[t.id % 4 === 0 ? 1 : 0] });
      return out;
    }
  }

  // Play a card: onto a matching tier-1 building first, else into a good empty cell.
  const order = s.hand
    .map((k, i) => ({ k, i }))
    .sort((p, q) => CONTENT.buildings[p.k].cost - CONTENT.buildings[q.k].cost);
  for (const { k, i } of order) {
    const same = s.cells.findIndex((b) => b?.kind === k && b.tier === 1);
    if (same >= 0 && canPlay(st, side, i, same)) {
      out.push({ type: 'play', side, slot: i, cell: same });
      return out;
    }
    const cell = pickCell(st, side, k);
    if (cell >= 0 && canPlay(st, side, i, cell)) {
      out.push({ type: 'play', side, slot: i, cell });
      return out;
    }
  }

  // Nothing to play: send the horn when rich, or reroll a hand that cannot merge.
  if (level !== 'easy' && s.ore >= hornCost(s) + 80 && s.hornT === 0 && s.gate > 25) {
    out.push({ type: 'horn', side });
  } else if (s.cells.every(Boolean) && s.ore >= CONTENT.reroll + 60) {
    out.push({ type: 'reroll', side });
  }
  return out;
}

function pickCell(st: SiegeState, side: Side, kind: BKind): number {
  const s = st.sides[side];
  const empty = (c: number): boolean => !s.cells[c];
  const support = kind === 'mine' || kind === 'banner';
  const first = support ? INNER : OUTER;
  const second = support ? OUTER : INNER;
  const pool = first.filter(empty);
  const list = pool.length ? pool : second.filter(empty);
  if (!list.length) return -1;
  if (kind !== 'banner') return list[((st.tick / 6 + side) % list.length) | 0];
  // A banner goes where it touches the most attacking buildings.
  let best = list[0];
  let score = -1;
  for (const c of list) {
    const n = neighbours(c).filter((x) => {
      const b = s.cells[x];
      return b && stats(b.kind, b.tier, b.branch).attack;
    }).length;
    if (n > score) {
      score = n;
      best = c;
    }
  }
  return best;
}
