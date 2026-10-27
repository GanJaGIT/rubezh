/**
 * ST-01: the async multiplayer probe — a separate tiny page, not the game. It answers the YG-24
 * questions on the real platform: whether recording and loading need sign-in, whether the
 * player's own record comes back, how fast a record appears, whether init can be called
 * several times, and what happens to commit/push without init. The owner runs it in a draft of
 * its own and sends screenshots (ST-02, START.md). Texts are for the owner, in Russian.
 */

interface SpikeSession {
  id: string;
  meta: Record<string, number>;
  player: { name: string; avatar: string };
  timeline: { id: string; payload: unknown; time: number }[];
}

interface SpikeSdk {
  serverTime(): number;
  environment: { i18n: { lang: string }; app?: { id?: string } };
  features: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  getPlayer(): Promise<{
    isAuthorized(): boolean;
    getName(): string;
    getUniqueID(): string;
  }>;
  auth: { openAuthDialog(): Promise<void> };
  multiplayer?: {
    sessions?: {
      init(opts: Record<string, unknown>): Promise<SpikeSession[]>;
      commit(payload: Record<string, unknown>): void;
      push(meta: Record<string, number>): Promise<void> | void;
    };
  };
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const logBox = $('log');
const statusBox = $('status');
const resultBox = $('result');
const started = performance.now();
let sdk: SpikeSdk | null = null;
let initCalls = 0;
let records = 0;

function stamp(): string {
  const t = ((performance.now() - started) / 1000).toFixed(1).padStart(6, ' ');
  const server = sdk ? new Date(sdk.serverTime()).toISOString().slice(11, 19) : '--:--:--';
  return `[${t} с | ${server} UTC]`;
}

function log(text: string, error = false): void {
  const line = document.createElement('div');
  if (error) line.className = 'err';
  line.textContent = `${stamp()} ${text}`;
  logBox.prepend(line);
}

const describe = (e: unknown): string =>
  e instanceof Error ? `${e.name}: ${e.message}` : (JSON.stringify(e) ?? String(e));

window.addEventListener('error', (e) => log(`Ошибка страницы: ${e.message}`, true));
window.addEventListener('unhandledrejection', (e) =>
  log(`Необработанная ошибка: ${describe(e.reason)}`, true),
);

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const num = (id: string, fallback: number): number => {
  const v = Number($<HTMLInputElement>(id).value);
  return Number.isFinite(v) ? Math.round(v) : fallback;
};

async function showPlayer(): Promise<void> {
  if (!sdk) return;
  try {
    const p = await sdk.getPlayer();
    const id = p.getUniqueID();
    statusBox.textContent = [
      `SDK загружен. Язык: ${sdk.environment.i18n.lang}. App ID: ${sdk.environment.app?.id ?? '?'}`,
      `Игрок: ${p.isAuthorized() ? 'вошёл' : 'НЕ вошёл'}; имя: «${p.getName() || '—'}»; id: ${id ? `${id.slice(0, 6)}…` : '—'}`,
      `Модуль multiplayer.sessions: ${sdk.multiplayer?.sessions ? 'есть' : 'НЕТ'}`,
      `Записей сделано в этой вкладке: ${String(records)}; вызовов init: ${String(initCalls)}`,
    ].join('\n');
  } catch (e) {
    statusBox.textContent = `SDK загружен, но getPlayer() не сработал: ${describe(e)}`;
    log(`getPlayer: ${describe(e)}`, true);
  }
}

function sessions(): NonNullable<NonNullable<SpikeSdk['multiplayer']>['sessions']> | null {
  const s = sdk?.multiplayer?.sessions ?? null;
  if (!s) log('Нет ysdk.multiplayer.sessions', true);
  return s;
}

/** YG-21: five test events with pauses, a GameplayAPI pause in the middle, then push. */
async function record(): Promise<void> {
  const s = sessions();
  if (!s || !sdk) return;
  const meta1 = num('meta1', 500);
  const skipInit = $<HTMLInputElement>('noinit').checked;
  setBusy(true);
  try {
    if (skipInit) {
      log('Запись БЕЗ init (проверка: работает ли commit/push без init)');
    } else {
      initCalls++;
      log('init({ count: 0, isEventBased: false }) — только запись…');
      const got = await s.init({ count: 0, isEventBased: false });
      log(`init для записи вернул: ${JSON.stringify(got)}`);
    }
    sdk.features.GameplayAPI?.start();
    log('GameplayAPI.start()');
    for (let i = 1; i <= 5; i++) {
      await wait(1000);
      const payload = { k: 'p', c: 'cannon', x: i, y: 7, n: i };
      s.commit(payload);
      log(`commit #${String(i)}: ${JSON.stringify(payload)}`);
      if (i === 3) {
        // The SDK says time excludes pauses: 3 s of stop() here should not show in the times.
        sdk.features.GameplayAPI?.stop();
        log('GameplayAPI.stop() на 3 секунды (проверка поправки на паузы)');
        await wait(3000);
        sdk.features.GameplayAPI?.start();
        log('GameplayAPI.start()');
      }
    }
    sdk.features.GameplayAPI?.stop();
    log('GameplayAPI.stop()');
    const meta = { meta1, meta2: 1, meta3: 1 };
    await s.push(meta);
    records++;
    log(`push(${JSON.stringify(meta)}) — УСПЕХ. Запись отправлена.`);
  } catch (e) {
    log(`Запись не удалась: ${describe(e)}`, true);
  } finally {
    setBusy(false);
    void showPlayer();
  }
}

/** YG-21, YG-24: load records by the meta1 range and show the whole answer. */
async function load(): Promise<void> {
  const s = sessions();
  if (!s) return;
  const min = num('min', 0);
  const max = num('max', 100000);
  setBusy(true);
  initCalls++;
  const opts = { count: 10, isEventBased: false, meta: { meta1: { min, max } } };
  log(`init(${JSON.stringify(opts)}) — вызов №${String(initCalls)}…`);
  const t0 = performance.now();
  try {
    const got = await s.init(opts);
    const ms = Math.round(performance.now() - t0);
    const list = Array.isArray(got) ? got : [];
    log(`init ответил за ${String(ms)} мс: записей ${String(list.length)}`);
    const lines = list.map((r, i) => {
      const times = r.timeline.map((e) => e.time).join(', ');
      return [
        `#${String(i + 1)} id=${r.id}`,
        `   meta=${JSON.stringify(r.meta)}`,
        `   игрок: «${r.player.name || '—'}», аватар: ${r.player.avatar ? 'есть' : 'нет'}`,
        `   событий: ${String(r.timeline.length)}; время, мс: ${times}`,
      ].join('\n');
    });
    resultBox.textContent =
      `Записей: ${String(list.length)} (init №${String(initCalls)}, ${String(ms)} мс)\n\n` +
      (lines.join('\n\n') || 'Пусто') +
      `\n\nПолный ответ:\n${JSON.stringify(got, null, 1)}`;
  } catch (e) {
    log(`init не удался: ${describe(e)}`, true);
    resultBox.textContent = `Ошибка: ${describe(e)}`;
  } finally {
    setBusy(false);
    void showPlayer();
  }
}

async function auth(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.auth.openAuthDialog();
    log('Вход выполнен');
  } catch (e) {
    log(`Вход не выполнен: ${describe(e)}`, true);
  }
  void showPlayer();
}

function setBusy(on: boolean): void {
  for (const id of ['record', 'load', 'auth']) $<HTMLButtonElement>(id).disabled = on || !sdk;
}

async function main(): Promise<void> {
  $('record').addEventListener('click', () => void record());
  $('load').addEventListener('click', () => void load());
  $('auth').addEventListener('click', () => void auth());
  $('clear').addEventListener('click', () => logBox.replaceChildren());
  const ya = (window as { YaGames?: { init(): Promise<SpikeSdk> } }).YaGames;
  if (!ya) {
    statusBox.textContent =
      'SDK не найден: пробник работает только в черновике Яндекс Игр (или под sdk-dev-proxy).';
    log('window.YaGames отсутствует', true);
    return;
  }
  try {
    sdk = await ya.init();
    log('YaGames.init() — OK');
    sdk.features.LoadingAPI?.ready();
    log('LoadingAPI.ready()');
  } catch (e) {
    statusBox.textContent = `YaGames.init() не удался: ${describe(e)}`;
    log(`YaGames.init: ${describe(e)}`, true);
    return;
  }
  setBusy(false);
  await showPlayer();
}

void main();
