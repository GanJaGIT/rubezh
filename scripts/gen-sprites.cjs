/* eslint-disable @typescript-eslint/no-require-imports */
// ART-01, ART-02 (Stage 2): the battle sprites — dark stone, forged iron, the banners of the sides
// (blue straight, red swallowtail), angular shapes. They are generated so the style stays one.
// Usage: node scripts/gen-sprites.cjs .   → art/sprites/*.svg, then npm run art.
// Building frame: viewBox 0 0 128 168 — the bottom 128 is the cell (its centre at y = 104).
const fs = require('fs');
const path = require('path');
const out = path.join(process.argv[2], 'art', 'sprites');

const O = '#14161b'; // outline
const S = { light: '#8a8f99', base: '#5f646e', dark: '#3d414a' }; // stone
const I = { light: '#7b8088', base: '#4b4f57', dark: '#2a2d33' }; // iron
const W = { light: '#a06d42', base: '#7a4f2c', dark: '#4e321c' }; // wood
const SIDES = {
  blue: { c: '#2f6fe0', d: '#1d4594', l: '#6fa0ff' },
  red: { c: '#d8332b', d: '#8e1d18', l: '#ff7a6b' },
};
const head = (h = 168) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 ${h}" width="128" height="${h}" stroke-linejoin="round" stroke-linecap="round">`;
const shadow = (rx = 46) =>
  `<ellipse cx="64" cy="154" rx="${rx}" ry="9" fill="#000" opacity="0.32"/>`;
const poly = (pts, fill, sw = 5) =>
  `<polygon points="${pts}" fill="${fill}" stroke="${O}" stroke-width="${sw}"/>`;
