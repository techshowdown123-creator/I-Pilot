import type { Candidate, PilotState, Point, Rect } from '../types';
import type { OverlayTarget } from '../targets/resolver';
import { toRect } from '../targets/resolver';
import { OVERLAY_CSS } from './styles';

const ICONS: Record<string, string> = {
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  kbd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
};

export interface ChooserItem {
  label: string;
  sub?: string;
  tone?: 'primary' | 'danger' | 'muted';
  number?: number;
  onPick: () => void;
}

export type ToolbarAction = 'pause' | 'scrollUp' | 'scrollDown' | 'back' | 'keyboard';

export interface OverlayOptions {
  toolbar?: boolean;
  onToolbar?: (a: ToolbarAction) => void;
}

/** Stage 8 (feedback half): all I-Pilot visuals live in one shadow root so page CSS can't touch them. */
export class Overlay {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  private layer: HTMLElement;
  private hl: HTMLElement;
  private alts: HTMLElement[] = [];
  private gaze: HTMLElement;
  private ring: HTMLElement;
  private ringFg: SVGCircleElement;
  private status: HTMLElement;
  private toastEl: HTMLElement;
  private toolbarEl: HTMLElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private modal: HTMLElement | null = null;
  private keyboardEl: HTMLElement | null = null;
  private kbdPreview: HTMLElement | null = null;
  private tracked: { c: Candidate; el: HTMLElement; off?: Rect }[] = [];
  private raf = 0;
  private toastTimer = 0;
  modalKind: 'chooser' | 'confirm' | null = null;

