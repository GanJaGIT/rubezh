/**
 * ECO-03: three daily quests from the pool, renewed at midnight in Moscow by the server clock
 * (YG-25). A battle adds its progress; a finished quest is claimed for gold or gems.
 */

import quests from '../content/quests.json';
import { randomInt, type SideStats } from '../sim';
import type { SaveData } from './save-data';

export type QuestKind =
  'wins' | 'battles' | 'stacks' | 'enemyHalf' | 'towers' | 'expensive' | 'crowns';

export interface QuestDef {
  id: string;
  kind: QuestKind;
  target: number;
  gold: number;
  gems: number;
}

export const QUESTS = quests.pool as QuestDef[];
const DAY = 86_400_000;
const MOSCOW = 3 * 3_600_000;

/** The Moscow day number of a server time (days since 1970-01-01). */
export const moscowDay = (serverMs: number): number => Math.floor((serverMs + MOSCOW) / DAY);

/** A new day: three different quests from the pool. */
export function rollQuests(save: SaveData, day: number, random: { rng: number }): boolean {
  if (save.quests.day === day && save.quests.items.length > 0) return false;
  const pool = [...QUESTS];
  const items: SaveData['quests']['items'] = [];
  while (items.length < quests.perDay && pool.length > 0) {
    const q = pool.splice(randomInt(random, pool.length), 1)[0] as QuestDef;
    items.push({ id: q.id, progress: 0, claimed: false });
  }
  save.quests = { day, items };
  return true;
}

export interface BattleFacts {
  won: boolean;
  crowns: number;
  stats: SideStats;
}

const gain = (kind: QuestKind, b: BattleFacts): number => {
  switch (kind) {
    case 'wins':
      return b.won ? 1 : 0;
    case 'battles':
      return 1;
    case 'stacks':
      return b.stats.stacks;
    case 'enemyHalf':
      return b.stats.enemyHalf;
    case 'towers':
      return b.stats.towers;
    case 'expensive':
      return b.stats.expensive;
    case 'crowns':
      return b.crowns;
  }
};

/** A battle's progress on today's quests. */
export function questProgress(save: SaveData, b: BattleFacts): void {
  for (const item of save.quests.items) {
    const def = QUESTS.find((q) => q.id === item.id);
    if (!def || item.claimed) continue;
    item.progress = Math.min(def.target, item.progress + gain(def.kind, b));
  }
}

/** Claims a finished quest's reward. */
export function claimQuest(save: SaveData, id: string): boolean {
  const item = save.quests.items.find((q) => q.id === id);
  const def = QUESTS.find((q) => q.id === id);
  if (!item || !def || item.claimed || item.progress < def.target) return false;
  item.claimed = true;
  save.gold += def.gold;
  save.gems += def.gems;
  return true;
}
