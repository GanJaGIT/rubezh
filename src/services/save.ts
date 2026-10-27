/**
 * YG-07, YG-08, TECH-13: progress is written to localStorage right after every change and to the
 * platform cloud — at once for important changes (battle result, chest, upgrade, purchase), otherwise in
 * a batch at most every 10 s and when the tab is hidden. At most 80 cloud writes in 5 minutes
 * (the SDK allows 100). On load the fresher copy wins by `updatedAt`.
 */

import { STARTER_DECK } from '../content';
import type { Platform } from '../platform/Platform';
import { CARD_IDS, type CardId } from '../sim';
import { defaultSave, SAVE_VERSION } from '../meta/save-data';
import type { ChestType, SaveData } from './SaveData';

export { defaultSave, SAVE_VERSION };

/** Per game (package.json name): projects on one localhost do not share a save. */
export const LOCAL_KEY = `${__APP_ID__}.save`;
/** YG-08: under 20 KB; the SDK allows 200 KB. */
export const MAX_SAVE_BYTES = 20 * 1024;
const CLOUD_GAP_MS = 10_000;
const CLOUD_LIMIT = 80;
const CLOUD_WINDOW_MS = 5 * 60_000;

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const CHESTS: ChestType[] = ['wood', 'silver', 'gold'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
const ranged = (v: unknown, min: number, max: number, fallback: number): number =>
  Math.min(max, Math.max(min, count(v, fallback)));
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [];
const isCard = (v: unknown): v is CardId =>
  typeof v === 'string' && (CARD_IDS as readonly string[]).includes(v);
const isChest = (v: unknown): v is ChestType =>
  typeof v === 'string' && (CHESTS as readonly string[]).includes(v);
/** GD-30: a deck is up to 8 different known cards. */
const deck = (v: unknown): CardId[] =>
  Array.isArray(v) ? [...new Set(v.filter(isCard))].slice(0, 8) : [];
const list = <T>(v: unknown, read: (x: unknown) => T | null, max = 50): T[] =>
  Array.isArray(v)
    ? v
        .slice(0, max)
        .map(read)
        .filter((x): x is T => x !== null)
    : [];

/**
 * Reads any stored copy into the current schema: unknown or broken fields fall back to defaults,
 * so a damaged save never breaks the game. Returns null when there is nothing usable.
 */
export function migrate(raw: unknown): SaveData | null {
  if (typeof raw === 'string') {
    try {
      return migrate(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  if (!isObj(raw)) return null;
  const d = defaultSave();
  // v1 is the first schema; later versions add their steps here.
  d.updatedAt = count(raw.updatedAt);
  if (isObj(raw.player)) {
    const p = raw.player;
    d.player = {
      level: ranged(p.level, 1, 9, 1),
      xp: count(p.xp),
      trophies: count(p.trophies),
      bestTrophies: Math.max(count(p.bestTrophies), count(p.trophies)),
      arena: ranged(p.arena, 1, 5, 1),
    };
  }
  d.gold = count(raw.gold);
  d.gems = count(raw.gems);
  if (isObj(raw.cards)) {
    for (const [id, c] of Object.entries(raw.cards)) {
      if (isCard(id) && isObj(c))
        d.cards[id] = { level: ranged(c.level, 1, 9, 1), copies: count(c.copies) };
    }
  }
  if (Array.isArray(raw.decks)) {
    const decks = [0, 1, 2].map((i) => deck((raw.decks as unknown[])[i]));
    // The active deck must stay playable: a broken first deck falls back to the starter one.
    d.decks = [
      decks[0]?.length === 8 ? decks[0] : [...STARTER_DECK],
      decks[1] ?? [],
      decks[2] ?? [],
    ];
  }
  d.activeDeck = ranged(raw.activeDeck, 0, 2, 0);
  if ((d.decks[d.activeDeck]?.length ?? 0) !== 8) d.activeDeck = 0;
  if (Array.isArray(raw.chests)) {
    d.chests = [0, 1, 2, 3].map((i) => {
      const c = (raw.chests as unknown[])[i];
      if (!isObj(c) || !isChest(c.type)) return null;
      return {
        type: c.type,
        unlockStartedAt: c.unlockStartedAt === null ? null : count(c.unlockStartedAt) || null,
        adSkips: ranged(c.adSkips, 0, 3, 0),
      };
    });
  }
  if (isObj(raw.chestCycle)) {
    d.chestCycle = {
      order: list(raw.chestCycle.order, (x) => (isChest(x) ? x : null), 20),
      index: count(raw.chestCycle.index),
    };
  }
  if (isObj(raw.freeChest)) {
    d.freeChest = {
      nextAt: count(raw.freeChest.nextAt),
      stored: ranged(raw.freeChest.stored, 0, 2, 1),
    };
  }
  if (isObj(raw.crowns)) {
    d.crowns = {
      day: count(raw.crowns.day),
      count: count(raw.crowns.count),
      claimed: flag(raw.crowns.claimed, false),
    };
  }
  if (isObj(raw.quests)) {
    d.quests = {
      day: count(raw.quests.day),
      items: list(
        raw.quests.items,
        (q) =>
          isObj(q) && typeof q.id === 'string'
            ? { id: q.id, progress: count(q.progress), claimed: flag(q.claimed, false) }
            : null,
        3,
      ),
    };
  }
  if (isObj(raw.shop)) {
    d.shop = {
      day: count(raw.shop.day),
      offers: list(
        raw.shop.offers,
        (o) => (isObj(o) && isCard(o.card) ? { card: o.card, copies: count(o.copies) } : null),
        6,
      ),
      bought: list(raw.shop.bought, (b) => (typeof b === 'number' ? count(b) : null), 6),
    };
  }
  if (isObj(raw.tutorial)) {
    d.tutorial = { done: flag(raw.tutorial.done, false), step: count(raw.tutorial.step) };
  }
  if (isObj(raw.stats)) {
    d.stats = { battles: count(raw.stats.battles), wins: count(raw.stats.wins) };
  }
  if (isObj(raw.settings)) {
    const s = raw.settings;
    d.settings = {
      sound: flag(s.sound, true),
      music: flag(s.music, true),
      lang: typeof s.lang === 'string' ? s.lang : null,
    };
  }
  d.noAds = flag(raw.noAds, false);
  d.reviewAsked = flag(raw.reviewAsked, false);
  d.seen = strings(raw.seen);
  d.lastInterstitialAt = count(raw.lastInterstitialAt);
  return d;
}

export function saveSize(data: SaveData): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

export class SaveService {
  data: SaveData = defaultSave();
  /** Writes that the cloud has not got yet. */
  private dirty = false;
  private lastCloud = -Infinity;
  private readonly cloudTimes: number[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly platform: Pick<Platform, 'loadSave' | 'writeSave'>,
    private readonly storage: KeyValueStorage | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** YG-07: the local and the cloud copy, the fresher one by updatedAt. */
  async load(): Promise<SaveData> {
    let local: SaveData | null;
    try {
      local = migrate(this.storage?.getItem(LOCAL_KEY) ?? null);
    } catch {
      local = null;
    }
    let cloud: SaveData | null;
    try {
      cloud = migrate(await this.platform.loadSave());
    } catch {
      cloud = null;
    }
    const best =
      local && cloud ? (cloud.updatedAt > local.updatedAt ? cloud : local) : (local ?? cloud);
    this.data = best ?? defaultSave();
    return this.data;
  }

  /**
   * YG-09: after the account selection dialog the platform's copy is the one the player chose:
   * it replaces the progress in memory and the local copy (no "fresher wins" here).
   */
  async reloadFromCloud(): Promise<void> {
    let cloud: SaveData | null;
    try {
      cloud = migrate(await this.platform.loadSave());
    } catch {
      cloud = null;
    }
    if (!cloud) return;
    this.data = cloud;
    try {
      this.storage?.setItem(LOCAL_KEY, JSON.stringify(this.data));
    } catch {
      // The cloud copy is in memory anyway.
    }
  }

  /** YG-08: after every change. `important` changes go to the cloud at once. */
  commit(important = false): void {
    this.data.updatedAt = this.now();
    try {
      this.storage?.setItem(LOCAL_KEY, JSON.stringify(this.data));
    } catch {
      // Storage is full or blocked; the cloud copy still goes.
    }
    this.dirty = true;
    if (important) this.pushCloud(true);
    else this.schedule();
  }

  /** The tab is being hidden: send what the cloud has not got. */
  flush(): void {
    if (this.dirty) this.pushCloud(true);
  }

  private schedule(): void {
    const wait = this.lastCloud + CLOUD_GAP_MS - this.now();
    if (wait <= 0) {
      this.pushCloud(false);
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.dirty) this.pushCloud(false);
    }, wait);
  }

  private pushCloud(flush: boolean): void {
    const now = this.now();
    while (this.cloudTimes.length > 0 && now - (this.cloudTimes[0] as number) >= CLOUD_WINDOW_MS) {
      this.cloudTimes.shift();
    }
    if (this.cloudTimes.length >= CLOUD_LIMIT) {
      // The limit is reached: try again once the oldest write leaves the window.
      if (!this.timer) {
        const wait = (this.cloudTimes[0] as number) + CLOUD_WINDOW_MS - now;
        this.timer = setTimeout(() => {
          this.timer = null;
          if (this.dirty) this.pushCloud(flush);
        }, wait);
      }
      return;
    }
    this.cloudTimes.push(now);
    this.lastCloud = now;
    this.dirty = false;
    const copy = JSON.parse(JSON.stringify(this.data)) as SaveData;
    try {
      void this.platform.writeSave(copy, flush).catch(() => undefined);
    } catch {
      // Platform errors never break the game (§5.1).
    }
  }

  /** For tests and the moderator: cloud writes in the last 5 minutes. */
  cloudWrites(): number {
    return this.cloudTimes.length;
  }
}
