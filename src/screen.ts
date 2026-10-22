import { Matrix4 } from 'three';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import type { ScreenFrame } from './cabinet';
import type { Game } from './games';

const DEFAULT_PX_W = 1440;
const FILL = 0.98;
// Keeps CSS3D coordinates in px-like magnitudes (world units are metres).
export const CSS_SCALE = 1000;

export class ScreenPanel {
  readonly object: CSS3DObject;
  private readonly iframe: HTMLIFrameElement;
  private loaded = false;
  private wantsFocus = false;

  constructor(readonly game: Game, frame: ScreenFrame, onEscape: () => void) {
    const pxW = game.viewportWidth ?? DEFAULT_PX_W;
    const el = document.createElement('div');
    el.className = 'screen-panel';
    el.style.width = `${pxW}px`;
    el.style.height = `${Math.round((pxW * frame.height) / frame.width)}px`;

    this.iframe = document.createElement('iframe');
    this.iframe.title = game.title;
    this.iframe.allow = 'autoplay; fullscreen; gamepad';

    const cover = document.createElement('div');
    cover.className = 'screen-cover';
    cover.innerHTML = `<b></b><span>INSERT COIN</span>`;
    cover.querySelector('b')!.textContent = game.title;
    // Ignores the synthetic about:blank load fired before src is set.
    this.iframe.addEventListener('load', () => {
      if (!this.loaded) return;
      cover.classList.add('hidden');
      // Only reachable when the game is same-origin; cross-origin keydown can't be observed.
      try {
        this.iframe.contentWindow?.addEventListener('keydown', (ev) => {
          if (ev.key === 'Escape') onEscape();
        });
      } catch {
        /* cross-origin */
      }
      if (this.wantsFocus) this.focus();
    });

    el.append(this.iframe, cover);
    this.object = new CSS3DObject(el);
    this.object.position.copy(frame.center).multiplyScalar(CSS_SCALE);
    this.object.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.normal));
    this.object.scale.setScalar(((frame.width * FILL) / pxW) * CSS_SCALE);
    this.setInteractive(false);
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.iframe.src = this.game.url;
  }

  setInteractive(on: boolean): void {
    this.object.element.style.pointerEvents = on ? 'auto' : 'none';
    this.wantsFocus = on;
    if (!on) this.iframe.blur();
  }

  focus(): void {
    this.iframe.focus();
    this.iframe.contentWindow?.focus();
  }
}
