import type { FaceFrame, GazeSample } from '../types';
import { GazeModel } from '../gaze/regression';
import { FEATURE_COUNT } from '../gaze/features';
import { nowMs } from '../time';
import { screenMapper } from './screen';

type Unsub = () => void;

/** Produces processed face frames (stages 1–2). */
export interface FrameProvider {
  subscribeFrames(fn: (f: FaceFrame) => void): Unsub;
  start(): Promise<void>;
  stop(): void;
  readonly running: boolean;
}

/** Produces gaze samples in screen coordinates (stage 3 output). */
export interface GazeProvider {
  readonly kind: 'camera' | 'mouse';
  subscribe(fn: (s: GazeSample) => void): Unsub;
  start(): Promise<void>;
  stop(): void;
  readonly running: boolean;
  /** Whether samples carry meaningful coordinates (camera: needs calibration). */
  readonly calibrated: boolean;
  /**
   * Optional implicit recalibration: the user just confirmed that between
   * `from` and `to` they were looking at `target` (screen px). Returns true if
   * the model learned from it.
   */
  learn?(target: { x: number; y: number }, from: number, to: number, opts: { closedThreshold: number; maxErrorPx: number }): boolean;
}

class Emitter<T> {
  private fns = new Set<(v: T) => void>();
  on(fn: (v: T) => void): Unsub {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v: T): void {
    for (const f of this.fns) f(v);
  }
}

/** Wraps a FrameProvider and the calibrated regression model. */
export class CameraGazeSource implements GazeProvider {
  readonly kind = 'camera' as const;
  private em = new Emitter<GazeSample>();
  private unsub: Unsub | null = null;
  /** Recent frames (≈3 s) so a confirmed selection can be turned into training data. */
  private history: FaceFrame[] = [];
  private modelListeners = new Set<(m: GazeModel) => void>();

  /** Called after the model learned from a selection (persist it here). */
  onModelChange(fn: (m: GazeModel) => void): Unsub {
    this.modelListeners.add(fn);
    return () => this.modelListeners.delete(fn);
  }

  learn(target: { x: number; y: number }, from: number, to: number, opts: { closedThreshold: number; maxErrorPx: number }): boolean {
    const m = this.model;
    if (!m || !m.canLearn || !this.calibrated) return false;
    const frames = this.history.filter((f) => f.t >= from && f.t <= to && f.faceDetected && f.features.length && (f.blinkLeft + f.blinkRight) / 2 < opts.closedThreshold);
    if (frames.length < 3) return false;
    // Reject if the model was far off: the selection was probably not where the user looked.
    const preds = frames.map((f) => m.predict(f.features));
    const mx = [...preds.map((p) => p.x)].sort((a, b) => a - b)[Math.floor(preds.length / 2)];
    const my = [...preds.map((p) => p.y)].sort((a, b) => a - b)[Math.floor(preds.length / 2)];
    if (Math.hypot(mx - target.x, my - target.y) > opts.maxErrorPx) return false;
    const step = Math.max(1, Math.floor(frames.length / 8));
    const ok = m.learn(frames.filter((_, i) => i % step === 0).map((f) => f.features), target);
    if (ok) this.modelListeners.forEach((fn) => fn(m));
    return ok;
  }

  /**
   * Explicit correction: at time `at` the user confirmed they were looking at
   * `target` (screen px), by Enter, a mouse click or a slow blink. Uses the
   * open-eye frames from the 0.6 s before that (ending 0.1 s before the last
   * open frame, so a blink's falling lids are skipped). Returns how far off
   * the estimate was, or null if there were too few usable frames.
   */
  correct(target: { x: number; y: number }, at: number, opts: { closedThreshold: number }): { missPx: number } | null {
    const m = this.model;
    if (!m || !this.calibrated) return null;
    const open = this.history.filter((f) => f.t <= at && f.faceDetected && f.features.length && (f.blinkLeft + f.blinkRight) / 2 < opts.closedThreshold);
    if (!open.length) return null;
    const end = open[open.length - 1].t - 100;
    const window = open.filter((f) => f.t <= end && f.t >= end - 600);
    if (window.length < 3) return null;
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    // Only the last steady look counts: if the eyes moved onto the button just
    // before confirming, the frames from before the move are about somewhere
    // else. Anchor on the newest frames and drop those far from them.
    const all = window.map((f) => m.predict(f.features));
    const tail = all.slice(-4);
    const anchor = { x: med(tail.map((p) => p.x)), y: med(tail.map((p) => p.y)) };
    const dist = all.map((p) => Math.hypot(p.x - anchor.x, p.y - anchor.y));
    const limit = Math.max(120, 3 * med(dist.slice(-4)));
    const frames = window.filter((_, i) => dist[i] <= limit);
    if (frames.length < 3) return null;
    const preds = frames.map((f) => m.predict(f.features));
    const missPx = Math.hypot(med(preds.map((p) => p.x)) - target.x, med(preds.map((p) => p.y)) - target.y);
    const step = Math.max(1, Math.floor(frames.length / 10));
    if (!m.addCorrection(frames.filter((_, i) => i % step === 0).map((f) => f.features), target)) return null;
    this.modelListeners.forEach((fn) => fn(m));
    return { missPx };
  }

