import type { Point } from '../types';

/**
 * Converts between screen coordinates (what the calibrated gaze model
 * predicts) and viewport coordinates (what the DOM uses). Calibrating in screen
 * space lets one calibration survive tab switches, scrolling and moving the
 * window. The offset of the viewport inside the window (toolbar height) is
 * learned exactly from any mouse event, with a geometric fallback.
 */
class ScreenMapper {
  private learned: Point | null = null;
  private installed = false;

  install(win: Window = window): void {
    if (this.installed) return;
    this.installed = true;
    const learn = (e: MouseEvent) => {
      if (!e.isTrusted) return;
      this.learned = { x: e.screenX - e.clientX - win.screenX, y: e.screenY - e.clientY - win.screenY };
    };
    win.addEventListener('mousemove', learn, { passive: true, capture: true });
    win.addEventListener('pointerdown', learn, { passive: true, capture: true });
  }

  /** Viewport origin relative to window.screenX/Y. */
  chromeOffset(win: Window = window): Point {
    if (this.learned) return this.learned;
    const side = Math.max(0, (win.outerWidth - win.innerWidth) / 2);
    return { x: side, y: Math.max(0, win.outerHeight - win.innerHeight - side) };
  }

  toViewport(p: Point, win: Window = window): Point {
    const o = this.chromeOffset(win);
    return { x: p.x - win.screenX - o.x, y: p.y - win.screenY - o.y };
  }

  toScreen(p: Point, win: Window = window): Point {
    const o = this.chromeOffset(win);
    return { x: p.x + win.screenX + o.x, y: p.y + win.screenY + o.y };
  }
}

export const screenMapper = new ScreenMapper();
