import type { I18n } from '../services/I18n';
import { CARDS, RULES, stats, TICKS_PER_SEC, UNIT, type BattleState, type Building } from '../sim';
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
  /** UI-10: the hand's place; the cards are drawn by Hand (src/ui/hand.ts). */
  readonly hand: HTMLElement;
  /** FX-05: big words over the field and the last 10 seconds. */
  private readonly banner: HTMLElement;
  private readonly countdown: HTMLElement;
  /** INP-04: the plate of a building. */
  private readonly plate: HTMLElement;
  /** TUT-01: the tutorial's hint line. */
  private readonly hint: HTMLElement;
  private plateTimer = 0;
  private bannerTimer = 0;
  private opponent: OpponentInfo = { name: '', kind: 'bot' };
  private shownElixir = -1;
  private field = { x: 0, y: 0, w: 0, h: 0 };

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
    this.banner = el('div', 'hud-banner');
    this.banner.hidden = true;
    this.countdown = el('div', 'hud-countdown');
    this.countdown.hidden = true;
    this.plate = el('div', 'hud-plate');
    this.plate.dataset.ui = 'plate';
    this.plate.hidden = true;
    this.hint = el('div', 'hud-hint');
    this.hint.dataset.ui = 'hint';
    this.hint.hidden = true;
    root.append(
      this.hint,
      this.header,
      this.elixir,
      this.hand,
      this.banner,
      this.countdown,
      this.plate,
    );
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
    this.field = l.field;
    place(this.hint, {
      x: l.field.x + 6,
      y: l.field.y + 4,
      w: l.field.w - 12,
      h: 96,
    });
    place(this.banner, { x: l.field.x, y: l.field.y + l.field.h * 0.4, w: l.field.w, h: 56 });
    place(this.countdown, { x: l.field.x, y: l.field.y + l.field.h * 0.3, w: l.field.w, h: 96 });
    this.hand.classList.toggle('column', l.orientation === 'landscape');
  }

  setVisible(on: boolean): void {
    this.header.hidden = !on;
    this.elixir.hidden = !on;
    this.hand.hidden = !on;
    if (!on) {
      this.banner.hidden = true;
      this.countdown.hidden = true;
      this.hint.hidden = true;
      this.info(null);
    }
  }

  /** FX-05: a big word over the field for a moment (double powder, the deciding minute). */
  showBanner(text: string): void {
    window.clearTimeout(this.bannerTimer);
    setText(this.banner, text);
    this.banner.hidden = false;
    this.banner.classList.remove('pop');
    void this.banner.offsetWidth;
    this.banner.classList.add('pop');
    this.bannerTimer = window.setTimeout(() => (this.banner.hidden = true), 1800);
  }

  /** TUT-01: a short hint line over the player's half (null hides it). */
  say(text: string | null): void {
    this.hint.hidden = text === null;
    if (text !== null) setText(this.hint, text);
  }

  /** FX-03: the crown flies into the header — the side's counter pops. */
  crownPop(side: 0 | 1): void {
    const n = side === 0 ? this.crownsBlue : this.crownsRed;
    n.classList.remove('pop');
    void n.offsetWidth;
    n.classList.add('pop');
  }

  /** INP-04: name, hit points, damage, stars and range of a building (null hides it). */
  info(b: Building | null): void {
    window.clearTimeout(this.plateTimer);
    if (!b) {
      this.plate.hidden = true;
      return;
    }
    const t = this.i18n;
    const st = stats(b.kind, b.level, b.stars);
    const name =
      b.kind === 'keep' || b.kind === 'tower'
        ? t.t(`building.${b.kind}`)
        : t.t(`card.${b.kind}.name`);
    const rows: string[] = [
      `${t.t('plate.hp')}: ${String(Math.ceil(b.hp / UNIT))} / ${String(b.maxHp / UNIT)}`,
    ];
    if (st.dmg > 0) {
      rows.push(`${t.t('plate.dmg')}: ${String(st.dmg / UNIT)}`);
      const range = b.kind === 'keep' || b.kind === 'tower' ? st.range : CARDS[b.kind].range;
      rows.push(`${t.t('plate.range')}: ${String(range)}`);
    }
    const title = el('div', 'hud-plate-title');
    title.textContent = `${name}${b.stars > 1 ? ` ${'★'.repeat(b.stars)}` : ''}`;
    const side = el('div', `hud-plate-side ${b.side === 0 ? 'blue' : 'red'}`);
    side.textContent = t.t(b.side === 0 ? 'plate.yours' : 'plate.enemy');
    const body = el('div', 'hud-plate-body');
    body.textContent = rows.join(' · ');
    this.plate.replaceChildren(title, side, body);
    place(this.plate, { x: this.field.x + 8, y: this.field.y + 8, w: this.field.w - 16, h: 72 });
    this.plate.hidden = false;
    this.plateTimer = window.setTimeout(() => (this.plate.hidden = true), 3000);
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
    // FX-05: the last 10 seconds count down over the field.
    const last = s.phase !== 'ended' && left <= 10 && left > 0;
    this.countdown.hidden = !last;
    if (last) setText(this.countdown, String(left));
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