  constructor(private doc: Document = document, private opts: OverlayOptions = {}) {
    this.host = doc.createElement('ipilot-overlay');
    this.host.setAttribute('aria-hidden', 'false');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = OVERLAY_CSS;
    this.root.appendChild(style);
    this.layer = this.div('layer');
    this.root.appendChild(this.layer);
    this.hl = this.div('hl');
    this.hl.style.display = 'none';
    this.layer.appendChild(this.hl);
    this.gaze = this.div('gaze');
    this.gaze.style.display = 'none';
    this.layer.appendChild(this.gaze);
    this.ring = this.div('ring');
    this.ring.innerHTML = '<svg viewBox="0 0 54 54" width="54" height="54"><circle class="bg" cx="27" cy="27" r="22"/><circle class="fg" cx="27" cy="27" r="22" stroke-dasharray="138.2" stroke-dashoffset="138.2"/></svg>';
    this.ringFg = this.ring.querySelector('.fg') as SVGCircleElement;
    this.ring.style.display = 'none';
    this.layer.appendChild(this.ring);
    this.status = this.div('status');
    this.layer.appendChild(this.status);
    this.toastEl = this.div('toast');
    this.layer.appendChild(this.toastEl);
    if (opts.toolbar !== false) this.buildToolbar();
    (doc.body ?? doc.documentElement).appendChild(this.host);
    const tick = () => {
      this.updateTracked();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.host.remove();
  }

  private div(cls: string): HTMLElement {
    const d = this.doc.createElement('div');
    d.className = cls;
    return d;
  }

  private button(cls: string, html: string, onClick: () => void, label: string): HTMLButtonElement {
    const b = this.doc.createElement('button');
    b.className = cls;
    b.innerHTML = html;
    b.setAttribute('aria-label', label);
    b.dataset.label = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private buildToolbar(): void {
    const tb = this.div('toolbar');
    const act = (a: ToolbarAction) => () => this.opts.onToolbar?.(a);
    this.pauseBtn = this.button('tbtn keep', ICONS.pause + '<span>Pause</span>', act('pause'), 'Pause I-Pilot');
    tb.append(
      this.pauseBtn,
      this.button('tbtn', ICONS.up + '<span>Scroll up</span>', act('scrollUp'), 'Scroll up'),
      this.button('tbtn', ICONS.down + '<span>Scroll down</span>', act('scrollDown'), 'Scroll down'),
      this.button('tbtn', ICONS.back + '<span>Back</span>', act('back'), 'Go back'),
    );
    this.toolbarEl = tb;
    this.layer.appendChild(tb);
  }

  setUserPaused(paused: boolean): void {
    if (!this.pauseBtn) return;
    this.pauseBtn.innerHTML = (paused ? ICONS.play + '<span>Resume</span>' : ICONS.pause + '<span>Pause</span>');
    this.pauseBtn.dataset.label = paused ? 'Resume I-Pilot' : 'Pause I-Pilot';
    this.pauseBtn.classList.toggle('on', paused);
    this.toolbarEl?.classList.toggle('collapsed', paused);
  }

  setToolbarVisible(v: boolean): void {
    if (this.toolbarEl) this.toolbarEl.style.display = v ? '' : 'none';
  }

  /** Interactive overlay elements that gaze can select right now. */
  targets(userPaused: boolean): OverlayTarget[] {
    let els: HTMLElement[];
    if (userPaused) els = this.pauseBtn ? [this.pauseBtn] : [];
    else if (this.modal) els = Array.from(this.modal.querySelectorAll<HTMLElement>('.tile'));
    else if (this.keyboardEl) els = Array.from(this.keyboardEl.querySelectorAll<HTMLElement>('.key'));
    else els = [];
    if (!userPaused && !this.modal && this.toolbarEl && this.toolbarEl.style.display !== 'none') {
      els = els.concat(Array.from(this.toolbarEl.querySelectorAll<HTMLElement>('.tbtn')));
    }
    return els
      .filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
      .map((el, i) => ({ el, key: `ov:${el.dataset.label ?? i}:${i}`, label: el.dataset.label ?? el.textContent ?? '', rect: toRect(el.getBoundingClientRect()) }));
  }

  /** True when only overlay targets should be selectable (modal / keyboard). */
  get exclusive(): boolean {
    return !!this.modal || !!this.keyboardEl;
  }

  // ---------- highlight ----------

  setHighlight(c: Candidate | null, opts: { state: PilotState; alternatives?: Candidate[]; raw?: boolean }): void {
    for (const a of this.alts) a.remove();
    this.alts = [];
    this.tracked = [];
    if (!c) {
      this.hl.style.display = 'none';
      return;
    }
    this.hl.style.display = '';
    this.hl.className = 'hl' + (opts.state === 'PAUSED' ? ' paused' : '') + (c.dangerous ? ' danger' : '') + (opts.raw ? ' raw' : '');
    this.hl.innerHTML = '';
    const alternatives = opts.alternatives ?? [];
    if (alternatives.length) {
      const badge = this.div('badge');
      badge.textContent = '1';
      this.hl.appendChild(badge);
    }
    this.track(c, this.hl);
    alternatives.forEach((a, i) => {
      const el = this.div('hl alt');
      const badge = this.div('badge');
      badge.textContent = String(i + 2);
      el.appendChild(badge);
      this.layer.insertBefore(el, this.hl);
      this.alts.push(el);
      this.track(a, el);
    });
    this.updateTracked();
  }

  private track(c: Candidate, el: HTMLElement): void {
    let off: Rect | undefined;
    if (c.kind === 'grid' || c.kind === 'overlay') {
      // Grid cells are fixed offsets inside their element.
      const r = c.el.getBoundingClientRect();
      off = { left: c.rect.left - r.left, top: c.rect.top - r.top, right: c.rect.right - r.left, bottom: c.rect.bottom - r.top };
    }
    this.tracked.push({ c, el, off });
  }

  private updateTracked(): void {
    for (const t of this.tracked) {
      let r: Rect;
      if (!t.c.el.isConnected) {
        t.el.style.display = 'none';
        continue;
      }
      const er = t.c.el.getBoundingClientRect();
      if (t.off) r = { left: er.left + t.off.left, top: er.top + t.off.top, right: er.left + t.off.right, bottom: er.top + t.off.bottom };
      else if (t.c.el.ownerDocument !== this.doc) r = t.c.rect; // same-origin iframe: keep landing-time rect
      else r = toRect(er);
      const pad = 4;
      t.el.style.left = r.left - pad + 'px';
      t.el.style.top = r.top - pad + 'px';
      t.el.style.width = r.right - r.left + pad * 2 + 'px';
      t.el.style.height = r.bottom - r.top + pad * 2 + 'px';
    }
  }

  setGaze(p: Point | null, asCursor = false): void {
    if (!p || !Number.isFinite(p.x)) {
      this.gaze.style.display = 'none';
      return;
    }
    this.gaze.style.display = '';
    this.gaze.className = 'gaze' + (asCursor ? ' cursor' : '');
    this.gaze.style.left = p.x + 'px';
    this.gaze.style.top = p.y + 'px';
  }

  /** Dwell / blink progress ring at point p (fraction 0..1, null hides). */
  setProgress(p: Point | null, fraction: number | null, mode: 'dwell' | 'blink' = 'dwell', armed = false): void {
    if (!p || fraction === null) {
      this.ring.style.display = 'none';
      return;
    }
    this.ring.style.display = '';
    this.ring.className = 'ring ' + mode + (armed ? ' armed' : '');
    this.ring.style.left = p.x + 'px';
    this.ring.style.top = p.y + 'px';
    this.ringFg.setAttribute('stroke-dashoffset', String(138.2 * (1 - Math.min(1, Math.max(0, fraction)))));
  }

  setStatus(text: string | null, tone: 'ok' | 'paused' | 'locked' = 'ok'): void {
    if (!text) {
      this.status.className = 'status hidden';
      return;
    }
    this.status.className = 'status ' + tone;
    this.status.innerHTML = '<span class="dot"></span>';
    this.status.appendChild(this.doc.createTextNode(text));
  }

  toast(text: string, warn = false): void {
    this.toastEl.textContent = text;
    this.toastEl.className = 'toast show' + (warn ? ' warn' : '');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.className = 'toast'), 1400);
  }

