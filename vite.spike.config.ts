import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * ST-01: the async multiplayer probe — spike/ built on its own into dist-spike/ (relative paths,
 * lower-case file names, ES2020) and packed by scripts/spike.ts. It never mixes with the game.
 */
const lower = (name: string): string => name.toLowerCase().replace(/[^a-z0-9._-]/g, '-');

export default defineConfig({
  root: fileURLToPath(new URL('./spike', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist-spike', import.meta.url)),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    modulePreload: false,
    rolldownOptions: {
      output: {
        hashCharacters: 'hex',
        entryFileNames: (chunk) => `assets/${lower(chunk.name)}-[hash].js`,
        chunkFileNames: (chunk) => `assets/${lower(chunk.name)}-[hash].js`,
        assetFileNames: (asset) =>
          `assets/${lower((asset.names[0] ?? 'asset').replace(/\.[^.]*$/, ''))}-[hash][extname]`,
      },
    },
  },
});
