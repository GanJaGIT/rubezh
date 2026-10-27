/**
 * TECH-14: feature flags and constants. Pure data: also imported by src/sim and scripts.
 * Balance numbers live in src/content/*.json; here — the platform rules and the engine timing.
 */

export type BotKind = 'easy' | 'normal' | 'hard';

export interface GameConfig {
  features: {
    /** YG-14: in-app purchases. Turn on once the products exist in the console. */
    iap: boolean;
    /** AN-01: Yandex Metrica (only if the owner gives a counter number). */
    metrica: boolean;
  };
  metricaId: number;
  /** YG-10: fullscreen ads start after this many battles (the tutorial does not count). */
  adsFromBattle: number;
  /** YG-10: minimum gap between fullscreen ads, server-clock seconds. */
  interstitialMinGapSec: number;
  /** YG-16: ask for a review after this many wins (once). */
  reviewAfterWins: number;
  /** OPP-02: records are searched this many trophies above the player. */
  matchTrophyOffset: number;
  /** OPP-03: no fitting record within this time — the opponent is a bot. */
  matchTimeoutSec: number;
  /** SIM-01: one simulation tick, ms. */
  tickMs: number;
  /** SIM-02: ticks per frame at most; the rest are dropped (no catch-up after a stall). */
  maxTicksPerFrame: number;
  /** BOT-01: the bots' decision interval, ticks. */
  bots: Record<BotKind, number>;
  /** YG-15, ARN-05: technical names of the leaderboards in the console. */
  leaderboards: { trophies: string };
}

export const config: GameConfig = {
  features: {
    iap: false,
    metrica: false,
  },
  metricaId: 0,
  adsFromBattle: 3,
  interstitialMinGapSec: 180,
  reviewAfterWins: 5,
  matchTrophyOffset: 150,
  matchTimeoutSec: 6,
  tickMs: 50,
  maxTicksPerFrame: 6,
  bots: { easy: 30, normal: 14, hard: 8 },
  leaderboards: { trophies: 'trophies' },
};
