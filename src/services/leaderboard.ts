/**
 * YG-15: leaderboards within the SDK limits. Scores go only for signed-in players and only when
 * they grew; at most one setScore a second (a queue keeps the latest score of each board).
 * Entries are cached for 60 seconds (getEntries: 20 requests in 5 minutes). Board names —
 * config.leaderboards; the boards themselves are created by the owner in the console.
 *
 * A daily board in one leaderboard: put the day into the score (day × 100000 + points) and
 * filter today's rows when showing (see docs/LESSONS.md).
 */

import type { Entries, Platform } from '../platform/Platform';

const SEND_GAP_MS = 1100;
const CACHE_MS = 60_000;

export class LeaderboardService {
  private readonly sent = new Map<string, number>();
  private readonly queue = new Map<string, number>();
  private readonly cache = new Map<string, { at: number; data: Promise<Entries> }>();
  private sending = false;

  constructor(
    private readonly platform: Platform,
    private readonly now: () => number = () => performance.now(),
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Queues a score; nothing is sent for players who are not signed in or when it did not grow. */
  submit(board: string, score: number): void {
    if (!this.platform.isAuthorized() || score <= 0) return;
    if ((this.sent.get(board) ?? 0) >= score) return;
    this.queue.set(board, Math.max(score, this.queue.get(board) ?? 0));
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      for (;;) {
        const next = this.queue.entries().next();
        if (next.done) return;
        const [board, score] = next.value;
        this.queue.delete(board);
        try {
          await this.platform.leaderboard.setScore(board, score);
          this.sent.set(board, score);
          this.cache.delete(board);
        } catch {
          // The SDK may refuse (limits, network): the next higher score tries again.
        }
        await this.wait(SEND_GAP_MS);
      }
    } finally {
      this.sending = false;
    }
  }

  entries(board: string): Promise<Entries> {
    const hit = this.cache.get(board);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.data;
    const data = this.platform.leaderboard.entries(board);
    this.cache.set(board, { at: this.now(), data });
    data.catch(() => this.cache.delete(board));
    return data;
  }

  /** After a login or an account change the boards are read again. */
  reset(): void {
    this.cache.clear();
    this.sent.clear();
  }
}
