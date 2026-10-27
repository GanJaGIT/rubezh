import { el } from './dom';

/**
 * A short note at the top of the screen ("New record!", "Purchase done"). Never blocks touches,
 * and never covers a window (req. 1.10.3): while one is open the note waits and shows after it.
 */
export class Toast {
  private readonly node: HTMLElement;
  private timer = 0;
  private readonly waiting: { text: string; image: string | null; ms: number }[] = [];

  constructor(
    root: HTMLElement,
    private readonly blocked: () => boolean = () => false,
  ) {
    this.node = el('div', 'toast');
    this.node.dataset.ui = 'toast';
    this.node.hidden = true;
    root.appendChild(this.node);
  }

  show(text: string, image: string | null = null, ms = 2200): void {
    if (this.blocked()) {
      this.waiting.push({ text, image, ms });
      return;
    }
    window.clearTimeout(this.timer);
    this.node.replaceChildren();
    if (image) {
      const img = el('img', 'toast-image');
      img.src = image;
      img.alt = '';
      this.node.appendChild(img);
    }
    const span = el('span');
    span.textContent = text;
    this.node.appendChild(span);
    this.node.hidden = false;
    this.timer = window.setTimeout(() => {
      this.node.hidden = true;
      this.flush();
    }, ms);
  }

  /** A window closed: the waiting notes show one by one. */
  flush(): void {
    if (!this.node.hidden || this.blocked()) return;
    const next = this.waiting.shift();
    if (next) this.show(next.text, next.image, next.ms);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.node.hidden = true;
  }
}
