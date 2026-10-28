import { describe, expect, it } from 'vitest';
import { BattleSession } from '../../src/game/session';
import type { Platform } from '../../src/platform/Platform';
import { AudioService, scalePitch } from '../../src/services/audio';
import { GameplayState } from '../../src/services/gameplay-state';
import { ProgressService } from '../../src/services/progress';
import {
  defaultSave,
  MAX_SAVE_BYTES,
  migrate,
  saveSize,
  SaveService,
} from '../../src/services/save';
import { STARTER_DECK } from '../../src/content';
import type { SaveData } from '../../src/services/SaveData';
import { CARD_IDS, type BattleSetup } from '../../src/sim';

function fakePlatform(): { platform: Platform; calls: string[] } {
  const calls: string[] = [];
  const platform = {
    gameplayStart: () => calls.push('start'),
    gameplayStop: () => calls.push('stop'),
  } as unknown as Platform;
  return { platform, calls };
}

const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r));
const setup = (): BattleSetup => ({ seed: 7, decks: [[], []], playerLevels: [1, 1] });

describe('GameplayState (YG-03)', () => {
  it('starts in a level without windows, stops for windows and suspension, never twice in a row', async () => {
    const { platform, calls } = fakePlatform();
    const g = new GameplayState(platform);
    g.setReady();
    g.setInBattle(true);
    await flush();
    expect(calls).toEqual(['start']);
    g.windowOpened();
    g.windowOpened();
    g.windowClosed();
    await flush();
    expect(calls).toEqual(['start', 'stop']);
    g.windowClosed();
    await flush();
    expect(calls).toEqual(['start', 'stop', 'start']);
    g.setSuspended(true);
    g.setSuspended(true);
    expect(calls).toEqual(['start', 'stop', 'start', 'stop']);
    expect(g.isPlaying()).toBe(false);
  });

  it('SND-02: the ambience follows the gameplay', async () => {
    const { platform } = fakePlatform();
    const audio = new AudioService();
    const g = new GameplayState(platform, (on) => audio.setAmbience(on));
    g.setReady();
    g.setInBattle(true);
    await flush();
    expect(audio.ambienceOn()).toBe(true);
    g.windowOpened();
    expect(audio.ambienceOn()).toBe(false);
    g.windowClosed();
    await flush();
    expect(audio.ambienceOn()).toBe(true);
    g.setInBattle(false);
    expect(audio.ambienceOn()).toBe(false);
  });

  it('closing one window and opening another in one go sends nothing (п. 1.19.3)', async () => {
    const { platform, calls } = fakePlatform();
    const g = new GameplayState(platform);
    g.setReady();
    g.setInBattle(true);
    g.windowOpened();
    await flush();
    expect(calls).toEqual([]);
    g.windowClosed();
    g.windowOpened();
    await flush();
    expect(calls).toEqual([]);
  });

  it('YG-02: nothing goes before LoadingAPI.ready(); then the state is sent', async () => {
    const { platform, calls } = fakePlatform();
    const g = new GameplayState(platform);
    g.setInBattle(true);
    g.windowOpened();
    g.windowClosed();
    await flush();
    expect(calls).toEqual([]);
    g.setReady();
    await flush();
    expect(calls).toEqual(['start']);
  });

  it('survives platform errors (§5.1)', async () => {
    const g = new GameplayState({
      gameplayStart: () => {
        throw new Error('sdk');
      },
      gameplayStop: () => undefined,
    } as unknown as Platform);
    g.setReady();
    g.setInBattle(true);
    await flush();
    expect(g.isPlaying()).toBe(true);
  });
});