const rect = (x, y, w, h, fill, sw = 5, rx = 2) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${O}" stroke-width="${sw}"/>`;
const plain = (x, y, w, h, fill, op = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" opacity="${op}"/>`;
/** Stone wall body with block seams, light left, shade right. */
function stoneBlock(x, y, w, h) {
  let s = rect(x, y, w, h, S.base);
  s += plain(x + w - w * 0.28, y + 3, w * 0.28 - 3, h - 6, S.dark, 0.85);
  s += plain(x + 3, y + 3, w * 0.18, h - 6, S.light, 0.35);
  for (let yy = y + 14; yy < y + h - 4; yy += 14) {
    s += `<line x1="${x + 3}" y1="${yy}" x2="${x + w - 3}" y2="${yy}" stroke="${O}" stroke-width="2" opacity="0.55"/>`;
    const off = ((yy - y) / 14) % 2 === 0 ? w / 3 : (2 * w) / 3;
    s += `<line x1="${x + off}" y1="${yy - 14}" x2="${x + off}" y2="${yy}" stroke="${O}" stroke-width="2" opacity="0.45"/>`;
  }
  return s;
}
/** Sharp crenellations on top of a block. */
function crenels(x, y, w, n) {
  const step = w / n;
  let s = '';
  for (let i = 0; i < n; i += 2) {
    s += poly(
      `${x + i * step},${y} ${x + i * step},${y - 9} ${x + (i + 1) * step},${y - 13} ${x + (i + 1) * step},${y}`,
      S.base,
      4,
    );
  }
  return s;
}
/** Side banner: blue — a straight cut; red — swallowtail (ACC-01: the shape differs too). */
function banner(side, x, y, h = 22, w = 16) {
  const k = SIDES[side];
  const tail =
    side === 'blue'
      ? `${x + w},${y + h} ${x + w / 2},${y + h - 6} ${x},${y + h}`
      : `${x + w},${y + h} ${x + w / 2},${y + h * 0.55} ${x},${y + h}`;
  return (
    `<polygon points="${x},${y} ${x + w},${y} ${tail}" fill="${k.c}" stroke="${O}" stroke-width="3.5"/>` +
    `<polygon points="${x + w * 0.62},${y + 2} ${x + w - 2},${y + 2} ${x + w - 2},${y + h * 0.7} ${x + w * 0.62},${y + h * 0.6}" fill="${k.d}" opacity="0.8"/>`
  );
}
function pennant(side, x, y) {
  const k = SIDES[side];
  const tip =
    side === 'blue'
      ? `${x + 26},${y + 7}`
      : `${x + 26},${y + 2} ${x + 18},${y + 7} ${x + 26},${y + 12}`;
  return (
    `<line x1="${x}" y1="${y + 24}" x2="${x}" y2="${y - 4}" stroke="${O}" stroke-width="4"/>` +
    `<polygon points="${x},${y} ${tip} ${x},${y + 14}" fill="${k.c}" stroke="${O}" stroke-width="3.5"/>`
  );
}
const spikes = (x, y, w, n, fill = I.base) => {
  let s = '';
  const step = w / n;
  for (let i = 0; i < n; i++)
    s += poly(
      `${x + i * step},${y} ${x + (i + 0.5) * step},${y - 10} ${x + (i + 1) * step},${y}`,
      fill,
      3,
    );
  return s;
};

const B = {};
B.keep = (side) => {
  let s = shadow(56);
  s += stoneBlock(18, 92, 92, 60) + crenels(18, 92, 92, 9);
  s += poly('48,152 48,126 64,114 80,126 80,152', I.dark, 4.5);
  s += `<line x1="56" y1="122" x2="56" y2="151" stroke="${I.light}" stroke-width="2"/><line x1="64" y1="118" x2="64" y2="151" stroke="${I.light}" stroke-width="2"/><line x1="72" y1="122" x2="72" y2="151" stroke="${I.light}" stroke-width="2"/>`;
  for (const tx of [6, 92])
    s += stoneBlock(tx, 62, 30, 90) + poly(`${tx - 4},64 ${tx + 15},34 ${tx + 34},64`, I.base, 5);
  s += stoneBlock(44, 50, 40, 52) + crenels(44, 50, 40, 5);
  s +=
    rect(58, 64, 12, 18, '#0b0c0f', 3, 1) +
    `<rect x="61" y="67" width="6" height="12" fill="#ffb347" opacity="0.85"/>`;
  s += banner(side, 22, 100, 26, 16) + banner(side, 90, 100, 26, 16);
  s += pennant(side, 64, 18) + pennant(side, 21, 22) + pennant(side, 107, 22);
  return s;
};
B.tower = (side) => {
  let s = shadow(38);
  s += stoneBlock(38, 76, 52, 76) + crenels(36, 76, 56, 7);
  s +=
    rect(56, 98, 16, 22, '#0b0c0f', 3, 1) +
    `<rect x="60" y="102" width="8" height="15" fill="#ffb347" opacity="0.8"/>`;
  s += banner(side, 41, 124, 22, 14);
  s += pennant(side, 64, 40);
  return s;
};
B.wall = (side) => {
  let s = shadow(50);
  s += stoneBlock(12, 104, 104, 46) + crenels(12, 104, 104, 9);
  s += spikes(16, 150, 96, 8, I.dark);
  s += banner(side, 56, 112, 20, 16);
  return s;
};
B.watch = (side) => {
  let s = shadow(30);
  for (const [x1, x2] of [
    [42, 54],
    [86, 74],
  ])
    s += `<line x1="${x1}" y1="150" x2="${x2}" y2="74" stroke="${O}" stroke-width="9"/><line x1="${x1}" y1="150" x2="${x2}" y2="74" stroke="${W.base}" stroke-width="5"/>`;
  s += `<line x1="46" y1="126" x2="82" y2="102" stroke="${O}" stroke-width="7"/><line x1="46" y1="126" x2="82" y2="102" stroke="${W.dark}" stroke-width="3"/>`;
  s += rect(40, 58, 48, 22, W.base, 5, 2) + spikes(40, 58, 48, 6, W.dark);
  s += poly('36,58 64,26 92,58', SIDES[side].c, 5);
  s += pennant(side, 64, 6);
  return s;
};
B.banner = (side) => {
  let s = shadow(22);
  s +=
    rect(54, 132, 20, 20, S.base, 4) +
    `<line x1="64" y1="134" x2="64" y2="22" stroke="${O}" stroke-width="7"/><line x1="64" y1="134" x2="64" y2="22" stroke="${I.light}" stroke-width="3"/>`;
  s += poly('64,8 70,22 58,22', '#e0b23a', 3);
  s += banner(side, 68, 30, 64, 40).replace('stroke-width="3.5"', 'stroke-width="4.5"');
  s += `<path d="M78 52 l10 8 l10 -8 l-4 18 l-12 0 z" fill="#e0b23a" stroke="${O}" stroke-width="3"/>`;
  return s;
};
B.archers = (side) => {
  let s = shadow(40);
  s += stoneBlock(28, 92, 72, 60) + crenels(26, 92, 76, 7);
  for (const x of [44, 64, 84])
    s += `<rect x="${x - 3}" y="104" width="6" height="18" fill="#0b0c0f"/>`;
  s +=
    rect(36, 56, 56, 38, W.base, 5) +
    `<line x1="36" y1="72" x2="92" y2="72" stroke="${O}" stroke-width="2.5"/>`;
  s += poly('30,58 64,30 98,58', SIDES[side].c, 5);
  s += `<path d="M46 66 q-12 -18 0 -36" fill="none" stroke="${O}" stroke-width="5"/><line x1="46" y1="30" x2="46" y2="66" stroke="${I.light}" stroke-width="2"/>`;
  s += pennant(side, 64, 10);
  return s;
};
B.cannon = (side) => {
  let s = shadow(48);
  s += poly('16,152 22,112 106,112 112,152', S.base, 5) + plain(80, 116, 26, 33, S.dark, 0.8);
  s += rect(30, 84, 60, 32, W.base, 5, 4);
  s += `<rect x="58" y="44" width="26" height="62" rx="9" transform="rotate(-28 71 75)" fill="${I.base}" stroke="${O}" stroke-width="6"/>`;
  s += `<rect x="62" y="48" width="8" height="54" rx="4" transform="rotate(-28 71 75)" fill="${I.light}" opacity="0.6"/>`;
  s += `<circle cx="96" cy="49" r="9" fill="#0b0c0f" stroke="${O}" stroke-width="3"/>`;
  for (const cx of [38, 82])
    s += `<circle cx="${cx}" cy="116" r="15" fill="${W.dark}" stroke="${O}" stroke-width="5"/><circle cx="${cx}" cy="116" r="5" fill="${I.light}" stroke="${O}" stroke-width="2"/>`;
  s += banner(side, 22, 124, 20, 14);
  return s;
};
B.workshop = (side) => {
  let s = shadow(48);
  s += stoneBlock(18, 98, 92, 54);
  s += poly('12,100 64,60 116,100', SIDES[side].c, 5);
  s +=
    rect(80, 54, 16, 36, S.dark, 4) +
    `<circle cx="88" cy="40" r="9" fill="#555" opacity="0.6"/><circle cx="98" cy="26" r="12" fill="#555" opacity="0.45"/>`;
  s +=
    rect(46, 116, 36, 36, '#0b0c0f', 4, 2) +
    `<rect x="50" y="122" width="28" height="30" fill="#ff8a2a" opacity="0.85"/><rect x="56" y="130" width="16" height="22" fill="#ffd36b"/>`;
  s += `<g transform="translate(34 118)"><circle r="11" fill="${I.base}" stroke="${O}" stroke-width="4"/><circle r="4" fill="${I.dark}"/></g>`;
  return s;
};
B.outpost = (side) => {
  let s = shadow(34);
  for (let i = 0; i < 6; i++) {
    const x = 30 + i * 12;
    s += poly(
      `${x},152 ${x},${92 + (i % 2) * 8} ${x + 5},${82 + (i % 2) * 8} ${x + 10},${92 + (i % 2) * 8} ${x + 10},152`,
      W.base,
      4,
    );
  }
  s += `<line x1="26" y1="122" x2="102" y2="122" stroke="${O}" stroke-width="6"/><line x1="26" y1="122" x2="102" y2="122" stroke="${W.dark}" stroke-width="2"/>`;
  s += `<line x1="64" y1="122" x2="64" y2="26" stroke="${O}" stroke-width="5"/>`;
  s += banner(side, 66, 30, 40, 26);
  s += `<circle cx="64" cy="22" r="6" fill="#ffb347" stroke="${O}" stroke-width="3"/>`;
  return s;
};
B.healer = (side) => {
  let s = shadow(36);
  s += stoneBlock(30, 96, 68, 56);
  s += poly('24,98 64,52 104,98', S.dark, 5);
  s += rect(54, 112, 20, 40, '#0b0c0f', 3, 2);
  s += `<path d="M58 66 h12 v12 h12 v12 h-12 v12 h-12 v-12 h-12 v-12 h12 z" fill="#3fd17a" stroke="${O}" stroke-width="4" transform="translate(0 -20) scale(1)"/>`;
  s += banner(side, 34, 104, 20, 14) + banner(side, 80, 104, 20, 14);
  return s;
};
B.mortar = (side) => {
  let s = shadow(44);
  s +=
    poly('20,152 28,116 100,116 108,152', S.base, 5) +
    plain(80, 120, 24, 30, S.dark, 0.8) +
    crenels(28, 116, 72, 7);
  s += `<path d="M38 116 q26 -78 52 0 z" fill="${I.dark}" stroke="${O}" stroke-width="5"/>`;
  s += `<ellipse cx="64" cy="62" rx="20" ry="9" fill="#0b0c0f" stroke="${O}" stroke-width="5"/>`;
  s += `<path d="M46 98 q18 -38 36 0" fill="none" stroke="${I.light}" stroke-width="3" opacity="0.6"/>`;
  s += banner(side, 34, 124, 18, 13);
  return s;
};
B.ballista = (side) => {
  let s = shadow(44);
  s +=
    rect(30, 118, 68, 34, W.base, 5, 3) +
    `<line x1="34" y1="135" x2="94" y2="135" stroke="${O}" stroke-width="2"/>`;
  s += `<line x1="64" y1="122" x2="64" y2="36" stroke="${O}" stroke-width="12"/><line x1="64" y1="122" x2="64" y2="36" stroke="${W.light}" stroke-width="6"/>`;
  s += `<path d="M16 86 q48 -40 96 0" fill="none" stroke="${O}" stroke-width="9"/><path d="M16 86 q48 -40 96 0" fill="none" stroke="${I.base}" stroke-width="4"/>`;
  s += `<line x1="16" y1="86" x2="64" y2="104" stroke="${O}" stroke-width="2.5"/><line x1="112" y1="86" x2="64" y2="104" stroke="${O}" stroke-width="2.5"/>`;
  s += poly('64,20 72,40 56,40', I.light, 4);
  s += banner(side, 36, 124, 20, 14);
  return s;
};
B.ice = (side) => {
  let s = shadow(34);
  s += stoneBlock(38, 96, 52, 56);
  s +=
    poly('64,18 86,60 78,96 50,96 42,60', '#9fe3ff', 5) +
    poly('64,18 86,60 78,96 64,96', '#5bb8e6', 0);
  s += `<line x1="64" y1="18" x2="64" y2="96" stroke="#e8fbff" stroke-width="3" opacity="0.7"/>`;
  s += poly('40,70 28,54 46,58', '#bdeeff', 3) + poly('88,70 100,54 82,58', '#bdeeff', 3);
  s += banner(side, 42, 104, 20, 14);
  return s;
};
B.dome = (side) => {
  let s = shadow(48);
  s += rect(18, 122, 92, 30, S.base, 5) + plain(84, 126, 22, 23, S.dark, 0.8);
  s += `<path d="M22 124 a42 50 0 0 1 84 0 z" fill="${I.base}" stroke="${O}" stroke-width="5"/>`;
  s += `<path d="M34 120 a30 40 0 0 1 30 -36" fill="none" stroke="${I.light}" stroke-width="4" opacity="0.7"/>`;
  for (const a of [-50, -20, 10, 40])
    s += `<line x1="64" y1="124" x2="${64 + Math.sin((a * Math.PI) / 180) * 42}" y2="${124 - Math.cos((a * Math.PI) / 180) * 50}" stroke="${O}" stroke-width="2" opacity="0.6"/>`;
  s += pennant(side, 64, 50);
  return s;
};
B.catapult = (side) => {
  let s = shadow(50);
  s += rect(20, 112, 88, 22, W.base, 5, 3);
  for (const cx of [34, 94])
    s += `<circle cx="${cx}" cy="138" r="14" fill="${W.dark}" stroke="${O}" stroke-width="5"/><circle cx="${cx}" cy="138" r="4" fill="${I.light}"/>`;
  s += poly('40,112 64,62 88,112', 'none', 6);
  s += `<line x1="52" y1="112" x2="98" y2="28" stroke="${O}" stroke-width="11"/><line x1="52" y1="112" x2="98" y2="28" stroke="${W.light}" stroke-width="5"/>`;
  s += `<path d="M88 20 q14 -2 18 12 q-12 6 -22 -4 z" fill="${W.dark}" stroke="${O}" stroke-width="4"/><circle cx="98" cy="22" r="8" fill="${S.base}" stroke="${O}" stroke-width="3"/>`;
  s += banner(side, 24, 116, 18, 14);
  return s;
};

// Card art of the spells (for the hand) — square 128×128.
const SPELLS = {
  fireball: () =>
    `${head(128)}<circle cx="64" cy="64" r="44" fill="#ff7a1a" stroke="${O}" stroke-width="6"/><path d="M64 26 q22 20 10 40 q16 -6 14 -24 q22 30 -2 52 q-24 18 -46 -2 q-18 -20 0 -44 q2 16 12 20 q-6 -24 12 -42z" fill="#ffd34d" stroke="${O}" stroke-width="4"/><circle cx="62" cy="76" r="12" fill="#fff3b0"/></svg>\n`,
  repair: () =>
    `${head(128)}<rect x="22" y="58" width="84" height="18" rx="3" transform="rotate(-40 64 67)" fill="${W.base}" stroke="${O}" stroke-width="6"/><path d="M78 18 l26 26 l-12 12 l-8 -8 l-10 10 l-10 -10 l10 -10 l-8 -8z" fill="${I.base}" stroke="${O}" stroke-width="5"/><path d="M30 92 h14 v-14 h12 v14 h14 v12 h-14 v14 h-12 v-14 h-14z" fill="#3fd17a" stroke="${O}" stroke-width="4"/></svg>\n`,
  quake: () =>
    `${head(128)}<rect x="12" y="74" width="104" height="36" rx="4" fill="${S.base}" stroke="${O}" stroke-width="6"/><path d="M20 74 l18 18 l-6 18 M62 74 l-8 16 l12 20 M94 74 l10 14 l-12 22" fill="none" stroke="${O}" stroke-width="5"/><path d="M30 60 l10 -22 l10 22 M56 54 l8 -34 l8 34 M80 60 l10 -22 l10 22" fill="#ffb347" stroke="${O}" stroke-width="4"/></svg>\n`,
};

// Projectiles and effects (square 64 units, drawn small).
const FX = {
  'shot-arrow': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><line x1="10" y1="32" x2="50" y2="32" stroke="${O}" stroke-width="7" stroke-linecap="round"/><line x1="10" y1="32" x2="50" y2="32" stroke="${W.light}" stroke-width="3"/><polygon points="58,32 46,24 46,40" fill="${I.light}" stroke="${O}" stroke-width="3"/><polygon points="8,32 2,24 14,32 2,40" fill="#e8e8e8" stroke="${O}" stroke-width="2"/></svg>\n`,
  'shot-ball': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="18" fill="${I.dark}" stroke="${O}" stroke-width="5"/><circle cx="25" cy="25" r="6" fill="${I.light}" opacity="0.7"/></svg>\n`,
  'shot-stone': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><polygon points="14,30 24,12 46,14 54,34 40,52 18,48" fill="${S.base}" stroke="${O}" stroke-width="5"/><polygon points="24,16 44,18 36,28 22,28" fill="${S.light}" opacity="0.6"/></svg>\n`,
  'shot-bolt': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><line x1="4" y1="32" x2="52" y2="32" stroke="${O}" stroke-width="9" stroke-linecap="round"/><line x1="4" y1="32" x2="52" y2="32" stroke="${W.base}" stroke-width="4"/><polygon points="62,32 48,22 48,42" fill="${I.light}" stroke="${O}" stroke-width="3"/></svg>\n`,
  'shot-shard': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><polygon points="58,32 30,20 8,32 30,44" fill="#9fe3ff" stroke="${O}" stroke-width="4"/><line x1="12" y1="32" x2="54" y2="32" stroke="#e8fbff" stroke-width="3"/></svg>\n`,
  'fx-dust': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><circle cx="32" cy="32" r="22" fill="#c9b79a"/><circle cx="24" cy="26" r="9" fill="#e6d8be" opacity="0.8"/></svg>\n`,
  'fx-brick': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect x="10" y="20" width="44" height="24" rx="3" fill="${S.base}" stroke="${O}" stroke-width="5"/><rect x="14" y="24" width="14" height="6" fill="${S.light}" opacity="0.7"/></svg>\n`,
  'fx-fire': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><path d="M32 4 q18 18 12 32 q8 -4 8 -14 q12 24 -8 36 q-14 8 -26 -2 q-14 -14 -2 -32 q2 10 8 12 q-6 -18 8 -32z" fill="#ff7a1a"/><path d="M32 26 q10 10 6 20 q-6 8 -14 2 q-6 -8 8 -22z" fill="#ffd34d"/></svg>\n`,
  'fx-star': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><polygon points="32,4 39,24 60,24 43,37 50,58 32,45 14,58 21,37 4,24 25,24" fill="#ffcf3a" stroke="${O}" stroke-width="4"/><polygon points="32,10 36,24 28,24" fill="#fff3b0"/></svg>\n`,
};

// Tiles: muted grass and trodden earth — no candy green.
function tile(base, blade, dirt) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><rect width="128" height="128" fill="${base}"/>` +
    `<path d="M14 30 l4 -10 l4 10 M70 20 l4 -10 l4 10 M96 82 l4 -10 l4 10 M30 98 l4 -10 l4 10 M58 62 l4 -10 l4 10" stroke="${blade}" stroke-width="3" fill="none" stroke-linejoin="miter"/>` +
    `<circle cx="100" cy="30" r="4" fill="${dirt}"/><circle cx="20" cy="70" r="3" fill="${dirt}"/><circle cx="82" cy="112" r="5" fill="${dirt}"/></svg>\n`
  );
}

const files = {};
for (const side of Object.keys(SIDES)) {
  for (const [kind, fn] of Object.entries(B))
    files[`${kind}-${side}.svg`] = `${head()}${fn(side)}</svg>\n`;
}
for (const [k, fn] of Object.entries(SPELLS)) files[`spell-${k}.svg`] = fn();
for (const [k, svg] of Object.entries(FX)) files[`${k}.svg`] = svg;
files['tile-a.svg'] = tile('#4f7a3c', '#3c6030', '#6b5a3c');
files['tile-b.svg'] = tile('#486f37', '#36572b', '#64533a');
fs.mkdirSync(out, { recursive: true });
for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(out, name), svg);
console.log(`${Object.keys(files).length} sprites → ${out}`);
