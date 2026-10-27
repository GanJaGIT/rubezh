/**
 * YG-10…YG-13: the ad rules in one place. A rewarded video only after a button press; a
 * fullscreen ad only right after "To menu" in the battle result window, from the battle
 * adsFromBattle on (the tutorial does not count), at most once in 180 s by the server clock; never
 * in a battle or while an opponent is searched; the sticky banner in the menu only. "No ads" (YG-14) removes the fullscreen ads and the banner; rewarded
 * videos stay the player's choice. While an ad shows, the game is silent and paused (YG-05).
 */

import { config } from '../config';
import type { Platform } from '../platform/Platform';
import type { Lifecycle } from './lifecycle';
import type { ProgressService } from './progress';

export class AdService {
  private busy = false;
  private inMenu = false;
  private bannerShown = false;

  constructor(
    private readonly platform: Platform,
    private readonly lifecycle: Pick<Lifecycle, 'setAd'>,
    private readonly progress: ProgressService,
  ) {}

  /** An ad is on screen now: the game ignores input and pause keys. */
  showing(): boolean {
    return this.busy;
  }

  /** YG-11: true only when the platform granted the reward (onRewarded). */
  async rewarded(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.lifecycle.setAd(true);
    try {
      return await this.platform.showRewarded();
    } catch {
      return false;
    } finally {
      this.lifecycle.setAd(false);
      this.busy = false;
    }
  }

  /** YG-10: whether "To menu" in the battle result window shows an ad now. */
  interstitialDue(): boolean {
    if (this.progress.data.noAds) return false;
    if (this.progress.battles() < config.adsFromBattle) return false;
    const last = this.progress.data.lastInterstitialAt;
    return this.platform.serverTime() - last >= config.interstitialMinGapSec * 1000;
  }

  /**
   * YG-10: called right after the button; resolves when the ad is closed, was not shown (the
   * platform limits how often) or failed — then the game goes on.
   */
  async interstitial(): Promise<void> {
    if (this.busy || !this.interstitialDue()) return;
    this.busy = true;
    this.progress.noteInterstitial(this.platform.serverTime());
    this.lifecycle.setAd(true);
    try {
      await this.platform.showInterstitial();
    } catch {
      // The game goes on.
    } finally {
      this.lifecycle.setAd(false);
      this.busy = false;
    }
  }

  /** YG-12: the banner shows in the menu and hides in a battle (and after "No ads"). */
  setBanner(inMenu: boolean): void {
    this.inMenu = inMenu;
    this.refreshBanner();
  }

  /** After "No ads" the banner goes away at once (1.13.5). */
  refreshBanner(): void {
    const want = this.inMenu && !this.progress.data.noAds;
    if (want === this.bannerShown) return;
    this.bannerShown = want;
    void (want ? this.platform.showSticky() : this.platform.hideSticky()).catch(() => undefined);
  }
}
