/**
 * §2.11, §2.14: trophies and arenas (ARN-01…ARN-03) and the gold of a battle (ECO-02).
 */

import arenas from '../content/arenas.json';

export type Outcome = 'win' | 'loss' | 'draw';

const T = arenas.trophies;

/**
 * ARN-01: a win gives 30, a loss takes 25, ±1 for every 50 trophies of difference (in the
 * opponent's favour — more for a win, less lost), at most ±5: wins 25–35, losses 20–30.
 */
export function trophyDelta(outcome: Outcome, mine: number, theirs: number): number {
  if (outcome === 'draw') return 0;
  const shift = Math.max(-T.spread, Math.min(T.spread, Math.trunc((theirs - mine) / T.per)));
  return outcome === 'win' ? T.win + shift : -(T.loss - shift);
}

/** ARN-03: the arena of a number of trophies. */
export function arenaFor(trophies: number): number {
  let arena = 1;
  for (const a of arenas.arenas) if (trophies >= a.trophies) arena = a.id;
  return arena;
}

export function arenaThreshold(arena: number): number {
  return arenas.arenas.find((a) => a.id === arena)?.trophies ?? 0;
}

/**
 * ARN-01, ARN-02: trophies change; never below the threshold of the arena reached; the arena
 * only goes up. Returns the new arena if one opened.
 */
export function applyTrophies(
  player: { trophies: number; bestTrophies: number; arena: number },
  delta: number,
): number | null {
  player.trophies = Math.max(arenaThreshold(player.arena), player.trophies + delta);
  player.bestTrophies = Math.max(player.bestTrophies, player.trophies);
  const arena = Math.max(player.arena, arenaFor(player.trophies));
  const opened = arena > player.arena ? arena : null;
  player.arena = arena;
  return opened;
}

/** ECO-02: a win gives 20 + 5 × arena gold, a loss 5, a draw 5 (PROGRESS.md). */
export function battleGold(outcome: Outcome, arena: number): number {
  const g = arenas.gold;
  return outcome === 'win'
    ? g.winBase + g.winPerArena * arena
    : outcome === 'loss'
      ? g.loss
      : g.draw;
}
