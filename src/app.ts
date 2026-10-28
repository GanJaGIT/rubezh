/**
 * The screens and their rules: the menu, a battle, the windows (pause, surrender, settings, the
 * battle result, leaderboard, shop). It owns the battle session and talks to the services; the
 * simulation is changed only through actions, the drawing only reads the state and its events.
 *
 * The platform rules built in here (and tested in tests/e2e): the battle never moves while the
 * player is away (YG-04, YG-05), also after an ad; a fullscreen ad only right after "To menu" in
 * the result window, from the battle adsFromBattle on; rewarded only by a button that says so;
 * the banner only in the menu; GameplayAPI only through GameplayState.
 */

import { config } from './config';
import type { FieldScene } from './game/FieldScene';
import { BattleInput } from './game/input';
import { BattleSession } from './game/session';
import { dictionaries, supportedLangs } from './i18n';
import type { Platform } from './platform/Platform';
import type { AdService } from './services/ads';
import { scalePitch, type AudioService } from './services/audio';
import type { GameplayState } from './services/gameplay-state';
import { I18n } from './services/I18n';
import type { LeaderboardService } from './services/leaderboard';
import type { ProgressService } from './services/progress';
import type { ShopService } from './services/shop';
import { awardChest, botOpponent, deckLevels } from './meta';
import { Bot, type BattleEvent, type BattleSetup, type BattleState, type CardId } from './sim';
import { Tutorial, tutorialSetup, type TutorialStep } from './tutorial';
import { APP_VERSION } from './version';
import { el, ICONS } from './ui/dom';
import { Hand } from './ui/hand';
import { Hud, type OpponentInfo } from './ui/hud';
import { computeLayout } from './ui/layout';
import { Menu } from './ui/menu';
import { Modals } from './ui/modal';
import { Toast } from './ui/toast';
import { Windows } from './ui/windows';

/** The last moment of the battle is seen before the result window opens. */
const END_DELAY_MS = 900;
/** ECO-02: a loss gives 5 gold; a draw gives the same (decision in PROGRESS.md). */
const LOSS_GOLD = 5;

export interface AppParts {
  platform: Platform;
  audio: AudioService;
  gameplay: GameplayState;
  scene: FieldScene;
  progress: ProgressService;
  ads: AdService;
  boards: LeaderboardService;
  shop: ShopService;
  i18n: I18n;
  ui: HTMLElement;
  stage: HTMLElement;
  field: HTMLElement;
}

export class App {
  session: BattleSession | null = null;
  opponent: OpponentInfo | null = null;
  private botName = 1;
  private readonly hand: Hand;
  private readonly input: BattleInput;
  /** TUT-01…TUT-03: the tutorial battle in progress, if any. */
  private tutorial: Tutorial | null = null;
  private i18n: I18n;
  private readonly hud: Hud;
  private readonly menu: Menu;
  readonly modals: Modals;
  private readonly toast: Toast;
  private readonly meta: Windows;
  private endTimer = 0;
  private size = { w: 0, h: 0 };
  /** UI-15, YG-20: when the first touch and the last fullscreen change were. */
  private firstTouchAt = -Infinity;
  private fullscreenAt = -Infinity;

