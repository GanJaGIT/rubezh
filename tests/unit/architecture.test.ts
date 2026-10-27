import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Rules from CLAUDE.md «Архитектура» that are easy to break silently — each of them broke at
 * least once in the first two games. A failing test here names the file.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sources = walk(SRC)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({
    path: relative(ROOT, f).split(sep).join('/'),
    text: readFileSync(f, 'utf8'),
  }));

const offenders = (re: RegExp, files = sources): string[] =>
  files.filter((f) => re.test(f.text)).map((f) => f.path);

describe('architecture', () => {
  it('finds the sources', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it('TECH-12: no Cyrillic in src/**/*.ts — texts live in src/i18n/*.json', () => {
    expect(offenders(/[Ѐ-ӿ]/)).toEqual([]);
  });

  it('TECH-11: YaGames and ysdk only in src/platform', () => {
    const outside = sources.filter((f) => !f.path.startsWith('src/platform/'));
    expect(offenders(/\b(?:YaGames|ysdk)\b/, outside)).toEqual([]);
  });

  it('TECH-10, SIM-43: src/sim and src/meta are pure and deterministic', () => {
    const sim = sources.filter((f) => /^src\/(?:sim|meta)\//.test(f.path));
    expect(offenders(/Math\.random|\bDate\b|\bwindow\b|\bdocument\b|performance\./, sim)).toEqual(
      [],
    );
    expect(offenders(/from\s+['"](?:phaser|[./]+\/(?:platform|ui|game|services)\b)/, sim)).toEqual(
      [],
    );
  });

  it('UI-09: no alert, confirm, prompt or new tabs', () => {
    expect(offenders(/\b(?:alert|confirm|prompt)\s*\(|window\.open\s*\(/)).toEqual([]);
  });

  it('INP-05: keyboard by event.code only', () => {
    expect(offenders(/\b(?:e|ev|evt|event|key(?:board)?Event)\.key\b/)).toEqual([]);
  });

  it('TECH-04: no absolute URLs in the game code', () => {
    expect(offenders(/https?:\/\//)).toEqual([]);
  });

  it('YG-03: GameplayAPI start/stop only through GameplayState', () => {
    const others = sources.filter(
      (f) => !f.path.startsWith('src/platform/') && f.path !== 'src/services/gameplay-state.ts',
    );
    expect(offenders(/\.gameplay(?:Start|Stop)\s*\(/, others)).toEqual([]);
  });

  it('YG-05, SND-03: only AudioService makes sound', () => {
    const others = sources.filter((f) => f.path !== 'src/services/audio.ts');
    expect(
      offenders(/\bAudioContext\b|new\s+Audio\s*\(|\.sound\.(?:play|add)\s*\(/, others),
    ).toEqual([]);
  });

  it('YG-02: LoadingAPI.ready() is called from one place', () => {
    const calls = sources.flatMap((f) =>
      (f.text.match(/\.gameReady\s*\(/g) ?? []).map(() => f.path),
    );
    expect(calls).toEqual(['src/main.ts']);
  });

  it('YG-10: no timers next to the fullscreen ad call (ads only after a button)', () => {
    const ads = sources.filter((f) => /\.interstitial\s*\(/.test(f.text));
    for (const f of ads) {
      for (const m of f.text.matchAll(/\.interstitial\s*\(/g)) {
        const around = f.text.slice(Math.max(0, (m.index ?? 0) - 400), (m.index ?? 0) + 200);
        expect(/setInterval|setTimeout/.test(around), f.path).toBe(false);
      }
    }
  });
});
