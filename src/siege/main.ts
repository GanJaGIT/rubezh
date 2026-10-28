/**
 * The siege prototype page (siege.html): the battle against a bot, with its own small interface.
 * Not wired into the game yet (docs/DESIGN-v2.md, section 8); no platform, saves or sound.
 */

import Phaser from 'phaser';
import '@fontsource/nunito/cyrillic-800.css';
import '@fontsource/nunito/cyrillic-900.css';
import '@fontsource/nunito/latin-800.css';
import './siege.css';
import { baseKey, headKey } from './art';
import { botActions, type BotLevel } from './bot';
import { FIELD_H, FIELD_W, SiegeScene, type Geo } from './scene';
import {
  BKINDS,
  canMerge,
  canPlay,
  CELLS,
  CONTENT,
  createSiege,
  hornCost,
  stats,
  stepSiege,
  TICK_MS,
  type Action,
  type BKind,
  type Branch,
  type SiegeEvent,
  type SiegeState,
} from './sim';
import T from './text.json';

const TOP = 52;
const BOTTOM = 188;
const DECK: BKind[] = BKINDS.filter((k) => k !== 'tesla');

const ui = document.getElementById('ui') as HTMLElement;
const host = document.getElementById('field') as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = '',
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  parent?.appendChild(n);
  return n;
}

const dpr = (): number => Math.min(3, Math.max(1, window.devicePixelRatio || 1));

let st: SiegeState | null = null;
let level: BotLevel = 'normal';
let queue: Action[] = [];
let acc = 0;
let paused = false;
const icons: Record<string, string> = {};
let selected = -1;

const scene = new SiegeScene(() => {
  for (const key of [baseKey(1), baseKey(3)]) icons[key] = game.textures.getBase64(key);
  for (const k of BKINDS) {
    for (const key of [headKey(k, 1, 0), headKey(k, 3, 1), headKey(k, 3, 2), headKey(k, 2, 0)]) {
      try {
        icons[key] = game.textures.getBase64(key);
      } catch {
        icons[key] = '';
      }
    }
  }
  layout();
  showStart();
});
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: host,
  banner: false,
  transparent: true,
  disableContextMenu: true,
  scale: { mode: Phaser.Scale.NONE, width: 2, height: 2 },
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  audio: { noAudio: true },
  scene: [scene],
});

// ---------------------------------------------------------------------------------------------
// HUD

const top = el('div', 'top', '', ui);
const foeName = el('div', 'who', '', top);
const foeBar = el('div', 'bar foe', '', top);
const foeFill = el('i', '', '', foeBar);
const foeHp = el('b', '', '', foeBar);
const wavePill = el('div', 'wave', '', top);
const pauseBtn = el('button', 'icon', 'II', top);

const bottom = el('div', 'bottom', '', ui);
const meRow = el('div', 'me', '', bottom);
const meBar = el('div', 'bar mine', '', meRow);
const meFill = el('i', '', '', meBar);
const meHp = el('b', '', '', meBar);
const ore = el('div', 'ore', '', meRow);
const hand = el('div', 'hand', '', bottom);
const actions = el('div', 'actions', '', bottom);
const rerollBtn = el('button', 'act', '', actions);
const hornBtn = el('button', 'act horn', '', actions);
const abilityBtn = el('button', 'act ability', '', actions);
const toasts = el('div', 'toasts', '', ui);
const ghost = el('img', 'ghost', '', ui);
ghost.hidden = true;

let handSig = '';
const cards: HTMLElement[] = [];

function renderHand(): void {
  if (!st) return;
  const s = st.sides[0];
  const sig = s.hand.join(',');
  if (sig !== handSig) {
    handSig = sig;
    hand.textContent = '';
    cards.length = 0;
    s.hand.forEach((k, i) => {
      const c = el('div', `card k-${k}`, '', hand);
      const under = el('img', 'base', '', c);
      under.src = icons[baseKey(1)] ?? '';
      under.draggable = false;
      const img = el('img', '', '', c);
      img.src = icons[headKey(k, 1, 0)] ?? '';
      img.draggable = false;
      el('span', 'name', T.kinds[k].name, c);
      el('span', 'cost', String(CONTENT.buildings[k].cost), c);
      el('span', 'key', String(i + 1), c);
      c.addEventListener('pointerdown', (e) => startCardDrag(i, e));
      cards.push(c);
    });
  }
  cards.forEach((c, i) => {
    const k = s.hand[i];
    c.classList.toggle('poor', s.ore < CONTENT.buildings[k].cost);
    c.classList.toggle('selected', selected === i);
  });
}

