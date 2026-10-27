/**
 * ST-01: `npm run spike` builds the async multiplayer probe (spike/ → dist-spike/) and packs it
 * into release/spike-<date>.zip with index.html at the root, checked by the same rules as the
 * game archive (BLD-02, BLD-03): names, no external URLs, /sdk.js before the page code.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, zipSync, type Zippable } from 'fflate';
import { ALLOWED_URL_PREFIXES, isExcluded, NAME_RE, ROOT, TEXT_EXT } from './build-rules';

const root = fileURLToPath(ROOT);
const dist = join(root, 'dist-spike');

const build = spawnSync('npx vite build --config vite.spike.config.ts', {
  cwd: root,
  shell: true,
  stdio: 'inherit',
});
if (build.status !== 0 || !existsSync(join(dist, 'index.html'))) {
  console.error('spike: the build failed.');
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const problems: string[] = [];
const files: Zippable = {};
for (const full of walk(dist)) {
  const path = relative(dist, full).split(sep).join('/');
  if (isExcluded(path)) continue;
  if (!path.split('/').every((part) => NAME_RE.test(part))) problems.push(`name: ${path}`);
  const data = readFileSync(full);
  if (TEXT_EXT.some((ext) => path.endsWith(ext))) {
    for (const m of strFromU8(data).matchAll(/https?:\/\/[^\s"'`)<>\\]*/g)) {
      if (!ALLOWED_URL_PREFIXES.some((p) => m[0].startsWith(p))) problems.push(`${path}: ${m[0]}`);
    }
  }
  files[path] = [data, { level: 9 }];
}
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const sdkAt = html.search(/<script[^>]*\ssrc="\/sdk\.js"/);
const moduleAt = html.search(/<script[^>]*type="module"/);
if (sdkAt < 0 || (moduleAt >= 0 && moduleAt < sdkAt)) problems.push('/sdk.js must come first');

if (problems.length > 0) {
  console.error(`spike: ${problems.join('\n  ')}`);
  process.exit(1);
}
const date = new Date().toISOString().slice(0, 10);
mkdirSync(join(root, 'release'), { recursive: true });
const out = join(root, 'release', `spike-${date}.zip`);
const zipped = zipSync(files);
writeFileSync(out, zipped);
console.log(
  `spike: ${relative(root, out)} — ${String(Object.keys(files).length)} files, ${(zipped.length / 1024).toFixed(1)} KB`,
);
console.log('spike: upload it to a separate draft and follow START.md (ST-02).');