  constructor(private readonly p: AppParts) {
    this.i18n = p.i18n;
    this.hud = new Hud(p.ui, p.i18n, { pause: () => this.pause() });
    this.hand = new Hand(this.hud.hand, p.i18n, { press: (i, e) => this.input.press(i, e) });
    this.input = new BattleInput({
      ui: p.ui,
      stage: p.stage,
      field: p.field,
      scene: p.scene,
      hand: this.hand,
      state: () => this.session?.state ?? null,
      blocked: () => this.blocked(),
      play: (card, x, y) => this.playCard(card, x, y),
      refused: () => p.audio.play('invalid'),
      info: (b) => this.hud.info(b),
      chose: (i) => {
        if (i >= 0) p.audio.play('tap');
        this.tutorial?.chose(i);
      },
    });
    this.hud.setVisible(false);
    this.menu = new Menu(
      p.ui,
      p.i18n,
      p.progress,
      {
        play: () => this.startBattle(),
        rating: () => this.meta.openRating(),
        settings: () => this.openSettings(false),
        shop: () => this.meta.openShop(),
      },
      p.shop.enabled,
    );
    // YG-03: a window over the battle stops the gameplay; sounds on buttons (FX-06).
    this.modals = new Modals(
      p.ui,
      () => p.gameplay.windowOpened(),
      () => {
        p.gameplay.windowClosed();
        this.toast.flush();
      },
      () => p.audio.play('button'),
    );
    this.toast = new Toast(p.ui, () => this.modals.current() !== null);
    this.meta = new Windows({
      platform: p.platform,
      progress: p.progress,
      boards: p.boards,
      shop: p.shop,
      modals: this.modals,
      toast: this.toast,
      i18n: () => this.i18n,
      changed: () => this.renderMenu(),
    });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('pointerdown', () => (this.firstTouchAt = performance.now()), {
      capture: true,
      once: true,
    });
    document.addEventListener('fullscreenchange', () => (this.fullscreenAt = performance.now()));
    p.audio.setEnabled(p.progress.data.settings.sound);
  }

  /** UI-02: the first launch opens a battle at once (the tutorial in Stage 2), later — the menu. */
  boot(battle: boolean): void {
    const t = this.p.progress.data.tutorial;
    if (battle) this.startBattle();
    else if (!t.done) this.startTutorial(Math.min(3, t.step + 1) as TutorialStep);
    else this.showMenu();
  }

  /** TUT-01…TUT-03: a tutorial battle against a passive bot. */
  startTutorial(step: TutorialStep): void {
    const d = this.p.progress.data;
    this.startBattle(tutorialSetup(step, d.player.level));
    const s = this.session;
    if (!s) return;
    s.driver = null;
    this.opponent = { name: this.i18n.t('tut.bot'), kind: 'bot' };
    this.hud.setOpponent(this.opponent);
    this.tutorial = new Tutorial(
      step,
      {
        say: (key) => this.hud.say(key ? this.i18n.t(key) : null),
        card: (i) => this.hand.hint(i),
        cell: (c) => this.p.scene.setHint(c),
        done: (n) => this.tutorialDone(n),
      },
      s.state,
    );
  }

  /**
   * TUT-02, TUT-03: a tutorial battle is won. No trophies are given or taken; after the third the
   * first chest arrives and the menu opens. After the first the rest can be skipped.
   */
  private tutorialDone(step: TutorialStep): void {
    const pr = this.p.progress;
    pr.data.tutorial.step = Math.max(pr.data.tutorial.step, step);
    const last = step === 3;
    if (last) this.finishTutorial();
    else pr.commitImportant();
    this.halt();
    this.p.audio.play('win');
    this.modals.open({
      ui: 'tutorial-done',
      title: this.i18n.t(`tut.${String(step)}.done`),
      text: this.i18n.t(last ? 'tut.all' : `tut.${String(step)}.next`),
      buttons: [
        {
          ui: 'tutorial-next',
          label: this.i18n.t(last ? 'tut.menu' : 'tut.next'),
          primary: true,
          onClick: () => (last ? this.showMenu() : this.startTutorial((step + 1) as TutorialStep)),
        },
        ...(last
          ? []
          : [
              {
                ui: 'tutorial-skip',
                label: this.i18n.t('tut.skip'),
                onClick: () => {
                  this.finishTutorial();
                  this.showMenu();
                },
              },
            ]),
      ],
    });
  }

  /** TUT-03: the tutorial is over — the first chest, saved to the cloud at once. */
  private finishTutorial(): void {
    const d = this.p.progress.data;
    if (d.tutorial.done) return;
    d.tutorial = { done: true, step: 3 };
    awardChest(d, { rng: this.p.platform.serverTime() >>> 0 });
    this.p.progress.commitImportant();
  }

  // -------------------------------------------------------------------------------------------
  // Screens

