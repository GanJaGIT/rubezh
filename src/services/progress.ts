/**
 * TECH-13: the player's progress on top of SaveService — battles and wins, gold and gems, one-time
 * things already shown, settings. Every change is saved at once (YG-08); a battle result goes to
 * the cloud at once too. Trophies, chests and cards (src/meta) join it in Stage 3.
 */

import type { SaveData } from './SaveData';
import type { SaveService } from './save';

export interface BattleOutcome {
  won: boolean;
  /** The battle was a draw (WIN-04). */
  draw: boolean;
  /** ECO-02: gold earned in it. */
  gold: number;
}

export class ProgressService {
  constructor(private readonly save: SaveService) {}

  get data(): SaveData {
    return this.save.data;
  }

  /** UI-02: no battle played yet — the first launch opens a battle at once. */
  firstLaunch(): boolean {
    return this.data.stats.battles === 0 && !this.data.tutorial.done;
  }

  /** YG-10: battles played (fullscreen ads start after adsFromBattle). */
  battles(): number {
    return this.data.stats.battles;
  }

  wins(): number {
    return this.data.stats.wins;
  }

  /** ECO-02, YG-08: the result is saved and goes to the cloud at once. */
  recordBattle(o: BattleOutcome): void {
    this.data.stats.battles += 1;
    if (o.won) this.data.stats.wins += 1;
    this.data.gold += o.gold;
    this.save.commit(true);
  }

  addGold(n: number): void {
    this.data.gold += n;
    this.save.commit();
  }

  /** Spends gold if there is enough. */
  spendGold(n: number): boolean {
    if (this.data.gold < n) return false;
    this.data.gold -= n;
    this.save.commit(true);
    return true;
  }

  /** One-time things: applied one-off purchases, "New" cards. */
  seen(key: string): boolean {
    return this.data.seen.includes(key);
  }

  markSeen(key: string): void {
    if (this.seen(key)) return;
    this.data.seen.push(key);
    this.save.commit();
  }

  setSettings(patch: Partial<SaveData['settings']>): void {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save.commit();
  }

  noteInterstitial(at: number): void {
    this.data.lastInterstitialAt = at;
    this.save.commit();
  }

  markReviewAsked(): void {
    this.data.reviewAsked = true;
    this.save.commit();
  }

  /** Purchases and the like: to the cloud at once. */
  commitImportant(): void {
    this.save.commit(true);
  }
}