function updateHud(): void {
  if (!st) return;
  const [me, foe] = st.sides;
  const max = CONTENT.gateHp;
  meFill.style.width = `${String((100 * Math.max(0, me.gate)) / max)}%`;
  foeFill.style.width = `${String((100 * Math.max(0, foe.gate)) / max)}%`;
  meHp.textContent = `${T.you}: ${String(Math.max(0, me.gate))}`;
  foeHp.textContent = String(Math.max(0, foe.gate));
  ore.textContent = String(me.ore);
  const left = Math.max(0, Math.ceil(((st.nextWave - st.tick) * TICK_MS) / 1000));
  wavePill.innerHTML = `<b>${T.wave} ${String(st.wave)}</b><small>${String(left)} c ${T.next}</small>`;
  rerollBtn.innerHTML = `${T.reroll}<small>${String(CONTENT.reroll)}</small>`;
  rerollBtn.disabled = me.ore < CONTENT.reroll;
  const hc = hornCost(me);
  hornBtn.innerHTML = `${T.horn}<small>${String(hc)}</small>`;
  hornBtn.disabled = me.ore < hc || me.hornT > 0;
  hornBtn.style.setProperty('--cd', String(me.hornT / CONTENT.horn.cd));
  const cd = me.hero.abilityT / CONTENT.hero.abilityCd;
  abilityBtn.innerHTML = `${T.ability}<small>${cd > 0 ? String(Math.ceil((me.hero.abilityT * TICK_MS) / 1000)) : 'Q'}</small>`;
  abilityBtn.disabled = cd > 0;
  abilityBtn.style.setProperty('--cd', String(cd));
  renderHand();
}

function toast(text: string, cls = ''): void {
  while (toasts.children.length >= 2) toasts.firstElementChild?.remove();
  const t = el('div', `toast ${cls}`, text, toasts);
  setTimeout(() => t.remove(), 1800);
}

function onEvents(ev: SiegeEvent[]): void {
  for (const e of ev) {
    if (e.type === 'wave')
      toast(
        e.boss ? `${T.wave} ${String(e.wave)}: ${T.boss}` : `${T.wave} ${String(e.wave)}`,
        e.boss ? 'boss' : '',
      );
    else if (e.type === 'shadow' && e.side === 0) toast(T.shadow, 'bad');
    else if (e.type === 'horn' && e.side === 1) toast(T.hornIn, 'bad');
    else if (e.type === 'last-stand' && e.side === 0) toast(T.lastStand, 'boss');
    else if (e.type === 'ended') setTimeout(showResult, 900);
  }
}

// ---------------------------------------------------------------------------------------------
// Layout and clock

function layout(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const d = dpr();
  game.scale.resize(Math.round(w * d), Math.round(h * d));
  game.scale.setZoom(1 / d);
  scene.setDpr(d);
  const avail = h - TOP - BOTTOM - 6;
  const mine = Math.min((w - 12) / FIELD_W, (avail * 0.6) / FIELD_H);
  const foe = Math.min(((w - 12) / FIELD_W) * 0.9, (avail - mine * FIELD_H) / FIELD_H);
  const slack = Math.max(0, avail - (mine + foe) * FIELD_H);
  const geos: Geo[] = [
    {
      cx: w / 2,
      cy: TOP + foe * FIELD_H + slack / 2 + 6 + (mine * FIELD_H) / 2,
      px: mine,
      flip: false,
    },
    { cx: w / 2, cy: TOP + slack / 2 + (foe * FIELD_H) / 2, px: foe, flip: true },
  ];
  scene.setGeo(geos);
  ui.style.setProperty('--panel', `${String(Math.min(w, 560))}px`);
}
window.addEventListener('resize', layout);

function stepOnce(s: SiegeState): void {
  const list = [...queue, ...botActions(s, 1, level)];
  queue = [];
  scene.beforeStep();
  const ev = stepSiege(s, list);
  scene.feed(ev);
  onEvents(ev);
}

scene.onFrame = (dt) => {
  if (!st || paused || st.result) return;
  acc += Math.min(dt, 300);
  let n = 0;
  while (acc >= TICK_MS && n < 6) {
    stepOnce(st);
    acc -= TICK_MS;
    n++;
  }
  if (n === 6) acc = 0;
  scene.alpha = acc / TICK_MS;
  updateHud();
};

function setPaused(on: boolean): void {
  paused = on;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && st && !st.result) showPause();
});
window.addEventListener('blur', () => {
  if (st && !st.result) showPause();
});