  showMenu(): void {
    this.endBattle();
    this.modals.close();
    this.menu.show();
    this.p.field.hidden = true;
    // YG-12: the sticky banner only in the menu.
    this.p.ads.setBanner(true);
  }

  renderMenu(): void {
    if (this.menu.visible()) this.menu.render();
  }

  /**
   * A battle against the stand-in opponent: Stage 0 has no cards, so it is an empty field that
   * runs its 3 minutes. The search screen, records and bots come in Stages 1–4 (OPP, YG-23).
   * DEV-02: tests pass their own setup.
   */
  startBattle(setup?: BattleSetup): void {
    this.endBattle();
    this.modals.close();
    this.menu.hide();
    // YG-12: the banner is hidden before the search and the battle.
    this.p.ads.setBanner(false);
    const d = this.p.progress.data;
    const deck = d.decks[d.activeDeck] ?? [];
    // SIM-43: a bot battle is seeded by the server clock; OPP-03: the bot of the player's arena.
    const seed = this.p.platform.serverTime() >>> 0;
    const bot = botOpponent(d, { rng: seed ^ 0x9e3779b9 });
    const s = new BattleSession(
      setup ?? {
        seed,
        decks: [[...deck], bot.deck],
        cardLevels: [deckLevels(d, deck), bot.levels],
        playerLevels: [d.player.level, d.player.level],
      },
    );
    const driver = new Bot(1, { react: bot.react, seed: seed ^ 0x5bd1e995 });
    s.driver = (state) => driver.next(state);
    s.onTick((events, state) => this.onTick(events, state));
    this.session = s;
    this.botName = bot.name;
    this.opponent = { name: this.i18n.t(`bot.name.${String(bot.name)}`), kind: 'bot' };
    this.hud.setOpponent(this.opponent);
    this.p.scene.setSession(s);
    this.p.field.hidden = false;
    this.hud.setVisible(true);
    this.hud.update(s.state);
    this.hand.update(s.state);
    this.input.cancel();
    this.p.gameplay.setInBattle(true);
  }

  private endBattle(): void {
    window.clearTimeout(this.endTimer);
    this.tutorial = null;
    this.hand.hint(-1);
    this.p.scene.setHint(null);
    this.hud.say(null);
    if (this.session) this.session.paused = true;
    this.session = null;
    this.opponent = null;
    this.p.scene.setSession(null);
    this.hud.setVisible(false);
    this.p.gameplay.setInBattle(false);
  }

  /** A window is open, the battle is paused or an ad shows. */
  blocked(): boolean {
    return this.modals.current() !== null || (this.session?.paused ?? true) || this.p.ads.showing();
  }

  /** INP-01, INP-02: the player plays a card; it lands at the start of the next tick (SIM-10). */
  private playCard(card: CardId, x: number, y: number): void {
    const s = this.session;
    if (!s || s.paused) return;
    s.queue({ type: 'play', side: 0, card, x, y });
    this.hud.info(null);
  }

  private onTick(events: readonly BattleEvent[], state: BattleState): void {
    const a = this.p.audio;
    for (const e of events) {
      switch (e.type) {
        // FX-06: the sounds of the battle.
        case 'placed':
          a.play('place');
          break;
        case 'stacked':
          a.play('stack', scalePitch(e.stars - 1));
          break;
        case 'spell':
          a.play('spell');
          break;
        case 'shot':
          a.play(e.projectile);
          break;
        case 'destroyed':
          a.play('destroy');
          break;
        case 'invalid':
          if (e.side === 0) a.play('invalid');
          break;
        case 'crown':
          a.play('crown');
          this.hud.crownPop(e.side);
          break;
        // FX-05, TUT-04: double elixir and the deciding minute — and «New» the first time.
        case 'doubleElixir':
          this.hud.showBanner(this.i18n.t('battle.double'));
          this.firstTime('double');
          break;
        case 'overtime':
          this.hud.showBanner(this.i18n.t('battle.overtime'));
          this.firstTime('overtime');
          break;
        case 'ended': {
          this.input.cancel();
          if (this.tutorial) break;
          a.play(e.result.winner === 0 ? 'win' : 'lose');
          // The player's own surrender comes from a window: its result follows at once.
          if (e.result.reason === 'surrender' && this.modals.current()) this.showResult();
          else this.endLater(() => this.showResult());
          break;
        }
        default:
          break;
      }
    }
    this.hud.update(state);
    this.hand.update(state);
    if (this.input.current() >= 0 && state.tick % 4 === 0) this.input.refresh();
    this.tutorial?.tick(events, state);
  }

