import { describe, expect, it } from 'vitest';
import {
  Bot,
  parseRecord,
  randomDeck,
  RecordDriver,
  recordedBattle,
  runBattle,
  type CardId,
} from '../../src/sim';

/**
 * T-16, REP-T: 200 records of bots replayed against other decks. Heavy: it runs in its own
 * verify step without the coverage instrument (which slows it down several times).
 */

describe('T-16, REP-T: 200 records of bots, replayed against other decks', () => {
  it('moves at most 30% of the events and drops at most 6%', () => {
    const r = { rng: 99 };
    const total = { exact: 0, moved: 0, droppedCell: 0, droppedElixir: 0 };
    let records = 0;
    for (let i = 0; records < 200; i++) {
      const decks: [CardId[], CardId[]] = [randomDeck(r), randomDeck(r)];
      const b0 = new Bot(0, { react: 14, seed: i * 31 + 1 });
      const b1 = new Bot(1, { react: 14, seed: i * 31 + 2 });
      const rec = recordedBattle(
        { seed: i, decks, playerLevels: [1, 1] },
        [(s) => b0.next(s), (s) => b1.next(s)],
        1,
      );
      // Records of battles side 1 lost to another deck.
      if (rec.state.result?.winner !== 0) continue;
      const parsed = parseRecord(rec.timeline);
      if (!('record' in parsed)) throw new Error(parsed.problems.join('; '));
      records += 1;
      const bot = new Bot(0, { react: 14, seed: i * 31 + 3 });
      const driver = new RecordDriver(parsed.record, 1);
      runBattle(
        { seed: 1000 + i, decks: [randomDeck(r), parsed.record.deck], playerLevels: [1, 1] },
        [(s) => bot.next(s), (s) => driver.act(s)],
      );
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += driver.stats[k];
    }
    const n = total.exact + total.moved + total.droppedCell + total.droppedElixir;
    const moved = total.moved / n;
    const dropped = (total.droppedCell + total.droppedElixir) / n;
    console.log(
      `REP-T: ${String(n)} events — exact ${(total.exact / n).toFixed(3)}, moved ${moved.toFixed(3)}, dropped ${dropped.toFixed(3)}`,
    );
    expect(moved).toBeLessThanOrEqual(0.3);
    expect(dropped).toBeLessThanOrEqual(0.06);
  }, 600_000);
});