function start(lv: BotLevel): void {
  level = lv;
  closeWindows();
  st = createSiege({ seed: (Date.now() & 0x7fffffff) >>> 0, decks: [DECK, DECK] });
  scene.setState(st);
  queue = [];
  acc = 0;
  handSig = '';
  selected = -1;
  foeName.textContent = T.levels[lv];
  paused = false;
  updateHud();
}

// ---------------------------------------------------------------------------------------------
// Input

type Drag =
  | { kind: 'card'; slot: number; moved: boolean; x0: number; y0: number }
  | { kind: 'building'; cell: number; moved: boolean; x0: number; y0: number };
let drag: Drag | null = null;

function cellUnder(x: number, y: number): number {
  return scene.cellAt(scene.toField(0, x, y));
}

function markCard(slot: number): void {
  if (!st) return;
  const ok = new Set<number>();
  const merge = new Set<number>();
  for (let c = 0; c < CELLS; c++) {
    if (!canPlay(st, 0, slot, c)) continue;
    ok.add(c);
    if (st.sides[0].cells[c]) merge.add(c);
  }
  scene.marks = { ok, merge, from: -1 };
}

function startCardDrag(slot: number, e: PointerEvent): void {
  e.preventDefault();
  if (!st || st.result || paused) return;
  drag = { kind: 'card', slot, moved: false, x0: e.clientX, y0: e.clientY };
  markCard(slot);
  ghost.src = icons[headKey(st.sides[0].hand[slot], 1, 0)] ?? '';
}

host.addEventListener('pointerdown', (e) => {
  if (!st || st.result || paused) return;
  const p = scene.toField(0, e.clientX, e.clientY);
  const cell = scene.cellAt(p);
  if (selected >= 0) {
    if (cell >= 0 && canPlay(st, 0, selected, cell)) {
      queue.push({ type: 'play', side: 0, slot: selected, cell });
    }
    selected = -1;
    scene.marks = null;
    return;
  }
  const b = cell >= 0 ? st.sides[0].cells[cell] : null;
  if (b) {
    drag = { kind: 'building', cell, moved: false, x0: e.clientX, y0: e.clientY };
    const merge = new Set<number>();
    for (let c = 0; c < CELLS; c++) if (canMerge(st, 0, cell, c)) merge.add(c);
    scene.marks = { ok: new Set(), merge, from: cell };
    ghost.src = icons[headKey(b.kind, Math.min(b.tier, 2), 0)] ?? '';
    return;
  }
  queue.push({ type: 'move', side: 0, x: p.x, y: p.y });
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 10) {
    drag.moved = true;
    ghost.hidden = false;
  }
  if (drag.moved) {
    ghost.style.transform = `translate(${String(e.clientX - 36)}px, ${String(e.clientY - 60)}px)`;
  }
});

window.addEventListener('pointerup', (e) => {
  const d = drag;
  drag = null;
  ghost.hidden = true;
  if (!d || !st) return;
  const cell = cellUnder(e.clientX, e.clientY - (d.moved ? 24 : 0));
  if (d.kind === 'card') {
    if (!d.moved) {
      // A tap on a card selects it; the next tap on a cell plays it.
      selected = selected === d.slot ? -1 : d.slot;
      if (selected >= 0) markCard(selected);
      else scene.marks = null;
      return;
    }
    scene.marks = null;
    if (cell >= 0 && canPlay(st, 0, d.slot, cell)) {
      queue.push({ type: 'play', side: 0, slot: d.slot, cell });
    }
    return;
  }
  scene.marks = null;
  if (!d.moved) {
    showPlate(d.cell);
    return;
  }
  if (cell >= 0 && canMerge(st, 0, d.cell, cell)) {
    const target = st.sides[0].cells[cell];
    if (target && target.tier === 2) showBranch(d.cell, cell, target.kind);
    else queue.push({ type: 'merge', side: 0, from: d.cell, to: cell });
  }
});

window.addEventListener('keydown', (e) => {
  if (!st || st.result) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (selected >= 0) {
      selected = -1;
      scene.marks = null;
    } else if (paused) closeWindows();
    else showPause();
    return;
  }
  if (paused) return;
  const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
  if (n >= 0) {
    selected = selected === n ? -1 : n;
    if (selected >= 0) markCard(selected);
    else scene.marks = null;
  }
  if (e.code === 'KeyQ' || e.code === 'Space') queue.push({ type: 'ability', side: 0 });
  if (e.code === 'KeyR') queue.push({ type: 'reroll', side: 0 });
  if (e.code === 'KeyE') queue.push({ type: 'horn', side: 0 });
});

rerollBtn.addEventListener('click', () => queue.push({ type: 'reroll', side: 0 }));
hornBtn.addEventListener('click', () => queue.push({ type: 'horn', side: 0 }));
abilityBtn.addEventListener('click', () => queue.push({ type: 'ability', side: 0 }));
pauseBtn.addEventListener('click', () => showPause());

