/**
 * SIM-43: mulberry32 with its state kept in the game state (`rng`). The simulation never uses
 * the global random generator or the clock: the same level, seed and actions always give the
 * same game (SIM-40).
 */

export function nextRandom(s: { rng: number }): number {
  const a = (s.rng + 0x6d2b79f5) | 0;
  s.rng = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function randomInt(s: { rng: number }, n: number): number {
  return Math.floor(nextRandom(s) * n);
}

/** SIM-40: 32-bit FNV-1a over a string's UTF-16 code units — the state hash for tests. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