describe('AudioService (YG-05, FX-06)', () => {
  it('is silent while any reason is active or the player turned sound off', () => {
    const a = new AudioService();
    expect(a.audible()).toBe(true);
    a.setSilenced('blur', true);
    a.setSilenced('hidden', true);
    a.setSilenced('blur', false);
    expect(a.audible()).toBe(false);
    expect(a.silenceReasons()).toEqual(['hidden']);
    a.play('hit');
    expect(a.played).toEqual([]);
    a.setSilenced('hidden', false);
    a.setEnabled(false);
    expect(a.audible()).toBe(false);
    a.setEnabled(true);
    a.play('hit');
    expect(a.played).toEqual(['hit']);
  });

  it('SND-01: a run climbs a pentatonic scale', () => {
    const steps = [0, 1, 2, 3, 4, 5].map((n) => Math.round(12 * Math.log2(scalePitch(n))));
    expect(steps).toEqual([0, 2, 4, 7, 9, 12]);
    expect(scalePitch(99)).toBe(scalePitch(10));
  });

  it('FX-06: at most 8 sounds a second; the same shot again at once merges with the first', () => {
    const a = new AudioService();
    for (let i = 0; i < 5; i++) a.play('arrow');
    expect(a.played).toEqual(['arrow']);
    const kinds = [
      'ball',
      'stone',
      'bolt',
      'shard',
      'hit',
      'place',
      'stack',
      'crown',
      'tap',
    ] as const;
    for (const k of kinds) a.play(k);
    expect(a.played).toHaveLength(8);
  });
});

describe('BattleSession clock (SIM-02)', () => {
  it('turns real time into whole 50 ms ticks', () => {
    const s = new BattleSession(setup());
    s.advance(125);
    expect(s.state.tick).toBe(2);
    expect(s.tickProgress()).toBeCloseTo(0.5);
    s.advance(25);
    expect(s.state.tick).toBe(3);
  });

  it('runs at most 6 ticks after a long frame and drops the rest (no catch-up)', () => {
    const s = new BattleSession(setup());
    s.advance(2000);
    expect(s.state.tick).toBe(6);
    expect(s.tickProgress()).toBe(0);
  });

  it('SIM-03: stands still while paused or stopped', () => {
    const s = new BattleSession(setup());
    s.paused = true;
    s.advance(1000);
    s.paused = false;
    s.timeStopped = true;
    s.advance(1000);
    expect(s.state.tick).toBe(0);
    expect(s.tickProgress()).toBe(0);
    s.tick();
    expect(s.state.tick).toBe(1);
  });

  it('SIM-10: applies queued actions on the next tick; a cleared queue does nothing', () => {
    const s = new BattleSession(setup());
    const seen: string[] = [];
    s.onTick((events) => seen.push(...events.map((e) => e.type)));
    s.queue({ type: 'surrender', side: 1 });
    s.clearPending();
    s.tick();
    expect(s.state.phase).toBe('main');
    s.queue({ type: 'surrender', side: 1 });
    expect(s.state.phase).toBe('main');
    s.tick();
    expect(seen).toContain('ended');
    expect(s.state.result).toEqual({ winner: 0, reason: 'surrender' });
    // An ended battle does not tick any more.
    const at = s.state.tick;
    s.tick();
    expect(s.state.tick).toBe(at);
  });

  it('the opponent driver adds its actions before every tick', () => {
    const s = new BattleSession(setup());
    s.driver = (st) => (st.tick === 3 ? [{ type: 'surrender', side: 1 }] : []);
    for (let i = 0; i < 5; i++) s.tick();
    expect(s.state.result?.winner).toBe(0);
    expect(s.state.tick).toBe(3);
  });
});