  /**
   * TUT-04: a «New» card the first time the player meets a mechanic. It is a window: the battle
   * waits while the player reads it.
   */
  private firstTime(what: string): void {
    const key = `new:${what}`;
    if (this.p.progress.seen(key) || this.tutorial) return;
    this.p.progress.markSeen(key);
    this.halt();
    this.modals.open({
      ui: 'new-card',
      title: this.i18n.t('new.title'),
      text: this.i18n.t(`new.${what}`),
      buttons: [
        { ui: 'new-ok', label: this.i18n.t('new.ok'), primary: true, onClick: () => this.resume() },
      ],
    });
  }

  private endLater(show: () => void): void {
    window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(show, END_DELAY_MS);
  }

  // -------------------------------------------------------------------------------------------
  // Pause (UI-08, YG-04, YG-05, UI-15)

  /** The player's pause: button, Escape or KeyP. */
  pause(): void {
    const s = this.session;
    if (!s || s.state.phase === 'ended' || this.modals.current() || this.p.ads.showing()) return;
    this.halt();
    this.openPause();
  }

  /** The player left (tab, focus, SDK pause, resize): the battle stops and Pause opens. */
  interrupt(): void {
    const s = this.session;
    if (!s || this.p.ads.showing()) return;
    if (s.state.phase === 'ended' || this.modals.current()) {
      s.paused = true;
      return;
    }
    this.pause();
  }

  /**
   * YG-04, YG-05: the player is still away after an ad — the tab is hidden, the focus stayed
   * outside the game (in the platform page where the ad was), or the platform paused it. Then the
   * battle does not start on its own: one extra Pause is safer than a battle running while the
   * GameplayAPI is stopped and the sound is off (found by the moderator check of game 2).
   */
  private away(): boolean {
    return this.p.audio.silenceReasons().some((r) => r !== 'ad');
  }

  private halt(): void {
    const s = this.session;
    this.input.cancel();
    if (!s) return;
    s.paused = true;
    s.clearPending();
  }

  resume(): void {
    this.modals.close();
    if (this.session) this.session.paused = false;
  }

  private openPause(): void {
    this.modals.open({
      ui: 'pause',
      title: this.i18n.t('pause.title'),
      buttons: [
        {
          ui: 'pause-continue',
          label: this.i18n.t('pause.continue'),
          primary: true,
          onClick: () => this.resume(),
        },
        {
          ui: 'pause-settings',
          label: this.i18n.t('pause.settings'),
          onClick: () => this.openSettings(true),
        },
        {
          ui: 'pause-surrender',
          label: this.i18n.t('pause.surrender'),
          onClick: () => this.confirmSurrender(),
        },
      ],
    });
  }

  /** UI-08: surrender is a loss with its trophies — asked in a game window, never by a browser dialog. */
  private confirmSurrender(): void {
    this.modals.open({
      ui: 'surrender',
      title: this.i18n.t('surrender.title'),
      text: this.i18n.t('surrender.text'),
      buttons: [
        {
          ui: 'surrender-yes',
          label: this.i18n.t('surrender.yes'),
          onClick: () => {
            // The result window replaces this one: no GameplayAPI start/stop pair in between.
            const s = this.session;
            if (!s) return;
            s.queue({ type: 'surrender', side: 0 });
            s.tick();
          },
        },
        {
          ui: 'surrender-no',
          label: this.i18n.t('surrender.no'),
          primary: true,
          onClick: () => this.openPause(),
        },
      ],
    });
  }

  // -------------------------------------------------------------------------------------------
  // Settings (UI-06, UI-07)