  /** Forget all explicit corrections. */
  clearCorrections(): void {
    if (!this.model) return;
    this.model.clearCorrections();
    this.modelListeners.forEach((fn) => fn(this.model!));
  }

  constructor(
    readonly frames: FrameProvider,
    private model: GazeModel | null = null,
  ) {}

  setModel(m: GazeModel | null): void {
    this.model = m;
  }

  getModel(): GazeModel | null {
    return this.model;
  }

  get calibrated(): boolean {
    // A model from an older feature set can't be used: recalibration needed.
    return !!this.model && this.model.dims === FEATURE_COUNT;
  }

  get running(): boolean {
    return this.frames.running;
  }

  subscribe(fn: (s: GazeSample) => void): Unsub {
    return this.em.on(fn);
  }

  async start(): Promise<void> {
    if (!this.unsub) {
      this.unsub = this.frames.subscribeFrames((f) => {
        this.history.push(f);
        while (this.history.length && f.t - this.history[0].t > 3000) this.history.shift();
        const blink = (f.blinkLeft + f.blinkRight) / 2;
        if (!f.faceDetected || !this.calibrated) {
          this.em.emit({ t: f.t, x: NaN, y: NaN, faceDetected: f.faceDetected, blink });
          return;
        }
        const p = this.model!.predict(f.features);
        this.em.emit({ t: f.t, x: p.x, y: p.y, faceDetected: true, blink });
      });
    }
    await this.frames.start();
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    this.frames.stop();
  }
}

/** Box–Muller standard normal. */
function randn(): number {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export interface MouseSimOptions {
  /** Std-dev of simulated webcam gaze noise, px. */
  noisePx: number;
  /** Std-dev of slowly varying offset (calibration drift), px. */
  driftPx: number;
  /** Key held to simulate closed eyes. */
  blinkKey: string;
  hz: number;
}

/**
 * Simulated gaze for development and automated tests: the mouse is the eye
 * (with optional webcam-like noise and drift), holding Shift closes the eyes,
 * and moving the mouse out of the window is looking away.
 */
export class MouseGazeSource implements GazeProvider {
  readonly kind = 'mouse' as const;
  readonly calibrated = true;
  private em = new Emitter<GazeSample>();
  private timer = 0;
  private pos: { x: number; y: number } | null = null;
  private inside = true;
  private eyesClosed = false;
  private drift = { x: 0, y: 0, vx: 0, vy: 0 };
  faceLost = false;
  opts: MouseSimOptions;
  private listeners: [EventTarget, string, EventListener][] = [];

  constructor(opts: Partial<MouseSimOptions> = {}, private win: Window = window) {
    this.opts = { noisePx: 0, driftPx: 0, blinkKey: 'Shift', hz: 60, ...opts };
  }

  get running(): boolean {
    return this.timer !== 0;
  }

  subscribe(fn: (s: GazeSample) => void): Unsub {
    return this.em.on(fn);
  }

  private on(t: EventTarget, type: string, fn: EventListener): void {
    t.addEventListener(type, fn, { capture: true, passive: true } as AddEventListenerOptions);
    this.listeners.push([t, type, fn]);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    const doc = this.win.document;
    this.on(this.win, 'mousemove', ((e: MouseEvent) => {
      this.pos = screenMapper.toScreen({ x: e.clientX, y: e.clientY }, this.win);
      this.inside = true;
    }) as EventListener);
    this.on(doc, 'mouseleave', (() => (this.inside = false)) as EventListener);
    this.on(doc.documentElement, 'mouseleave', (() => (this.inside = false)) as EventListener);
    this.on(this.win, 'blur', (() => (this.eyesClosed = false)) as EventListener);
    this.on(this.win, 'keydown', ((e: KeyboardEvent) => {
      if (e.key === this.opts.blinkKey) this.eyesClosed = true;
    }) as EventListener);
    this.on(this.win, 'keyup', ((e: KeyboardEvent) => {
      if (e.key === this.opts.blinkKey) this.eyesClosed = false;
    }) as EventListener);
    this.timer = this.win.setInterval(() => this.tick(), 1000 / this.opts.hz);
  }

  stop(): void {
    this.win.clearInterval(this.timer);
    this.timer = 0;
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn, { capture: true } as EventListenerOptions);
    this.listeners = [];
  }

  private tick(): void {
    const t = nowMs();
    if (this.faceLost) {
      this.em.emit({ t, x: NaN, y: NaN, faceDetected: false, blink: 0 });
      return;
    }
    const blink = this.eyesClosed ? 0.95 : 0.03;
    if (!this.pos || !this.inside) {
      // Looking away: a gaze point well outside the window.
      this.em.emit({ t, x: -10000, y: -10000, faceDetected: true, blink });
      return;
    }
    // Drift: a slow random walk with spring back, scaled to driftPx.
    const d = this.drift;
    d.vx = d.vx * 0.95 + randn() * 0.3;
    d.vy = d.vy * 0.95 + randn() * 0.3;
    d.x = d.x * 0.995 + d.vx * (this.opts.driftPx / 40);
    d.y = d.y * 0.995 + d.vy * (this.opts.driftPx / 40);
    const n = this.opts.noisePx;
    this.em.emit({ t, x: this.pos.x + d.x + randn() * n, y: this.pos.y + d.y + randn() * n, faceDetected: true, blink });
  }
}
