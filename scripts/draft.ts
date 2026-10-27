// §9: npm run draft — the texts of the Yandex Games draft from docs/store.json (kept in git) into
// release/draft-<lang>.md, with the length of every field, checked against the console limits
// and requirements 5.1.3, 5.3, 5.11, 6.5, 8.2.2: lengths (also with CRLF line breaks, the way a
// browser form may count them), banned words, fields repeating each other, the title equal to
// the game's own title in src/i18n/<lang>.json, the keys "How to play" must mention.
// Exits with 1 when a check fails.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

interface Store {
  title: string;
  seo: string;
  short: string;
  about: string;
  howto: string;
  keywords: string;
  tags: string[];
  categories: string[];
}

interface StoreFile {
  /** Keys and buttons "How to play" must mention in every language (2.2). */
  howtoKeys: string[];
  langs: Record<string, Store>;
}

const file = JSON.parse(readFileSync('docs/store.json', 'utf8')) as StoreFile;
const store = file.langs;
const len = (s: string): number => [...s].length;
const problems: string[] = [];

/** Words that mislead or are banned in store texts (8.2.2, 6.5). */
// \b does not see Cyrillic letters, so word edges there are look-arounds over \p{L}.
const BANNED = /(?<!\p{L})(бесплатн|лучш|топ(?!\p{L}))|\b(free|best|top)\b|№\s?1|#1/iu;

const LABELS: Record<string, Record<keyof Store, string>> = {
  ru: {
    title: 'Название',
    seo: 'Описание для SEO',
    short: 'Короткое описание',
    about: 'Об игре',
    howto: 'Как играть',
    keywords: 'Ключевые слова',
    tags: 'Теги',
    categories: 'Категории',
  },
  en: {
    title: 'Title',
    seo: 'SEO description',
    short: 'Short description',
    about: 'About the game',
    howto: 'How to play',
    keywords: 'Keywords',
    tags: 'Tags',
    categories: 'Categories',
  },
};

/** Sentences of a text, for the "fields do not repeat each other" check (5.11). */
const sentences = (s: string): string[] =>
  s
    .split(/(?<=[.!?:])\s+|\n+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => len(x) >= 25);

for (const [lang, t] of Object.entries(store)) {
  const check = (ok: boolean, what: string): void => {
    if (!ok) problems.push(`${lang}: ${what}`);
  };
  check(len(t.title) <= 50, 'title is longer than 50');
  // 5.1.3: the same name in the game, on the cover and in the draft of every language.
  const dict = JSON.parse(readFileSync(`src/i18n/${lang}.json`, 'utf8')) as Record<string, string>;
  check(dict['game.title'] === t.title, `title differs from game.title in src/i18n/${lang}.json`);
  check(/^\p{Lu}/u.test(t.title) && t.title !== t.title.toUpperCase(), 'title case');
  check(!/игр[аы]|\bgame\b/i.test(t.title), 'title has "игра"/"game"');
  check(len(t.seo) >= 50 && len(t.seo) <= 160, 'SEO description is not 50-160');
  check(len(t.short) <= 70, 'short description is longer than 70');
  check(len(t.about) >= 100 && len(t.about) <= 1000, '"about" is not 100-1000');
  check(len(t.howto) >= 100 && len(t.howto) <= 1000, '"how to play" is not 100-1000');
  // A form may count a line break as two characters: keep the margin.
  const crlf = (x: string): number => len(x) + x.split('\n').length - 1;
  check(crlf(t.about) <= 1000, '"about" is over 1000 with CRLF line breaks');
  check(crlf(t.howto) <= 1000, '"how to play" is over 1000 with CRLF line breaks');
  check(len(t.keywords) <= 100, 'keywords are longer than 100');
  check(t.keywords === t.keywords.toLowerCase(), 'keywords are not lower case');
  check(t.tags.length <= 20, 'more than 20 tags');
  check(t.categories.length >= 1 && t.categories.length <= 2, 'categories are not 1-2');
  for (const key of file.howtoKeys) check(t.howto.includes(key), `"how to play" misses ${key}`);
  for (const [k, v] of Object.entries(t)) {
    const text = Array.isArray(v) ? v.join(' ') : String(v);
    check(!BANNED.test(text), `${k} has a banned word`);
  }
  const fields = ['seo', 'short', 'about', 'howto'] as const;
  for (const a of fields)
    for (const b of fields) {
      if (a >= b) continue;
      const shared = sentences(t[a]).filter((s) => t[b].toLowerCase().includes(s));
      check(shared.length === 0, `${a} and ${b} repeat: ${shared.join(' | ')}`);
    }
  check(t.seo.toLowerCase() !== t.short.toLowerCase(), 'SEO and short are the same');
}

mkdirSync('release', { recursive: true });
for (const [lang, t] of Object.entries(store)) {
  const L = LABELS[lang] ?? LABELS.en;
  if (!L) continue;
  const limit: Record<string, string> = {
    title: '≤ 50',
    seo: '50–160',
    short: '≤ 70',
    about: '100–1000',
    howto: '100–1000',
    keywords: '≤ 100',
  };
  const out: string[] = [
    `# ${lang === 'ru' ? 'Черновик Яндекс Игр — русский' : 'Yandex Games draft — English'}`,
    '',
    lang === 'ru'
      ? 'Число символов посчитано `npm run draft` (с пробелами и переносами строк). Текст каждого поля — в блоке ниже, копируйте целиком.'
      : 'Lengths are counted by `npm run draft` (spaces and line breaks included). Copy each block as a whole.',
    '',
  ];
  for (const key of ['title', 'seo', 'short', 'about', 'howto', 'keywords'] as const) {
    out.push(
      `## ${L[key]} — ${String(len(t[key]))} (${limit[key] ?? ''})`,
      '',
      '```text',
      t[key],
      '```',
      '',
    );
  }
  out.push(
    `## ${L.tags} — ${String(t.tags.length)} (≤ 20)`,
    '',
    t.tags.map((x) => `- ${x}`).join('\n'),
    '',
  );
  out.push(
    `## ${L.categories} — ${String(t.categories.length)} (≤ 2)`,
    '',
    t.categories.map((x) => `- ${x}`).join('\n'),
    '',
    lang === 'ru'
      ? 'Теги и категории выбираются из списков консоли: возьмите ближайшие по смыслу.'
      : 'Tags and categories are picked from the console lists: take the closest ones.',
    '',
  );
  writeFileSync(`release/draft-${lang}.md`, out.join('\n'));
  console.log(`draft: release/draft-${lang}.md`);
  console.log(
    `  title ${String(len(t.title))}, seo ${String(len(t.seo))}, short ${String(len(t.short))}, about ${String(len(t.about))}, howto ${String(len(t.howto))}, keywords ${String(len(t.keywords))}, tags ${String(t.tags.length)}, categories ${String(t.categories.length)}`,
  );
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('draft — OK');
