/**
 * DEV-02: window.__game for tests and promo capture; DEV-03: the ?dev=1 panel. Loaded only in
 * dev and e2e builds (`__DEV_HOOKS__`), so the release bundle has none of it (check:build).
 * Developer texts here are not game texts (no i18n).
 */

import type Phaser from 'phaser';
import type { App } from './app';
import type { FieldScene } from './game/FieldScene';
import type { LocalPlatform } from './platform/LocalPlatform';
import type { Platform } from './platform/Platform';
import type { AudioService, Sfx } from './services/audio';
import type { GameplayState } from './services/gameplay-state';
import type { ProgressService } from './services/progress';
import type { SaveData } from './services/SaveData';
import { cloneState, type Action, type BattleSetup, type BattleState, type Side } from './sim';

export interface UiRect {
  ui: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface DevState {
  screen: 'menu' | 'battle';
  phase: string | null;
  winner: Side | null | undefined;
  tick: number;
  elixir: number;
  paused: boolean;
  timeStopped: boolean;
  window: string | null;
  audible: boolean;
  silenced: string[];
  playing: boolean;
  opponent: string | null;
  field: { cell: number } | null;
}

export interface DevHooks {
  platform: Platform;
  game: Phaser.Game;
  isReady(): boolean;
  /** PERF-03: Phaser draws frames (false in the menu, where the field is hidden). */
  rendering(): boolean;
  state(): DevState;
  sim(): BattleState | null;
  act(actions: Action[]): void;
  /** Runs ticks right now, also while the clock is stopped. */
  tick(n?: number): void;
  stopTime(): void;
  resumeTime(): void;
  setSpeed(x: number): void;
  openBattle(setup?: BattleSetup): void;
  /** Ends the battle at once: the loser surrenders (a real action, UI-08). */
  finish(winner: Side): void;
  cellClient(x: number, y: number): { x: number; y: number };
  debugUI(): UiRect[];
  played(): Sfx[];
  calls(): string[];
  /** The saved progress (a copy). */
  save(): SaveData;
  grant(gold: number): void;
  menu(): void;
  /** YG-12: the sticky banner is on (LocalPlatform). */
  banner(): boolean;
  /** YG-10: the server clock jumps forward (LocalPlatform). */
  advanceTime(ms: number): void;
  /** YG-04: the platform pauses and resumes the game (LocalPlatform). */
  sdkPause(): void;
  sdkResume(): void;
  /** YG-09: the account selection dialog closed with this cloud save (LocalPlatform). */
  account(save: Partial<SaveData> | null): void;
  /**
   * §9 video: the Phaser loop sleeps and the game moves only by stepFrame(ms) — every captured
   * frame is exact (no dropped frames, no recorder lag, no grey borders).
   */
  frameMode(on: boolean): void;
  stepFrame(ms: number): void;
}

declare global {
  interface Window {
    __game?: DevHooks;
  }
}

export interface DevDeps {
  app: App;
  platform: Platform;
  game: Phaser.Game;
  scene: FieldScene;
  audio: AudioService;
  gameplay: GameplayState;
  progress: ProgressService;
  local: LocalPlatform | null;
  stage: HTMLElement;
  isReady(): boolean;
  setFrameMode(on: boolean): void;
}

export function installDevHooks(d: DevDeps): void {
  const { app, scene } = d;
  let frameTime = 0;
  const toClient = (p: { x: number; y: number }): { x: number; y: number } => {
    const r = d.stage.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  };
  window.__game = {
    platform: d.platform,
    game: d.game,
    isReady: d.isReady,
    rendering: () => d.game.loop.running,
    state: () => {
      const s = app.session?.state;
      const l = scene.getLayout();
      return {
        screen: app.session ? 'battle' : 'menu',
        phase: s?.phase ?? null,
        winner: s?.result?.winner,
        tick: s?.tick ?? 0,
        elixir: s?.elixir[0] ?? 0,
        paused: app.session?.paused ?? false,
        timeStopped: app.session?.timeStopped ?? false,
        window: app.modals.current(),
        audible: d.audio.audible(),
        silenced: d.audio.silenceReasons(),
        playing: d.gameplay.isPlaying(),
        opponent: app.opponent?.kind ?? null,
        field: s ? { cell: l.cell } : null,
      };
    },
    sim: () => (app.session ? cloneState(app.session.state) : null),
    act: (actions) => app.session?.queue(...actions),
    tick: (n = 1) => {
      for (let i = 0; i < n; i++) app.session?.tick();
    },
    stopTime: () => {
      if (app.session) app.session.timeStopped = true;
    },
    resumeTime: () => {
      if (app.session) app.session.timeStopped = false;
    },
    setSpeed: (x) => {
      if (app.session) app.session.speed = x;
    },
    openBattle: (setup) => app.startBattle(setup),
    finish: (winner) => {
      const s = app.session;
      if (!s) return;
      s.queue({ type: 'surrender', side: winner === 0 ? 1 : 0 });
      s.tick();
    },
    cellClient: (x, y) => toClient(scene.cellCenter(x, y)),
    debugUI: () =>
      Array.from(document.querySelectorAll<HTMLElement>('#ui [data-ui]')).map((e) => {
        const r = e.getBoundingClientRect();
        return {
          ui: e.dataset.ui ?? '',
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          visible: e.offsetParent !== null && !e.closest('[hidden]'),
        };
      }),
    played: () => [...d.audio.played],
    calls: () => [...((d.platform as Partial<LocalPlatform>).calls ?? [])],
    save: () => JSON.parse(JSON.stringify(d.progress.data)) as SaveData,
    grant: (gold) => {
      d.progress.addGold(gold);
      app.renderMenu();
    },
    menu: () => app.showMenu(),
    banner: () => d.local?.stickyVisible ?? false,
    advanceTime: (ms) => d.local?.advanceTime(ms),
    sdkPause: () => d.local?.emitPause(),
    sdkResume: () => d.local?.emitResume(),
    account: (save) =>
      d.local?.emitAccountChange(save ? ({ v: 1, updatedAt: 1, ...save } as SaveData) : null),
    frameMode: (on) => {
      frameTime = d.game.loop.time;
      d.setFrameMode(on);
    },
    stepFrame: (ms) => {
      frameTime += ms;
      d.game.step(frameTime, ms);
    },
  };
  if (new URLSearchParams(window.location.search).get('dev') === '1') mountPanel(app);
}

/** DEV-03: a battle, a quick end and gold. Zones, radii and records join in Stages 1–3. */
function mountPanel(app: App): void {
  const panel = document.createElement('div');
  panel.className = 'dev-panel';
  const add = (label: string, onClick: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    panel.appendChild(b);
  };
  add('battle', () => app.startBattle());
  add('win', () => window.__game?.finish(0));
  add('lose', () => window.__game?.finish(1));
  add('x8', () => window.__game?.setSpeed(8));
  add('+1000', () => window.__game?.grant(1000));
  document.body.appendChild(panel);
}