  private openSettings(inBattle: boolean): void {
    const t = this.i18n;
    const pr = this.p.progress;
    const box = el('div', 'settings');
    const row = (label: string, control: HTMLElement, hint?: string): void => {
      const r = el('div', 'settings-row');
      const text = el('div', 'settings-text');
      const l = el('div', 'settings-label');
      l.textContent = label;
      text.appendChild(l);
      if (hint) {
        const h = el('div', 'settings-hint');
        h.textContent = hint;
        text.appendChild(h);
      }
      r.append(text, control);
      box.appendChild(r);
    };
    const sound = el('button', `switch${pr.data.settings.sound ? ' on' : ''}`);
    sound.type = 'button';
    sound.dataset.ui = 'settings-sound';
    sound.textContent = t.t(pr.data.settings.sound ? 'settings.on' : 'settings.off');
    sound.addEventListener('click', () => {
      pr.setSettings({ sound: !pr.data.settings.sound });
      this.p.audio.setEnabled(pr.data.settings.sound);
      this.openSettings(inBattle);
    });
    row(t.t('settings.sound'), sound);
    // UI-07, YG-06: languages by their own names; the choice beats the platform's language.
    const langs = el('div', 'settings-row settings-langs');
    for (const code of supportedLangs) {
      const b = el('button', `lang${code === t.lang ? ' on' : ''}`);
      b.type = 'button';
      b.dataset.ui = `settings-lang-${code}`;
      b.textContent = dictionaries[code]?.['lang.name'] ?? code;
      b.addEventListener('click', () => {
        pr.setSettings({ lang: code });
        this.setLang(code);
        this.openSettings(inBattle);
      });
      langs.appendChild(b);
    }
    box.appendChild(langs);
    if (!this.p.platform.isAuthorized()) {
      // YG-09: sign-in only by a button that says what it gives.
      const login = el('button', 'settings-action');
      login.type = 'button';
      login.dataset.ui = 'settings-login';
      login.textContent = t.t('auth.login');
      login.addEventListener(
        'click',
        () => void this.meta.login(() => this.openSettings(inBattle)),
      );
      row(t.t('auth.title'), login, t.t('auth.benefit'));
    }
    if (this.p.shop.enabled && !pr.data.noAds) {
      const shop = el('button', 'settings-action');
      shop.type = 'button';
      shop.dataset.ui = 'settings-shop';
      shop.textContent = t.t('menu.shop');
      shop.addEventListener('click', () => this.meta.openShop(() => this.openSettings(inBattle)));
      row(t.t('settings.noAds'), shop);
    }
    const version = el('div', 'settings-version');
    version.textContent = t.t('settings.version', { v: APP_VERSION });
    box.appendChild(version);
    this.modals.open({
      ui: 'settings',
      title: t.t('settings.title'),
      content: box,
      buttons: [
        {
          ui: 'settings-close',
          label: t.t('common.done'),
          primary: true,
          onClick: () => (inBattle ? this.openPause() : this.modals.close()),
        },
      ],
    });
  }

  private setLang(code: string): void {
    this.i18n = new I18n(dictionaries, code);
    document.documentElement.lang = code;
    document.title = this.i18n.t('game.title');
    this.hud.applyTexts(this.i18n);
    this.menu.applyTexts(this.i18n);
    this.hand.applyTexts(this.i18n);
    if (this.session) this.hand.update(this.session.state);
    if (this.opponent?.kind === 'bot') {
      this.opponent = { ...this.opponent, name: this.i18n.t(`bot.name.${String(this.botName)}`) };
      this.hud.setOpponent(this.opponent);
    }
    if (this.session) this.hud.update(this.session.state);
  }

  // -------------------------------------------------------------------------------------------
  // The battle result (WIN-05)

