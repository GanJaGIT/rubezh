/**
 * §3.12, QA-02: the schema of the content files and their agreement with each other. A broken
 * file fails the tests (tests/content), not the player. Every check returns the problems found
 * (an empty list — the file is fine).
 */

import { CARD_IDS } from '../sim/types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const RARITIES = ['common', 'rare', 'epic'];
const EFFECTS: Record<string, string[]> = {
  buffDamage: ['value'],
  reduceDamage: ['value'],
  heal: ['perSecond'],
  elixir: ['everySec'],
  zone: ['radius'],
  splash: ['ratio'],
  slow: ['ratio', 'sec'],
  line: ['length'],
};

export function validateCards(raw: unknown): string[] {
  const p: string[] = [];
  if (!Array.isArray(raw)) return ['cards: not a list'];
  const ids = raw.map((c) => (isObj(c) ? c.id : null));
  for (const id of CARD_IDS) if (!ids.includes(id)) p.push(`cards: ${id} is missing`);
  if (new Set(ids).size !== ids.length) p.push('cards: an id twice');
  for (const c of raw) {
    if (!isObj(c)) {
      p.push('cards: not an object');
      continue;
    }
    const at = `cards.${String(c.id)}`;
    if (!(CARD_IDS as readonly unknown[]).includes(c.id)) p.push(`${at}: unknown id`);
    if (!num(c.cost, 1, 10) || !Number.isInteger(c.cost)) p.push(`${at}: cost 1-10`);
    if (!RARITIES.includes(c.rarity as string)) p.push(`${at}: rarity`);
    if (!num(c.arena, 1, 5) || !Number.isInteger(c.arena)) p.push(`${at}: arena 1-5`);
    for (const k of ['hp', 'dmg', 'cooldown', 'range', 'minRange']) {
      if (!num(c[k], 0, 10_000)) p.push(`${at}: ${k}`);
    }
    if (!Array.isArray(c.effects)) p.push(`${at}: effects`);
    else {
      for (const e of c.effects) {
        const fields = isObj(e) ? EFFECTS[e.type as string] : undefined;
        if (!isObj(e) || !fields || !fields.every((f) => num(e[f], 0, 100))) {
          p.push(`${at}: effect ${JSON.stringify(e)}`);
        }
      }
    }
    if (c.spell !== undefined) {
      const s = c.spell;
      if (
        !isObj(s) ||
        !Array.isArray(s.area) ||
        !['corner', 'center'].includes(s.anchor as string)
      ) {
        p.push(`${at}: spell`);
      }
      if (c.hp !== 0 || c.dmg !== 0) p.push(`${at}: a spell has no hp and no shots`);
    } else {
      if (!num(c.hp, 1, 10_000)) p.push(`${at}: a building needs hp`);
      const shoots = (c.dmg as number) > 0;
      if (shoots && (!num(c.cooldown, 0.1, 60) || !num(c.range, 1, 10))) {
        p.push(`${at}: a shooter needs cooldown and range`);
      }
      if (shoots && (c.minRange as number) >= (c.range as number))
        p.push(`${at}: minRange < range`);
    }
  }
  return p;
}

/** Bot decks (OPP-03): 4 per arena, 8 different cards each, only cards of the open arenas. */
export function validateBotDecks(
  raw: unknown,
  cardArena: (id: string) => number | undefined,
): string[] {
  const p: string[] = [];
  if (!isObj(raw)) return ['bot-decks: not an object'];
  for (let arena = 1; arena <= 5; arena++) {
    const decks = raw[String(arena)];
    if (!Array.isArray(decks) || decks.length !== 4) {
      p.push(`bot-decks.${String(arena)}: 4 decks`);
      continue;
    }
    decks.forEach((d, i) => {
      const at = `bot-decks.${String(arena)}[${String(i)}]`;
      if (!Array.isArray(d) || d.length !== 8 || new Set(d).size !== 8)
        p.push(`${at}: 8 different cards`);
      else {
        for (const c of d) {
          const a = cardArena(String(c));
          if (a === undefined) p.push(`${at}: unknown ${String(c)}`);
          else if (a > arena) p.push(`${at}: ${String(c)} opens in arena ${String(a)}`);
        }
      }
    });
  }
  return p;
}

/** CRD-10, LVL-01: the upgrade table goes 2…9 and only up; 8 thresholds of experience. */
export function validateProgression(raw: unknown): string[] {
  const p: string[] = [];
  if (!isObj(raw)) return ['progression: not an object'];
  const up = raw.upgrade;
  if (!Array.isArray(up) || up.length !== 8) p.push('progression.upgrade: 8 steps');
  else {
    up.forEach((s, i) => {
      if (!isObj(s) || s.to !== i + 2)
        p.push(`progression.upgrade[${String(i)}]: to ${String(i + 2)}`);
      const prev = up[i - 1] as Obj | undefined;
      if (
        isObj(s) &&
        prev &&
        ((s.copies as number) <= (prev.copies as number) ||
          (s.gold as number) <= (prev.gold as number))
      ) {
        p.push(`progression.upgrade[${String(i)}]: costs grow`);
      }
    });
  }
  const xp = raw.playerXp;
  if (
    !Array.isArray(xp) ||
    xp.length !== 8 ||
    xp.some((v, i) => i > 0 && v <= (xp[i - 1] as number))
  ) {
    p.push('progression.playerXp: 8 growing thresholds');
  }
  return p;
}

/** CHS-02, CHS-03: chances and sizes in range, a 20-chest cycle. */
export function validateChests(raw: unknown): string[] {
  const p: string[] = [];
  if (!isObj(raw) || !isObj(raw.types) || !isObj(raw.cycle)) return ['chests: shape'];
  for (const [k, t] of Object.entries(raw.types)) {
    if (!isObj(t) || !num(t.rare, 0, 1) || !num(t.epic, 0, 1) || !num(t.cards, 1, 200)) {
      p.push(`chests.${k}`);
    } else if ((t.rare as number) + (t.epic as number) >= 1) p.push(`chests.${k}: chances`);
  }
  const total = Object.values(raw.cycle).reduce<number>((a, b) => a + (b as number), 0);
  if (total !== 20) p.push('chests.cycle: 20 chests');
  return p;
}
