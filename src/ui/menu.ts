import { spriteUrl } from '../game/art';
import type { I18n } from '../services/I18n';
import type { ProgressService } from '../services/progress';
import { el, ICONS, setText } from './dom';

export interface MenuHandlers {
  play(): void;
  rating(): void;
  settings(): void;
  shop(): void;
}

/**
 * UI-02, UI-03: the main screen between battles. Stage 0: the header (trophies, gold, gems, the
 * shop behind features.iap, the leaderboard, the settings), the arena and a big "Battle". The
 * tabs (Battle, Deck, Shop, Rating, Quests) and the chests arrive in Stage 3; the header rules
 * stay: everything fits 360 px, buttons ≥ 44 px.
 */
export class Menu {
  private readonly root: HTMLElement;
  private readonly trophies: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly gems: HTMLElement;
  private readonly arena: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly playLabel: HTMLElement;
  private readonly shop: HTMLButtonElement;
  private readonly title: HTMLElement;

  constructor(
    parent: HTMLElement,
    private i18n: I18n,
    private readonly progress: ProgressService,
    handlers: MenuHandlers,
    private readonly shopEnabled: boolean,
  ) {
    this.root = el('div', 'menu');
    this.root.dataset.ui = 'menu';
    this.root.hidden = true;
    const header = el('div', 'menu-header');
    this.trophies = this.pill('menu-trophies', ICONS.cup);
    this.gold = this.pill('menu-gold', ICONS.coin);
    this.gems = this.pill('menu-gems', ICONS.gem);
    this.shop = this.iconButton('menu-shop', ICONS.bag, () => handlers.shop());
    this.shop.hidden = !shopEnabled;
    header.append(
      this.trophies,
      this.gold,
      this.gems,
      el('div', 'hud-spacer'),
      this.shop,
      this.iconButton('menu-rating', ICONS.cup, () => handlers.rating()),
      this.iconButton('menu-settings', ICONS.gear, () => handlers.settings()),
    );
    this.title = el('h1', 'menu-title');
    this.arena = el('div', 'menu-arena');
    this.arena.dataset.ui = 'menu-arena';
    const forts = el('div', 'menu-forts');
    for (const name of ['keep-blue', 'keep-red']) {
      const img = el('img');
      img.src = spriteUrl(name);
      img.alt = '';
      forts.appendChild(img);
    }
    this.play = el('button', 'menu-play');
    this.play.type = 'button';
    this.play.dataset.ui = 'menu-play';
    this.playLabel = el('span', 'menu-play-label');
    this.play.append(this.playLabel);
    this.play.addEventListener('click', () => handlers.play());
    this.root.append(header, this.title, this.arena, forts, this.play);
    parent.appendChild(this.root);
  }

  private pill(ui: string, svg: string): HTMLElement {
    const p = el('div', 'pill', svg);
    p.dataset.ui = ui;
    p.appendChild(el('span'));
    return p;
  }

  private iconButton(ui: string, svg: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'hud-button menu-icon', svg);
    b.type = 'button';
    b.dataset.ui = ui;
    b.addEventListener('click', onClick);
    return b;
  }

  visible(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  applyTexts(i18n: I18n): void {
    this.i18n = i18n;
    this.render();
  }

  render(): void {
    const t = this.i18n;
    const d = this.progress.data;
    setText(this.title, t.t('game.title'));
    for (const [node, value, key] of [
      [this.trophies, d.player.trophies, 'menu.trophies'],
      [this.gold, d.gold, 'menu.gold'],
      [this.gems, d.gems, 'menu.gems'],
    ] as const) {
      const span = node.querySelector('span');
      if (span) setText(span, String(value));
      node.setAttribute('aria-label', t.t(key));
    }
    for (const [ui, key] of [
      ['menu-shop', 'menu.shop'],
      ['menu-rating', 'menu.rating'],
      ['menu-settings', 'menu.settings'],
    ] as const) {
      this.root.querySelector(`[data-ui="${ui}"]`)?.setAttribute('aria-label', t.t(key));
    }
    setText(this.arena, t.t(`arena.${String(d.player.arena)}.name`));
    setText(this.playLabel, t.t('menu.play'));
    this.shop.hidden = !this.shopEnabled;
  }
}