  private showResult(): void {
    const s = this.session;
    const result = s?.state.result;
    if (!s || !result) return;
    const pr = this.p.progress;
    const won = result.winner === 0;
    const draw = result.winner === null;
    // ECO-02: a win gives 20 + 5 × arena gold, a loss 5. Saved at once: the player may close the
    // game from this window (YG-08).
    const gold = won ? 20 + 5 * pr.data.player.arena : LOSS_GOLD;
    pr.recordBattle({ won, draw, gold });
    // YG-16: after the 5th win the review is asked, once.
    if (won && pr.wins() === config.reviewAfterWins) void this.meta.askReview();
    let doubled = false;
    const open = (): void => {
      const box = el('div', 'complete');
      const crowns = el('div', 'complete-coins', ICONS.crown);
      crowns.dataset.ui = 'result-crowns';
      const c = el('span');
      c.textContent = `${String(s.state.crowns[0])} : ${String(s.state.crowns[1])}`;
      crowns.appendChild(c);
      const coins = el('div', 'complete-coins', ICONS.coin);
      coins.dataset.ui = 'result-gold';
      const n = el('span');
      n.textContent = `+${String(doubled ? gold * 2 : gold)}`;
      coins.appendChild(n);
      box.append(crowns, coins);
      const title = won ? 'result.win' : draw ? 'result.draw' : 'result.loss';
      this.modals.open({
        ui: 'battle-result',
        title: this.i18n.t(title),
        text: this.i18n.t(`result.reason.${result.reason}`),
        content: box,
        buttons: [
          // YG-11: the same gold once more, for a video — the button says so (once a battle).
          ...(!doubled
            ? [
                {
                  ui: 'result-double',
                  label: this.i18n.t('result.double'),
                  video: true,
                  onClick: () => {
                    void this.p.ads.rewarded().then((ok) => {
                      if (!ok || doubled || this.session !== s) return;
                      doubled = true;
                      pr.addGold(gold);
                      this.p.audio.play('coin');
                      open();
                    });
                  },
                },
              ]
            : []),
          {
            ui: 'result-menu',
            label: this.i18n.t('result.menu'),
            primary: true,
            onClick: () => void this.afterResult(() => this.showMenu(), doubled),
          },
        ],
      });
    };
    open();
  }

  /**
   * YG-10: "To menu" may show a fullscreen ad first (from adsFromBattle on, at most once in
   * 180 s, never with "No ads"); the menu comes after it is closed. Not right after the player
   * watched a video in this window: two ads in a row (req. 4.4).
   */
  private async afterResult(go: () => void, watchedVideo = false): Promise<void> {
    if (this.p.ads.showing()) return;
    if (!watchedVideo && this.p.ads.interstitialDue()) await this.p.ads.interstitial();
    go();
    // YG-04: the player left during the ad — what opens next waits on its Pause window.
    if (this.away()) this.interrupt();
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard (INP-05): KeyboardEvent.code only, browser shortcuts are left alone

  private key(e: KeyboardEvent): void {
    // A held key repeats: one press is one action.
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    // INP-05: Digit1–Digit4 choose a card of the hand.
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (digit && this.session && !this.modals.current()) {
      this.input.choose(Number(digit[1]) - 1);
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      // Escape first lets the chosen card go, then pauses.
      if (e.code === 'Escape' && !this.modals.current() && this.input.cancel()) return;
      if (this.modals.current() === 'pause') this.resume();
      else this.pause();
    }
  }

  // -------------------------------------------------------------------------------------------
  // Layout (UI-15)

  /** The active area changed; the interface follows and the battle pauses. */
  stageResized(w: number, h: number): void {
    const changed = this.size.w !== 0 && (this.size.w !== w || this.size.h !== h);
    // YG-20: the first touch turns fullscreen on (ours or the platform's) and the window grows
    // under the player's finger — that is not leaving the game, so no Pause for it.
    const now = performance.now();
    const fullscreen =
      (now - this.firstTouchAt < 1500 && this.size.w === w) || now - this.fullscreenAt < 1500;
    this.size = { w, h };
    this.hud.applyLayout(computeLayout(w, h));
    if (changed && !fullscreen) this.interrupt();
  }

  // -------------------------------------------------------------------------------------------
  // The platform

  /** YG-09: another account's progress was chosen: the menu shows it. */
  accountChanged(): void {
    this.showMenu();
  }
}