// ---------------------------------------------------------------------------------------------
// Windows

let win: HTMLElement | null = null;

function closeWindows(): void {
  win?.remove();
  win = null;
  setPaused(false);
}

function open(cls: string, pause: boolean): HTMLElement {
  win?.remove();
  const back = el('div', `back ${cls}`, '', ui);
  win = back;
  if (pause) setPaused(true);
  return el('div', 'win', '', back);
}

function button(parent: HTMLElement, text: string, cls: string, on: () => void): HTMLElement {
  const b = el('button', `btn ${cls}`, text, parent);
  b.addEventListener('click', on);
  return b;
}

function showStart(): void {
  const w = open('start', true);
  el('h1', '', T.title, w);
  el('p', 'tag', T.tagline, w);
  const ul = el('ul', 'how', '', w);
  for (const line of T.how) el('li', '', line, ul);
  const row = el('div', 'row', '', w);
  (['easy', 'normal', 'hard'] as BotLevel[]).forEach((lv) => {
    button(row, T.levels[lv], lv === 'normal' ? 'gold' : '', () => start(lv));
  });
}

function showPause(): void {
  if (!st || st.result || win) return;
  const w = open('pause', true);
  el('h2', '', T.pause, w);
  const row = el('div', 'row', '', w);
  button(row, T.resume, 'gold', closeWindows);
  button(row, T.surrender, '', () => {
    closeWindows();
    queue.push({ type: 'surrender', side: 0 });
  });
}

function showBranch(from: number, to: number, kind: BKind): void {
  const w = open('branch', false);
  el('h2', '', `${T.kinds[kind].name}: ${T.chooseBranch}`, w);
  const row = el('div', 'row', '', w);
  ([1, 2] as Branch[]).forEach((br) => {
    const info = T.branches[kind][br - 1];
    const b = el('button', 'choice', '', row);
    const img = el('img', '', '', b);
    img.src = icons[headKey(kind, 3, br)] ?? '';
    el('b', '', info.name, b);
    el('span', '', info.text, b);
    b.addEventListener('click', () => {
      closeWindows();
      queue.push({ type: 'merge', side: 0, from, to, branch: br });
    });
  });
  button(w, T.close, 'small', closeWindows);
}

function showPlate(cell: number): void {
  if (!st) return;
  const b = st.sides[0].cells[cell];
  if (!b) return;
  const w = open('plate', false);
  const k = stats(b.kind, b.tier, b.branch);
  const br = b.branch ? T.branches[b.kind][b.branch - 1] : null;
  el('h2', '', `${br ? br.name : T.kinds[b.kind].name} — ${T.tier} ${String(b.tier)}`, w);
  el('p', '', br ? br.text : T.kinds[b.kind].text, w);
  if (k.attack) el('p', 'dim', `${String(k.dmg)} / ${String((k.cd * TICK_MS) / 1000)} c`, w);
  const row = el('div', 'row', '', w);
  button(row, `${T.sell} +${String(Math.floor(b.value / 2))}`, '', () => {
    closeWindows();
    queue.push({ type: 'sell', side: 0, cell });
  });
  button(row, T.close, 'gold', closeWindows);
}

function showResult(): void {
  if (!st?.result) return;
  const r = st.result;
  const me = st.sides[0];
  const w = open('result', true);
  el(
    'h1',
    r.winner === 0 ? 'victory' : '',
    r.winner === 0 ? T.win : r.winner === null ? T.draw : T.lose,
    w,
  );
  const ul = el('ul', 'stats', '', w);
  const line = (k: string, v: number): void => {
    const li = el('li', '', k, ul);
    el('b', '', String(v), li);
  };
  line(T.stats.wave, st.wave);
  line(T.stats.kills, me.kills);
  line(T.stats.merges, me.merges);
  line(T.stats.sent, me.sent);
  const row = el('div', 'row', '', w);
  button(row, T.again, 'gold', () => start(level));
  button(row, T.menu, '', showStart);
}

// DEV-02: test hooks for the prototype.
if (__DEV_HOOKS__) {
  Object.assign(window, {
    __siege: {
      state: () => st,
      paused: () => paused,
      start,
      queue: (a: Action) => queue.push(a),
      level: () => level,
      /** Runs ticks and draws a frame (the pane may have no animation frames). */
      tick: (n: number) => {
        for (let i = 0; i < n && st && !st.result; i++) stepOnce(st);
        scene.alpha = 0;
        game.step(performance.now(), 16);
        updateHud();
      },
    },
  });
}
