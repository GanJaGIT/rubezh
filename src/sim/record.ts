/**
 * §3.8: battle records. A player's battle is recorded as SDK transactions (REC-01, REC-02); a
 * loaded record is checked before the battle (REP-01) and replayed as side 1's actions at the
 * recorded moments (REP-02…REP-06). Pure: the platform layer only moves the payloads.
 */

import { checkPlay, viewOf } from './battle';
import { CARDS, COLS, elixirPossible, ROWS, TICKS_PER_SEC } from './rules';
import {
  CARD_IDS,
  type Action,
  type BattleState,
  type CardId,
  type CardLevels,
  type Side,
} from './types';

export const RECORD_VERSION = 1;
/** REP-01: a record with more events is not trusted. */
const MAX_EVENTS = 300;
/** REP-01: the starting elixir. */
const START_ELIXIR = 5;
/** GD-21: a workshop adds a unit this often (ms). */
const WORKSHOP_MS = 10_000;
/** REP-03: an event waits for elixir this long, then goes. */
const WAIT_TICKS = 5 * TICKS_PER_SEC;
/** REP-04: how far an event may move to a free cell (Chebyshev). */
const MAX_SHIFT = 2;

/** REC-02: the first event of a battle. */
export interface RecordHeader {
  k: 'h';
  v: number;
  deck: CardId[];
  lv: number[];
  pl: number;
  ar: number;
  seed: number;
}

/** REC-01: a card played, in the player's own system of coordinates. */
export interface RecordPlay {
  k: 'p';
  c: CardId;
  x: number;
  y: number;
}

export function headerPayload(h: Omit<RecordHeader, 'k' | 'v'>): RecordHeader {
  return { k: 'h', v: RECORD_VERSION, ...h };
}

export function playPayload(card: CardId, x: number, y: number): RecordPlay {
  return { k: 'p', c: card, x, y };
}

/** REC-04: whether a finished battle is worth sending as a record. */
export function shouldPush(b: {
  tutorial: boolean;
  /** The player left the battle without finishing it. */
  abandoned: boolean;
  /** Cards the player played. */
  played: number;
  ticks: number;
}): boolean {
  return !b.tutorial && !b.abandoned && b.played > 6 && b.ticks > 60 * TICKS_PER_SEC;
}