describe('SaveService (YG-07, YG-08)', () => {
  const memory = (): {
    store: Map<string, string>;
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
  } => {
    const store = new Map<string, string>();
    return { store, getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
  };

  it('reads broken or partial copies without breaking the game', () => {
    expect(migrate('not json')).toBeNull();
    expect(migrate(null)).toBeNull();
    const d = migrate({
      gold: -5,
      player: { level: 40, trophies: 120 },
      cards: { cannon: { level: 99, copies: 3 }, dragon: { level: 1 } },
      decks: [['wall', 'wall', 'nope'], 7],
      activeDeck: 2,
      chests: [{ type: 'gold', unlockStartedAt: null }, { type: 'x' }],
      seen: ['a', 'a', 3],
    });
    expect(d?.gold).toBe(0);
    expect(d?.player).toMatchObject({ level: 9, trophies: 120, bestTrophies: 120, arena: 1 });
    expect(d?.cards.cannon).toEqual({ level: 9, copies: 3 });
    expect(Object.keys(d?.cards ?? {})).not.toContain('dragon');
    // A broken active deck falls back to the starter deck, which is always playable.
    expect(d?.decks[0]).toEqual(STARTER_DECK);
    expect(d?.activeDeck).toBe(0);
    expect(d?.chests).toEqual([
      { type: 'gold', unlockStartedAt: null, adSkips: 0 },
      null,
      null,
      null,
    ]);
    expect(d?.seen).toEqual(['a']);
  });

  it('a new player starts with the 8 cards of arena 1 at level 1 (CRD-01)', () => {
    const d = defaultSave();
    expect(d.decks[d.activeDeck]).toHaveLength(8);
    expect(Object.values(d.cards).every((c) => c.level === 1)).toBe(true);
    expect(migrate(JSON.stringify(d))).toEqual(d);
  });

  it('the fresher of the local and the cloud copy wins', async () => {
    const local = memory();
    const cloud: SaveData = { ...defaultSave(), updatedAt: 200, gold: 7 };
    local.setItem(
      `${__APP_ID__}.save`,
      JSON.stringify({ ...defaultSave(), updatedAt: 100, gold: 3 }),
    );
    const s = new SaveService(
      { loadSave: async () => cloud, writeSave: async () => undefined },
      local,
    );
    expect((await s.load()).gold).toBe(7);
  });

  it('writes locally at once; to the cloud at once only for important changes', async () => {
    const local = memory();
    const writes: boolean[] = [];
    let now = 0;
    const s = new SaveService(
      { loadSave: async () => null, writeSave: async (_d, flush) => void writes.push(flush) },
      local,
      () => now,
    );
    await s.load();
    s.commit();
    expect(local.store.size).toBe(1);
    expect(writes).toEqual([false]);
    now = 1000;
    s.commit();
    expect(writes).toEqual([false]);
    s.commit(true);
    expect(writes).toEqual([false, true]);
  });

  it('YG-08: the worst case stays under 20 KB', () => {
    const d = defaultSave();
    for (const id of CARD_IDS) d.cards[id] = { level: 9, copies: 99_999 };
    d.decks = [[...STARTER_DECK], [...STARTER_DECK], [...STARTER_DECK]];
    d.chests = [0, 1, 2, 3].map(() => ({
      type: 'silver' as const,
      unlockStartedAt: 1_800_000_000_000,
      adSkips: 3,
    }));
    d.chestCycle.order = Array.from({ length: 20 }, () => 'silver' as const);
    d.quests.items = [0, 1, 2].map((i) => ({
      id: `quest-${String(i)}`,
      progress: 99,
      claimed: true,
    }));
    d.shop.offers = CARD_IDS.slice(0, 6).map((card) => ({ card, copies: 10 }));
    d.shop.bought = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < 200; i++) d.seen.push(`new-thing-${String(i)}`);
    expect(saveSize(d)).toBeLessThan(MAX_SAVE_BYTES);
  });
});

describe('ProgressService', () => {
  const progress = (): ProgressService => {
    const save = new SaveService(
      { loadSave: async () => null, writeSave: async () => undefined },
      null,
    );
    return new ProgressService(save);
  };

  it('UI-02, ECO-02: counts battles and wins and keeps the gold', () => {
    const p = progress();
    expect(p.firstLaunch()).toBe(true);
    p.recordBattle({ won: true, draw: false, gold: 25 });
    p.recordBattle({ won: false, draw: true, gold: 5 });
    expect([p.battles(), p.wins(), p.data.gold]).toEqual([2, 1, 30]);
    expect(p.firstLaunch()).toBe(false);
  });

  it('spends only what there is; one-time things stay seen', () => {
    const p = progress();
    p.addGold(5);
    expect(p.spendGold(10)).toBe(false);
    expect(p.spendGold(5)).toBe(true);
    p.markSeen('tutorial');
    p.markSeen('tutorial');
    expect(p.data.seen).toEqual(['tutorial']);
  });
});
