import Phaser from 'phaser';
import { FieldScene } from './FieldScene';

/** Device pixels per CSS pixel, capped to keep the canvas affordable on phones (PERF-03). */
export function pixelRatio(): number {
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}

/**
 * TECH-02: Phaser draws only the game field, under the DOM interface. The canvas has device
 * pixels and is shown at CSS size (zoom 1/dpr), so the field stays crisp on phones; the scene
 * world is in CSS pixels (camera zoom = dpr). Input goes through DOM Pointer Events, Phaser
 * input is off (one path for touch, mouse and pen; the interface cannot "punch through").
 */
export function createGame(
  parent: HTMLElement,
  onFirstFrame: () => void,
): { game: Phaser.Game; scene: FieldScene } {
  const scene = new FieldScene(onFirstFrame);
  const game = new Phaser.Game({
    // PERF-04: Phaser 4 still has the Canvas renderer, so AUTO falls back to it without WebGL.
    type: Phaser.AUTO,
    parent,
    // No console banner: it carries an external URL (BLD-03) and clutters the console.
    banner: false,
    transparent: true,
    disableContextMenu: true,
    scale: { mode: Phaser.Scale.NONE, width: 2, height: 2 },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    // Sound is switched on only by AudioService, after the first touch (YG-05, SND-03): Phaser
    // would create its audio context at load and browsers warn about it.
    audio: { noAudio: true },
    scene: [scene],
  });
  return { game, scene };
}

/** UI-15: the canvas follows the active area. */
export function resizeGame(
  game: Phaser.Game,
  scene: FieldScene,
  width: number,
  height: number,
): void {
  const dpr = pixelRatio();
  game.scale.resize(Math.round(width * dpr), Math.round(height * dpr));
  game.scale.setZoom(1 / dpr);
  scene.resize(width, height, dpr);
}
