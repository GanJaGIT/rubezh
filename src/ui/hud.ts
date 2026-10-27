import type { I18n } from '../services/I18n';
import { RULES, TICKS_PER_SEC, UNIT, type BattleState } from '../sim';
import { el, ICONS, place, setText } from './dom';
import type { Layout } from './layout';

export interface HudHandlers {
  pause(): void;
}

/** OPP-01, OPP-03: who the opponent is — a battle record of a player or a bot. */
export interface OpponentInfo {
  name: string;
  kind: 'record' | 'bot';
}

/**
 * UI-10: the battle interface over the field — the header (pause, opponent, crowns, timer), the
 * elixir bar and the hand. Writes to the DOM only when a value changed (setText): rewriting under
 * the finger loses clicks in WebKit. CSS animates only transform (PERF-03).
 */
export class Hud {
  private readonly header: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly opponentName: HTMLElement;
  private readonly opponentKind: HTMLElement;
  private readonly crowns: HTMLElement;
  private readonly crownsBlue: HTMLElement;
  private readonly crownsRed: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly elixir: HTMLElement;
  private readonly elixirFills: HTMLElement[] = [];
  private readonly hand: HTMLElement;
  private opponent: OpponentInfo = { name: '', kind: 'bot' };
  private shownElixir = -1;

  constructor(
    root: HTMLElement,
    private i18n: I18n,
    handlers: HudHandlers,
  ) {
    this.header = el('div', 'hud-header');
    this.header.dataset.ui = 'header';
    this.pauseBtn = el('button', 'hud-button hud-pause', ICONS.pause);
    this.pauseBtn.type = 'button';
    this.pauseBtn.dataset.ui = 'pause';
    this.pauseBtn.addEventListener('click', () => handlers.pause());
    const who = el('div', 'hud-opponent');
    who.dataset.ui = 'opponent';
    this.opponentName = el('span', 'hud-opponent-name');
    this.opponentKind = el('span', 'hud-opponent-kind');
    who.append(this.opponentName, this.opponentKind);
    this.crowns = el('div', 'hud-crowns', ICONS.crown);
    this.crowns.dataset.ui = 'crowns';
    this.crownsBlue = el('span', 'hud-crown-blue', '0');
    this.crownsRed = el('span', 'hud-crown-red', '0');
    this.crowns.append(this.crownsBlue, el('span', '', ':'), this.crownsRed);
    this.timer = el('div', 'hud-timer');
    this.timer.dataset.ui = 'timer';
    this.header.append(this.pauseBtn, who, el('div', 'hud-spacer'), this.crowns, this.timer);

    this.elixir = el('div', 'hud-elixir');
    this.elixir.dataset.ui = 'elixir';
    for (let i = 0; i < RULES.elixirMax / UNIT; i++) {
      const cell = el('div', 'hud-elixir-cell');
      const fill = el('div', 'hud-elixir-fill');
      cell.appendChild(fill);
      this.elixirFills.push(fill);
      this.elixir.appendChild(cell);
    }
    this.hand = el('div', 'hud-hand');
    this.hand.dataset.ui = 'hand';
    for (let i = 0; i < RULES.handSize; i++) this.hand.appendChild(el('div', 'hud-slot'));
    this.hand.appendChild(el('div', 'hud-slot next'));
    root.append(this.header, this.elixir, this.hand);
    this.applyTexts(i18n);
  }

  applyTexts(i18n: I18n): void {
    this.i18n = i18n;
    this.pauseBtn.setAttribute('aria-label', i18n.t('hud.pause'));
    this.crowns.setAttribute('aria-label', i18n.t('hud.crowns'));
    this.timer.setAttribute('aria-label', i18n.t('hud.timer'));
    this.elixir.setAttribute('aria-label', i18n.t('hud.elixir'));
    this.setOpponent(this.opponent);
  }

  applyLayout(l: Layout): void {
    place(this.header, l.header);
    place(this.elixir, l.elixir);
    place(this.hand, l.hand);
    this.hand.classList.toggle('column', l.orientation === 'landscape');
  }

  setVisible(on: boolean): void {
    this.header.hidden = !on;
    this.elixir.hidden = !on;
    this.hand.hidden = !on;
  }

  setOpponent(o: OpponentInfo): void {
    this.opponent = o;
    setText(this.opponentName, o.name);
    setText(
      this.opponentKind,
      this.i18n.t(o.kind === 'record' ? 'opponent.record' : 'opponent.bot'),
    );
  }

  update(s: BattleState): void {
    setText(this.crownsBlue, String(s.crowns[0]));
    setText(this.crownsRed, String(s.crowns[1]));
    // GD-01: 3:00 counts down; overtime counts its own minute.
    const overtime = s.phase === 'overtime' || s.tick > RULES.mainTicks;
    const end = overtime ? RULES.mainTicks + RULES.overtimeTicks : RULES.mainTicks;
    const left = Math.max(0, Math.ceil((end - s.tick) / TICKS_PER_SEC));
    setText(this.timer, `${String(Math.floor(left / 60))}:${String(left % 60).padStart(2, '0')}`);
    this.timer.classList.toggle('overtime', overtime);
    // GD-20: whole units are full, the next one fills up.
    const e = s.elixir[0];
    if (e === this.shownElixir) return;
    this.shownElixir = e;
    this.elixirFills.forEach((f, i) => {
      const share = Math.min(1, Math.max(0, (e - i * UNIT) / UNIT));
      f.style.transform = `scaleX(${share.toFixed(3)})`;
    });
  }
}
