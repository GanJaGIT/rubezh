/**
 * Checks the machine and the project before long work: Node, git, packages, Playwright browsers,
 * the ffmpeg binary (npm 11 may leave it half-downloaded), and whether the template is filled in.
 *
 *   npm run doctor
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BROWSERS_PATH } from './browsers-path';

type Result = 'ok' | 'warn' | 'fail';
const results: Result[] = [];
const mark: Record<Result, string> = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL' };

function report(result: Result, what: string, hint = ''): void {
  results.push(result);
  console.log(`${mark[result]} ${what}${hint ? `\n       → ${hint}` : ''}`);
}

// Node
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
report(
  major > 22 || (major === 22 && minor >= 12) ? 'ok' : 'fail',
  `Node ${process.versions.node}`,
  major < 22 ? 'install Node LTS (22.12 or newer) from nodejs.org' : '',
);

// git
const git = spawnSync('git', ['--version'], { encoding: 'utf8', shell: true });
report(
  git.status === 0 ? 'ok' : 'fail',
  git.status === 0 ? git.stdout.trim() : 'git',
  git.status === 0 ? '' : 'install Git from git-scm.com',
);

// packages
const hasModules = existsSync('node_modules/phaser') && existsSync('node_modules/vite');
report(hasModules ? 'ok' : 'fail', 'node_modules', hasModules ? '' : 'npm ci --prefer-offline');

// Playwright browsers in ~/.cache/ms-playwright
const installed = existsSync(BROWSERS_PATH) ? readdirSync(BROWSERS_PATH) : [];
const missing = ['chromium', 'firefox', 'webkit'].filter(
  (b) => !installed.some((d) => d.startsWith(`${b}-`)),
);
report(
  missing.length === 0 ? 'ok' : 'fail',
  `Playwright browsers in ${BROWSERS_PATH}`,
  missing.length ? `missing ${missing.join(', ')}: npm run e2e:install` : '',
);

// ffmpeg (promo video)
if (hasModules) {
  const require = createRequire(import.meta.url);
  let ffmpeg = '';
  try {
    ffmpeg = require('ffmpeg-static') as string;
  } catch {
    // reported below
  }
  const runs =
    ffmpeg !== '' &&
    existsSync(ffmpeg) &&
    spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' }).status === 0;
  const size = ffmpeg && existsSync(ffmpeg) ? statSync(ffmpeg).size : 0;
  report(
    runs ? 'ok' : 'fail',
    `ffmpeg-static (${(size / 1e6).toFixed(0)} MB)`,
    runs ? '' : 'node node_modules/ffmpeg-static/install.js (the binary is broken or missing)',
  );
}

// the template filled in
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string };
if (pkg.name === 'yg-starter') {
  report('warn', 'this is the template itself', 'npm run new-game -- <Folder> makes a new game');
} else {
  const files = ['docs/TZ.md', 'docs/art-style.md', 'CLAUDE.md'];
  const left = files.flatMap((f) =>
    existsSync(f) ? (readFileSync(f, 'utf8').match(/\{\{[A-Z0-9_]+\}\}/g) ?? []) : [],
  );
  report(
    left.length === 0 ? 'ok' : 'warn',
    `placeholders in ${files.join(', ')}: ${String(left.length)}`,
    left.length ? `fill them: /new-game (first: ${left.slice(0, 3).join(', ')})` : '',
  );
}

const failed = results.filter((r) => r === 'fail').length;
console.log(failed ? `\n${String(failed)} problem(s).` : '\nAll set.');
process.exit(failed ? 1 : 0);
