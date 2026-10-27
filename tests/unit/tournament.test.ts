import { describe, expect, it } from 'vitest';
import { Bot, randomDeck, runBattle, type CardId } from '../../src/sim';

/**
 * T-12, T-17: 1000 battles of bots (random decks, all three bot speeds) — no invalid action of a
 * bot, the invariants (SIM-41) after every tick, every battle ends. A file of its own: it is the
 * slowest test, and vitest runs files in parallel.
 */

describe('T-12, T-17: 1000 battles of bots', () => {
  it('no bot makes an invalid action; the invariants hold after every tick', () => {
    const r = { rng: 2026 };
    let invalid = 0;
    const broken: string[] = [];
    let ended = 0;
    for (let i = 0; i < 1000; i++) {
      const decks: [CardId[], CardId[]] = [randomDeck(r), randomDeck(r)];
      const b0 = new Bot(0, { react: 14, seed: i * 7 + 1 });
      const b1 = new Bot(1, { react: [30, 14, 8][i % 3] as number, seed: i * 7 + 2 });
      const res = runBattle(
        { seed: i, decks, playerLevels: [1, 1] },
        [(s) => b0.next(s), (s) => b1.next(s)],
        { checkInvariants: true },
      );
      invalid += res.invalid[0] + res.invalid[1];
      broken.push(...res.broken);
      if (res.state.phase === 'ended') ended += 1;
    }
    expect(invalid).toBe(0);
    expect(broken).toEqual([]);
    expect(ended).toBe(1000);
  }, 900_000);
});
