import { describe, expect, it } from 'vitest';
import {
  addCards,
  addCrowns,
  adSkip,
  applyTrophies,
  arenaFor,
  awardChest,
  battleGold,
  buyOffer,
  canUpgrade,
  chestSize,
  claimQuest,
  createCycle,
  deckLevels,
  isFreeOffer,
  moscowDay,
  offerPrice,
  openChest,
  openHours,
  playerLevelFor,
  questProgress,
  refreshFreeChest,
  rollOffers,
  rollQuests,
  speedUpCost,
  startUnlock,
  takeChest,
  takeCrownChest,
  takeFreeChest,
  timeLeft,
  trophyDelta,
  unlockedCards,
  upgrade,
  upgradeCost,
  type SaveData,
} from '../../src/meta';
import { defaultSave } from '../../src/services/save';
import { CARDS, type CardId } from '../../src/sim';

/** §3.11: T-18…T-20, the quests (ECO-03) and the card shop (ECO-04). */

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const save = (): SaveData => defaultSave();

describe('T-18: chests (CHS-01…CHS-04)', () => {
  it('the cycle of 20: 14 wooden, 5 silver, 1 gold; shuffled by the seed', () => {
    const c = createCycle({ rng: 1 });
    const n = (t: string): number => c.filter((x) => x === t).length;
    expect([c.length, n('wood'), n('silver'), n('gold')]).toEqual([20, 14, 5, 1]);
    expect(createCycle({ rng: 1 })).toEqual(c);
    expect(createCycle({ rng: 2 })).not.toEqual(c);
  });

  it('a win fills a free slot with the next chest of the cycle; 4 slots full — no chest', () => {
    const s = save();
    const r = { rng: 3 };
    const got = [0, 1, 2, 3, 4].map(() => awardChest(s, r));
    expect(got.slice(0, 4)).toEqual(s.chestCycle.order.slice(0, 4));
    expect(got[4]).toBeNull();
    expect(s.chestCycle.index).toBe(4);
  });

  it('one chest opens at a time; time by the server clock; gems and ads speed it up', () => {
    const s = save();
    s.chests = [
      { type: 'wood', unlockStartedAt: null, adSkips: 0 },
      { type: 'gold', unlockStartedAt: null, adSkips: 0 },
      null,
      null,
    ];
    expect(startUnlock(s, 0, NOW)).toBe(true);
    expect(startUnlock(s, 1, NOW)).toBe(false);
    const wood = s.chests[0] as NonNullable<SaveData['chests'][number]>;
    expect(timeLeft(wood, NOW + HOUR)).toBe(2 * HOUR);
    expect(speedUpCost(2 * HOUR)).toBe(12);
    expect(speedUpCost(2 * HOUR + 1)).toBe(13);
    expect([adSkip(wood), adSkip(wood), adSkip(wood), adSkip(wood)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(timeLeft(wood, NOW)).toBe(0);
    expect(takeChest(s, 1, NOW, true)).toBeNull(); // not started: no paying for it
    expect(takeChest(s, 0, NOW)).toBe('wood');
    expect(s.chests[0]).toBeNull();
    startUnlock(s, 1, NOW);
    s.gems = 10;
    expect(takeChest(s, 1, NOW, true)).toBeNull(); // 72 gems needed
    s.gems = 72;
    expect(takeChest(s, 1, NOW, true)).toBe('gold');
    expect(s.gems).toBe(0);
    expect(openHours('silver')).toBe(8);
  });

  it('the free chest comes every 4 hours, at most 2 kept; the crown chest after 10 crowns a day', () => {
    const s = save();
    s.freeChest = { nextAt: 0, stored: 0 };
    refreshFreeChest(s, NOW);
    expect(s.freeChest).toEqual({ nextAt: NOW + 4 * HOUR, stored: 0 });
    refreshFreeChest(s, NOW + 13 * HOUR);
    expect(s.freeChest).toEqual({ nextAt: 0, stored: 2 });
    expect(takeFreeChest(s, NOW + 13 * HOUR)).toBe(true);
    expect(s.freeChest).toEqual({ nextAt: NOW + 17 * HOUR, stored: 1 });
    expect(takeFreeChest(s, NOW + 13 * HOUR)).toBe(true);
    expect(takeFreeChest(s, NOW + 13 * HOUR)).toBe(false);
    const day = moscowDay(NOW);
    addCrowns(s, 9, day);
    expect(takeCrownChest(s, day)).toBe(false);
    addCrowns(s, 1, day);
    expect(takeCrownChest(s, day)).toBe(true);
    expect(takeCrownChest(s, day)).toBe(false);
    addCrowns(s, 10, day + 1);
    expect(takeCrownChest(s, day + 1)).toBe(true);
  });

  it('CHS-03: more gold and cards in higher arenas', () => {
    expect(chestSize('wood', 1)).toEqual({ gold: 30, cards: 4 });
    expect(chestSize('wood', 5)).toEqual({ gold: 60, cards: 8 });
    expect(chestSize('gold', 3)).toEqual({ gold: 300, cards: 45 });
  });

  it('chances on 100 000 openings within ±1%; only open arenas; at most 4 kinds', () => {
    const r = { rng: 11 };
    const count = { common: 0, rare: 0, epic: 0 };
    let maxKinds = 0;
    for (let i = 0; i < 100_000; i++) {
      const c = openChest('gold', 5, r);
      maxKinds = Math.max(maxKinds, Object.keys(c.cards).length);
      for (const [id, n] of Object.entries(c.cards) as [CardId, number][])
        count[CARDS[id].rarity] += n;
    }
    const total = count.common + count.rare + count.epic;
    expect(Math.abs(count.rare / total - 0.18)).toBeLessThan(0.01);
    expect(Math.abs(count.epic / total - 0.04)).toBeLessThan(0.01);
    expect(maxKinds).toBeLessThanOrEqual(4);
    const early = { rng: 5 };
    for (let i = 0; i < 2000; i++) {
      const c = openChest('silver', 1, early);
      expect(Object.keys(c.cards).every((id) => CARDS[id as CardId].arena <= 1)).toBe(true);
      expect(Object.values(c.cards).reduce((a, b) => a + b, 0)).toBe(12);
    }
  }, 120_000);
});

describe('T-19: trophies and arenas (ARN-01…ARN-03)', () => {
  it('a win 30, a loss 25, ±1 per 50 of difference, at most ±5; a draw 0', () => {
    expect(trophyDelta('win', 100, 100)).toBe(30);
    expect(trophyDelta('win', 100, 260)).toBe(33);
    expect(trophyDelta('win', 100, 900)).toBe(35);
    expect(trophyDelta('win', 400, 100)).toBe(25);
    expect(trophyDelta('loss', 100, 100)).toBe(-25);
    expect(trophyDelta('loss', 100, 260)).toBe(-22);
    expect(trophyDelta('loss', 100, 900)).toBe(-20);
    expect(trophyDelta('loss', 900, 100)).toBe(-30);
    expect(trophyDelta('draw', 0, 500)).toBe(0);
  });

  it('the arena opens at its threshold; trophies never fall below the arena reached', () => {
    expect([0, 299, 300, 600, 1000, 1499, 1500].map(arenaFor)).toEqual([1, 1, 2, 3, 4, 4, 5]);
    const p = { trophies: 290, bestTrophies: 290, arena: 1 };
    expect(applyTrophies(p, 30)).toBe(2);
    expect(p).toEqual({ trophies: 320, bestTrophies: 320, arena: 2 });
    expect(applyTrophies(p, -25)).toBeNull();
    expect(p).toEqual({ trophies: 300, bestTrophies: 320, arena: 2 });
    const low = { trophies: 10, bestTrophies: 10, arena: 1 };
    applyTrophies(low, -25);
    expect(low.trophies).toBe(0);
  });

  it('ECO-02: gold — a win 20 + 5 × arena, a loss and a draw 5', () => {
    expect([
      battleGold('win', 1),
      battleGold('win', 5),
      battleGold('loss', 3),
      battleGold('draw', 2),
    ]).toEqual([25, 45, 5, 5]);
  });
});

describe('T-20: collection and upgrades (CRD-10, CRD-11, LVL-01)', () => {
  it('copies and gold for a level, experience for the player', () => {
    const s = save();
    expect(upgradeCost(1)).toEqual({ to: 2, copies: 2, gold: 5, xp: 4 });
    expect(upgradeCost(9)).toBeNull();
    expect(canUpgrade(s, 'cannon')).toBe(false);
    addCards(s, { cannon: 2 });
    expect(canUpgrade(s, 'cannon')).toBe(false); // no gold
    s.gold = 30;
    expect(upgrade(s, 'cannon')).toBe(true);
    expect(s.cards.cannon).toEqual({ level: 2, copies: 0 });
    expect([s.gold, s.player.xp, s.player.level]).toEqual([25, 4, 1]);
    expect(upgrade(s, 'dome')).toBe(false);
  });

  it('player levels by the thresholds 20, 50, 100…3000', () => {
    expect([0, 19, 20, 49, 50, 3000, 99_999].map(playerLevelFor)).toEqual([1, 1, 2, 2, 3, 9, 9]);
    const s = save();
    s.gold = 10_000;
    addCards(s, { wall: 2, watch: 2, banner: 2, archers: 2, cannon: 2 });
    for (const c of ['wall', 'watch', 'banner', 'archers', 'cannon'] as CardId[]) upgrade(s, c);
    expect([s.player.xp, s.player.level]).toEqual([20, 2]);
  });

  it('CRD-11: a new rare card joins at level 3, an epic one at 6; copies are kept', () => {
    const s = save();
    expect(addCards(s, { outpost: 3, dome: 1, wall: 5 })).toEqual(['outpost', 'dome']);
    expect(s.cards.outpost).toEqual({ level: 3, copies: 2 });
    expect(s.cards.dome).toEqual({ level: 6, copies: 0 });
    expect(s.cards.wall).toEqual({ level: 1, copies: 5 });
    expect(deckLevels(s, ['outpost', 'dome', 'ice'])).toEqual({ outpost: 3, dome: 6, ice: 1 });
    expect(unlockedCards(1)).toHaveLength(8);
    expect(unlockedCards(5)).toHaveLength(16);
  });
});

describe('ECO-03: daily quests', () => {
  it('three different quests a Moscow day; battles add progress; claimed once', () => {
    const s = save();
    const day = moscowDay(NOW);
    expect(rollQuests(s, day, { rng: 4 })).toBe(true);
    expect(rollQuests(s, day, { rng: 4 })).toBe(false);
    expect(new Set(s.quests.items.map((q) => q.id)).size).toBe(3);
    s.quests.items = [
      { id: 'win2', progress: 0, claimed: false },
      { id: 'towers3', progress: 0, claimed: false },
      { id: 'stack5', progress: 0, claimed: false },
    ];
    const stats = { played: 9, stacks: 3, enemyHalf: 1, expensive: 2, towers: 2 };
    questProgress(s, { won: true, crowns: 2, stats });
    expect(claimQuest(s, 'win2')).toBe(false);
    questProgress(s, { won: true, crowns: 1, stats });
    expect(s.quests.items.map((q) => q.progress)).toEqual([2, 3, 5]);
    expect(claimQuest(s, 'win2')).toBe(true);
    expect(claimQuest(s, 'win2')).toBe(false);
    expect(claimQuest(s, 'towers3')).toBe(true);
    expect([s.gold, s.gems]).toEqual([40, 5]);
    expect(rollQuests(s, day + 1, { rng: 4 })).toBe(true);
    // Moscow midnight: 21:00 UTC.
    expect(moscowDay(Date.UTC(2026, 9, 27, 20, 59))).toBe(moscowDay(Date.UTC(2026, 9, 27, 12)));
    expect(moscowDay(Date.UTC(2026, 9, 27, 21, 1))).toBe(moscowDay(Date.UTC(2026, 9, 27, 12)) + 1);
  });
});

describe('ECO-04: the card shop', () => {
  it('6 offers of open cards, at most one epic; the first free for an ad; bought once', () => {
    const s = save();
    s.player.arena = 5;
    rollOffers(s, 10, { rng: 6 });
    expect(s.shop.offers).toHaveLength(6);
    expect(s.shop.offers.filter((o) => CARDS[o.card].rarity === 'epic').length).toBeLessThanOrEqual(
      1,
    );
    expect(new Set(s.shop.offers.map((o) => o.card)).size).toBe(6);
    expect(rollOffers(s, 10, { rng: 6 })).toBe(false);
    expect(isFreeOffer(0)).toBe(true);
    expect(buyOffer(s, 0)).toBe(false);
    expect(buyOffer(s, 0, true)).toBe(true);
    s.shop.offers[1] = { card: 'cannon', copies: 10 };
    expect(offerPrice({ card: 'cannon', copies: 10 }, 1)).toBe(100);
    expect(offerPrice({ card: 'dome', copies: 1 }, 2)).toBe(1000);
    expect(offerPrice({ card: 'mortar', copies: 2 }, 3)).toBe(200);
    expect(buyOffer(s, 1)).toBe(false);
    s.gold = 150;
    expect(buyOffer(s, 1)).toBe(true);
    expect(buyOffer(s, 1)).toBe(false);
    expect([s.gold, s.cards.cannon?.copies]).toEqual([50, 10]);
    const early = save();
    rollOffers(early, 1, { rng: 1 });
    expect(early.shop.offers.every((o) => CARDS[o.card].arena === 1)).toBe(true);
  });
});