  // ---------- modals ----------

  showChooser(title: string, subtitle: string, items: ChooserItem[], onCancel: () => void, kind: 'chooser' | 'confirm' = 'chooser'): void {
    this.hideModal();
    const m = this.div('modal');
    const h = this.doc.createElement('h2');
    h.textContent = title;
    m.appendChild(h);
    if (subtitle) {
      const p = this.doc.createElement('p');
      p.textContent = subtitle;
      m.appendChild(p);
    }
    const tiles = this.div('tiles');
    const close = (fn: () => void) => () => {
      this.hideModal();
      fn();
    };
    for (const it of items) {
      const html = (it.number ? `<span class="num">${it.number}</span>` : '') + `<span></span>` + (it.sub ? '<small></small>' : '');
      const b = this.button('tile' + (it.tone ? ' ' + it.tone : ''), html, close(it.onPick), it.label);
      (b.querySelector('span:not(.num)') as HTMLElement).textContent = it.label;
      if (it.sub) (b.querySelector('small') as HTMLElement).textContent = it.sub;
      tiles.appendChild(b);
    }
    tiles.appendChild(this.button('tile muted', '<span>Cancel</span>', close(onCancel), 'Cancel'));
    m.appendChild(tiles);
    this.modal = m;
    this.modalKind = kind;
    this.layer.appendChild(m);
  }

  hideModal(): void {
    this.modal?.remove();
    this.modal = null;
    this.modalKind = null;
  }

  showKeyboard(initial: string, onKey: (k: string) => void, onDone: () => void): void {
    this.hideKeyboard();
    const k = this.div('kbd');
    const prev = this.div('preview');
    prev.textContent = initial || ' ';
    k.appendChild(prev);
    this.kbdPreview = prev;
    const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
    for (const r of rows) {
      const row = this.div('row');
      for (const ch of r) row.appendChild(this.button('key', ch, () => onKey(ch), ch));
      k.appendChild(row);
    }
    const last = this.div('row');
    last.append(
      this.button('key action', '⌫', () => onKey('Backspace'), 'Backspace'),
      this.button('key', '@', () => onKey('@'), '@'),
      this.button('key wide', 'space', () => onKey(' '), 'Space'),
      this.button('key', '.', () => onKey('.'), '.'),
      this.button('key done', 'Done', () => onDone(), 'Done'),
    );
    k.appendChild(last);
    this.keyboardEl = k;
    this.layer.appendChild(k);
  }

  setKeyboardPreview(text: string): void {
    if (this.kbdPreview) this.kbdPreview.textContent = text || ' ';
  }

  hideKeyboard(): void {
    this.keyboardEl?.remove();
    this.keyboardEl = null;
    this.kbdPreview = null;
  }

  get keyboardOpen(): boolean {
    return !!this.keyboardEl;
  }

  /** Full-screen layer used by calibration. */
  createCalibrationLayer(): HTMLElement {
    const c = this.div('calib');
    this.layer.appendChild(c);
    return c;
  }
}
