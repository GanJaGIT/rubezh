import { icon } from './icons';

/** ART-02: the interface icons used in code (art/ui/*.svg). */
export const ICONS = {
  pause: icon('pause'),
  gear: icon('gear'),
  cup: icon('cup'),
  bag: icon('bag'),
  coin: icon('coin'),
  star: icon('star'),
  crown: icon('crown'),
  gem: icon('gem'),
  video: icon('video'),
  lock: icon('lock'),
} as const;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  html = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (html) node.innerHTML = html;
  return node;
}

/**
 * Writes text only when it changed. WebKit loses a click when the node under the finger is
 * rewritten between press and release (a lesson of the first game): never rewrite every frame.
 */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function place(node: HTMLElement, r: { x: number; y: number; w: number; h: number }): void {
  node.style.left = `${r.x}px`;
  node.style.top = `${r.y}px`;
  node.style.width = `${r.w}px`;
  node.style.height = `${r.h}px`;
}
