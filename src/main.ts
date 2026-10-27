import { App } from './app';
import { config } from './config';
import { shopProducts } from './content';
import { createGame, resizeGame } from './game/createGame';
import { dictionaries, supportedLangs } from './i18n';
import { createPlatform } from './platform';
import { AdService } from './services/ads';
import { AudioService } from './services/audio';
import { GameplayState } from './services/gameplay-state';
import { I18n, resolveLang } from './services/I18n';
import { LeaderboardService } from './services/leaderboard';
import { Lifecycle } from './services/lifecycle';
import { ProgressService } from './services/progress';
import { SaveService } from './services/save';
import { ShopService } from './services/shop';
import { LoadingScreen } from './ui/loading';
import { installInputGuards, Stage } from './ui/stage';
// TECH-02: Nunito (OFL), bundled — Cyrillic and Latin (add latin-ext for Turkish and the like).
import '@fontsource/nunito/cyrillic-700.css';
import '@fontsource/nunito/cyrillic-800.css';
import '@fontsource/nunito/cyrillic-900.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import './ui/styles.css';

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing in index.html`);
  return node;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  installInputGuards();
  const loading = new LoadingScreen();

  // YG-14: purchases behind the flag; dev and e2e builds may turn them on with ?iap=1.
  const iap =
    config.features.iap ||
    (__DEV_HOOKS__ && new URLSearchParams(window.location.search).get('iap') === '1');
  const { platform, local } = await createPlatform(iap);
  await platform.init();
  loading.progress(0.3);

  // YG-07: the fresher of the local and the cloud copy.
  const save = new SaveService(platform, storage());
  await save.load();
  const progress = new ProgressService(save);
  loading.progress(0.5);

  // YG-06: the language the player chose wins over the platform's.
  const lang = resolveLang(save.data.settings.lang ?? platform.lang(), supportedLangs);
  const i18n = new I18n(dictionaries, lang);
  document.documentElement.lang = i18n.lang;
  document.title = i18n.t('game.title');

  const audio = new AudioService();
  // SND-03: sound starts after the first touch or key, wherever it lands.
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => audio.unlock(), { capture: true, once: true });
  }
  // SND-02: the ambience plays exactly while the gameplay does (the GameplayAPI.start condition).
  const gameplay = new GameplayState(platform, (on) => audio.setAmbience(on));
  // YG-20: on a phone, fullscreen on the first touch if the platform did not turn it on.
  window.addEventListener('pointerdown', () => platform.requestFullscreen(), {
    capture: true,
    once: true,
  });
  // The lifecycle needs the app (it pauses the level); ads need the lifecycle to go silent.
  let lifecycleRef: Lifecycle | null = null;
  const ads = new AdService(platform, { setAd: (on) => lifecycleRef?.setAd(on) }, progress);
  const boards = new LeaderboardService(platform);
  const shop = new ShopService(platform, progress, shopProducts, iap, () => ads.refreshBanner());
  const stageEl = byId('stage');
  const stage = new Stage(byId('viewport'), stageEl, platform.isDesktop());

  // PERF-03: between battles the field is hidden and Phaser sleeps (no frames, no battery); it
  // wakes when a battle shows the field. Only after the first frame (YG-02 waits for it).
  const fieldHost = byId('canvas-host');
  let frameMode = false;
  const syncLoop = (): void => {
    if (!ready || frameMode) return;
    if (fieldHost.hidden) {
      game.loop.sleep();
    } else if (!game.loop.running) {
      // No catch-up for the time asleep: the battle starts from where it stands.
      game.loop.resetDelta();
      game.loop.wake();
    }
  };
  new MutationObserver(syncLoop).observe(fieldHost, {
    attributes: true,
    attributeFilter: ['hidden'],
  });

  // YG-02: LoadingAPI.ready() exactly once, when the first interactive screen is drawn.
  let ready = false;
  const { game, scene } = createGame(fieldHost, () => {
    if (ready) return;
    ready = true;
    loading.done();
    platform.gameReady();
    gameplay.setReady();
    syncLoop();
  });
  const app = new App({
    platform,
    audio,
    gameplay,
    scene,
    progress,
    ads,
    boards,
    shop,
    i18n,
    ui: byId('ui'),
    stage: stageEl,
    field: fieldHost,
  });
  const lifecycle = new Lifecycle(audio, gameplay, () => app.interrupt());
  lifecycle.attach(platform);
  lifecycleRef = lifecycle;
  // YG-09: after the account selection dialog the chosen progress is read and the menu opens.
  platform.onAccountChange(() => {
    void save.reloadFromCloud().then(() => {
      boards.reset();
      app.accountChanged();
    });
  });
  // YG-14, 1.13.1: purchases the game has not applied yet, at every launch.
  void shop.init().then(() => app.renderMenu());
  // YG-08: what the cloud has not got yet goes when the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save.flush();
  });
  window.addEventListener('pagehide', () => save.flush());

  stage.onResize((w, h) => {
    resizeGame(game, scene, w, h);
    app.stageResized(w, h);
  });
  stage.fit();
  loading.progress(0.7);

  // DEV-02: ?battle=1 opens a battle at once in dev and e2e builds.
  app.boot(__DEV_HOOKS__ && new URLSearchParams(window.location.search).get('battle') === '1');

  if (__DEV_HOOKS__) {
    const { installDevHooks } = await import('./dev');
    installDevHooks({
      app,
      platform,
      game,
      scene,
      audio,
      gameplay,
      progress,
      local,
      stage: stageEl,
      isReady: () => ready,
      setFrameMode: (on) => {
        frameMode = on;
        if (on) game.loop.sleep();
        else syncLoop();
      },
    });
  }
}

void main();
