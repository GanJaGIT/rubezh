/**
 * ART-02: the field sprites. `npm run art` rasterises art/sprites/*.svg into one atlas
 * (src/assets/atlas.png + atlas.json, TexturePacker JSON Hash) and measures the visible part of
 * every frame (atlas-bounds.json). The DOM shows the same SVG files by URL.
 */

import type Phaser from 'phaser';
import atlasBounds from '../assets/atlas-bounds.json';
import atlasJson from '../assets/atlas.json';
import atlasPng from '../assets/atlas.png';

/** Phaser texture key of the atlas; frames are named after the SVG files. */
export const ATLAS = 'art';

/** The visible part of a frame, in shares of its width and height. */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
const FULL: Bounds = { x: 0, y: 0, w: 1, h: 1 };
export const frameBounds = (key: string): Bounds =>
  (atlasBounds as Record<string, Bounds>)[key] ?? FULL;

/** Queues the atlas; the field scene calls it in preload(). */
export function loadArt(scene: Phaser.Scene): void {
  scene.load.atlas(ATLAS, atlasPng, atlasJson);
}

const svgs = import.meta.glob<string>('../../art/sprites/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** The same pictures for the DOM (cards, windows): <img src="…">. */
export function spriteUrl(name: string): string {
  return svgs[`../../art/sprites/${name}.svg`] ?? '';
}