/** A checked record: the opponent's deck, levels and the plays at their ticks (own system). */
export interface BattleRecord {
  deck: CardId[];
  levels: CardLevels;
  playerLevel: number;
  arena: number;
  seed: number;
  plays: { tick: number; card: CardId; x: number; y: number }[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isCard = (v: unknown): v is CardId =>
  typeof v === 'string' && (CARD_IDS as readonly string[]).includes(v);

/**
 * REP-01: a record is checked before the battle — the version, known and different cards, the
 * levels (each card at most the player's level + 3), the times never going back, at most 300
 * events, and no more elixir spent than the battle could give: the regeneration, the 5 at the
 * start and what every workshop played could add till the end (instead of a flat 30, which a
 * fair deck with three workshops exceeds — PROGRESS.md). A bad one is skipped.
 */
export function parseRecord(
  timeline: readonly { payload: unknown; time: number }[],
): { record: BattleRecord } | { problems: string[] } {
  const p: string[] = [];
  if (timeline.length === 0) return { problems: ['empty'] };
  if (timeline.length > MAX_EVENTS) p.push(`${String(timeline.length)} events`);
  const h = timeline[0]?.payload;
  if (!isObj(h) || h.k !== 'h') return { problems: ['no header'] };
  if (h.v !== RECORD_VERSION) p.push(`version ${String(h.v)}`);
  const deck = Array.isArray(h.deck) ? h.deck : [];
  if (deck.length !== 8 || !deck.every(isCard) || new Set(deck).size !== 8) {
    p.push('deck: 8 different known cards');
  }
  if (!int(h.pl, 1, 9)) p.push('player level 1-9');
  const pl = int(h.pl, 1, 9) ? h.pl : 1;
  const lv = Array.isArray(h.lv) ? h.lv : [];
  if (lv.length !== deck.length || !lv.every((l) => int(l, 1, Math.min(9, pl + 3)))) {
    p.push('card levels 1-9 and at most the player level + 3');
  }
  const plays: BattleRecord['plays'] = [];
  let last = -1;
  let spent = 0;
  const workshops: number[] = [];
  for (const e of timeline.slice(1)) {
    if (!Number.isFinite(e.time) || e.time < last) {
      p.push('times go back');
      break;
    }
    last = e.time;
    const q = e.payload;
    if (
      !isObj(q) ||
      q.k !== 'p' ||
      !isCard(q.c) ||
      !int(q.x, 0, COLS - 1) ||
      !int(q.y, 0, ROWS - 1)
    ) {
      p.push('a bad play');
      break;
    }
    if (!deck.includes(q.c)) {
      p.push(`a card outside the deck: ${q.c}`);
      break;
    }
    spent += CARDS[q.c].cost;
    if (q.c === 'workshop') workshops.push(e.time);
    plays.push({ tick: Math.floor(e.time / (1000 / TICKS_PER_SEC)), card: q.c, x: q.x, y: q.y });
  }
  // What the workshops could add: every one played, standing till the end (an upper bound).
  const fromWorkshops = workshops.reduce((n, t) => n + Math.floor((last - t) / WORKSHOP_MS) + 1, 0);
  if (spent > elixirPossible(Math.max(0, last)) + START_ELIXIR + fromWorkshops) {
    p.push(`spends ${String(spent)} elixir`);
  }
  if (p.length > 0) return { problems: p };
  return {
    record: {
      deck: deck as CardId[],
      levels: Object.fromEntries((deck as CardId[]).map((c, i) => [c, lv[i] as number])),
      playerLevel: pl,
      arena: int(h.ar, 1, 5) ? h.ar : 1,
      seed: int(h.seed, 0, 2 ** 32 - 1) ? h.seed : 0,
      plays,
    },
  };
}

export interface ReplayStats {
  exact: number;
  moved: number;
  droppedCell: number;
  droppedElixir: number;
}

/**
 * REP-02…REP-06: a record replayed as one side's actions. Events come at their recorded tick,
 * turned by 180° into the board's system; an event without elixir waits up to 5 seconds; a
 * taken or unreachable cell moves to the nearest allowed one within 2 (Chebyshev; ties — nearer
 * by row, then the lower column), or the event is dropped. After the last event the fallback
 * (a bot) plays on (OPP-04).
 */
export class RecordDriver {
  readonly stats: ReplayStats = { exact: 0, moved: 0, droppedCell: 0, droppedElixir: 0 };
  private next = 0;
  private pending: { tick: number; card: CardId; x: number; y: number }[] = [];

  constructor(
    private readonly record: BattleRecord,
    readonly side: Side = 1,
    private readonly fallback: ((s: BattleState) => Action[]) | null = null,
  ) {}

  /** OPP-04: every event of the record has been used. */
  finished(): boolean {
    return this.next >= this.record.plays.length && this.pending.length === 0;
  }

  act(s: BattleState): Action[] {
    if (s.phase === 'ended') return [];
    if (this.finished()) return this.fallback ? this.fallback(s) : [];
    const plays = this.record.plays;
    while (this.next < plays.length && (plays[this.next]?.tick ?? 0) <= s.tick) {
      const p = plays[this.next] as BattleRecord['plays'][number];
      this.next += 1;
      // REP-02: the record is in the opponent's own system — turn it by 180°.
      const x = this.side === 1 ? COLS - 1 - p.x : p.x;
      const y = this.side === 1 ? ROWS - 1 - p.y : p.y;
      this.pending.push({ tick: p.tick, card: p.card, x, y });
    }
    const out: Action[] = [];
    const keep: typeof this.pending = [];
    const view = viewOf(s);
    let elixir = s.elixir[this.side];
    for (const ev of this.pending) {
      const cost = CARDS[ev.card].cost * 1000;
      if (cost > elixir) {
        if (s.tick - ev.tick > WAIT_TICKS) this.stats.droppedElixir += 1;
        else keep.push(ev);
        continue;
      }
      const at = this.place(s, ev, view);
      if (!at) {
        this.stats.droppedCell += 1;
        continue;
      }
      if (at.x === ev.x && at.y === ev.y) this.stats.exact += 1;
      else this.stats.moved += 1;
      elixir -= cost;
      out.push({ type: 'play', side: this.side, card: ev.card, x: at.x, y: at.y, record: true });
      // Two events of one tick: the second must not land on the cell the first takes.
      if (!CARDS[ev.card].spell) view.occ[at.y * COLS + at.x] = -1;
    }
    this.pending = keep;
    return out;
  }

  /** REP-04: the cell the event lands on, or null. */
  private place(
    s: BattleState,
    ev: { card: CardId; x: number; y: number },
    view: ReturnType<typeof viewOf>,
  ): { x: number; y: number } | null {
    const ok = (x: number, y: number): boolean =>
      (view.occ[y * COLS + x] ?? 0) >= 0 &&
      checkPlay(s, { type: 'play', side: this.side, card: ev.card, x, y, record: true }, view) ===
        null;
    if (ev.x >= 0 && ev.x < COLS && ev.y >= 0 && ev.y < ROWS && ok(ev.x, ev.y)) return ev;
    let best: { x: number; y: number; k: [number, number, number] } | null = null;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const d = Math.max(Math.abs(x - ev.x), Math.abs(y - ev.y));
        if (d === 0 || d > MAX_SHIFT || !ok(x, y)) continue;
        const k: [number, number, number] = [d, Math.abs(y - ev.y), x];
        if (
          !best ||
          k[0] < best.k[0] ||
          (k[0] === best.k[0] && (k[1] < best.k[1] || (k[1] === best.k[1] && k[2] < best.k[2])))
        ) {
          best = { x, y, k };
        }
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }
}
