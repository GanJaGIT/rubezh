import { spriteUrl } from '../game/art';
import type { I18n } from '../services/I18n';
import { CARDS, RULES, UNIT, type BattleState, type CardId } from '../sim';
import { el, setText } from './dom';

/** GD-20: elixir a second, thousandths; twice as fast from 2:00. */
const PER_SEC = UNIT / RULES.regenSec;

/** The picture of a card: its building (the player's colour) or the spell's icon. */
export const cardArt = (card: CardId): string =>
  spriteUrl(CARDS[card].spell ? `spell-${card}` : `${card}-blue`);

export interface HandHandlers {
  /** A finger or the mouse went down on card `i` (the input decides: drag or tap). */
  press(i: number, e: PointerEvent): void;
}

/**
 * UI-10, INP-03: the hand — 4 cards and the next one. A card shows its picture and cost; one the
 * player cannot pay for is dimmed with the seconds until it can. The chosen card is lifted
 * (INP-02). The DOM is written only when something changed (WebKit loses clicks otherwise).
 */
export class Hand {
  private readonly cards: HTMLButtonElement[] = [];
  private readonly arts: HTMLImageElement[] = [];
  private readonly costs: HTMLElement[] = [];
  private readonly waits: HTMLElement[] = [];
  private readonly next: HTMLElement;
  private readonly nextArt: HTMLImageElement;
  private shown: (CardId | undefined)[] = [];
  private shownNext: CardId | undefined;
  private selected = -1;
  private hinted = -1;

  constructor(
    root: HTMLElement,
    private i18n: I18n,
    handlers: HandHandlers,
  ) {
    root.replaceChildren();
    for (let i = 0; i < RULES.handSize; i++) {
      const b = el('button', 'hud-card');
      b.type = 'button';
      b.dataset.ui = `card-${String(i)}`;
      const art = el('img', 'hud-card-art');
      art.alt = '';
      art.draggable = false;
      const cost = el('span', 'hud-card-cost');
      const wait = el('span', 'hud-card-wait');
      b.append(art, cost, wait);
      b.addEventListener('pointerdown', (e) => handlers.press(i, e));
      this.cards.push(b);
      this.arts.push(art);
      this.costs.push(cost);
      this.waits.push(wait);
      root.appendChild(b);
    }
    this.next = el('div', 'hud-card next');
    this.next.dataset.ui = 'card-next';
    this.nextArt = el('img', 'hud-card-art');
    this.nextArt.alt = '';
    this.next.appendChild(this.nextArt);
    root.appendChild(this.next);
    this.applyTexts(i18n);
  }

  applyTexts(i18n: I18n): void {
    this.i18n = i18n;
    this.shown = [];
    this.shownNext = undefined;
    this.next.setAttribute('aria-label', i18n.t('hand.next'));
  }

  element(i: number): HTMLElement | undefined {
    return this.cards[i];
  }

  select(i: number): void {
    if (this.selected === i) return;
    this.cards[this.selected]?.classList.remove('selected');
    this.selected = i;
    this.cards[i]?.classList.add('selected');
  }

  /** TUT: the card the tutorial points at glows (-1 — none). */
  hint(i: number): void {
    if (this.hinted === i) return;
    this.cards[this.hinted]?.classList.remove('hinted');
    this.hinted = i;
    this.cards[i]?.classList.add('hinted');
  }

  update(s: BattleState): void {
    const hand = s.hand[0];
    const elixir = s.elixir[0];
    const rate = s.tick >= RULES.doubleFromTick ? PER_SEC * 2 : PER_SEC;
    for (let i = 0; i < this.cards.length; i++) {
      const card = hand[i];
      const b = this.cards[i] as HTMLButtonElement;
      if (card !== this.shown[i]) {
        this.shown[i] = card;
        b.hidden = !card;
        if (card) {
          (this.arts[i] as HTMLImageElement).src = cardArt(card);
          setText(this.costs[i] as HTMLElement, String(CARDS[card].cost));
          b.setAttribute(
            'aria-label',
            `${this.i18n.t(`card.${card}.name`)}, ${this.i18n.t('hand.cost', { n: CARDS[card].cost })}`,
          );
        }
      }
      if (!card) continue;
      // INP-03: dimmed, with the seconds until the elixir is enough.
      const missing = CARDS[card].cost * UNIT - elixir;
      const dim = missing > 0;
      b.classList.toggle('dim', dim);
      setText(this.waits[i] as HTMLElement, dim ? String(Math.ceil(missing / rate)) : '');
    }
    const next = s.deck[0][0];
    if (next !== this.shownNext) {
      this.shownNext = next;
      this.next.hidden = !next;
      if (next) this.nextArt.src = cardArt(next);
    }
  }
}
