import type { Candidate, GazeSample, PauseReason, PilotState, Point, Resolution, ViewportSample } from '../types';
import { DEFAULT_SETTINGS, type PilotSettings } from '../settings';
import { OneEuroFilter2D } from '../filters/oneEuro';
import { IDTDetector, type FixationEvent } from '../fixation/idt';
import { BlinkDetector, type BlinkEvent } from '../blink/blinkDetector';
import { elementAtPoint, resolveTarget } from '../targets/resolver';
import { PilotStateMachine, type Transition } from './stateMachine';
import { activate, isTextEntry, setNativeValue, typeInto } from './actions';
import { Overlay, type ToolbarAction } from '../overlay/overlay';
import type { GazeProvider } from '../input/sources';
import { screenMapper } from '../input/screen';
import { nowMs } from '../time';

export type ActivationKind = 'click' | 'dblclick' | 'focus-text' | 'open-select' | 'select-option' | 'overlay' | 'chooser' | 'confirm';

export interface ActivationEvent {
  t: number;
  method: 'blink' | 'dwell';
  kind: ActivationKind;
  element: Element;
  label: string;
  /** For select-option: the chosen value. */
  value?: string;
  /** Blink/dwell trigger → event dispatched, ms. */
  latencyMs: number;
  snapping: boolean;
}

export interface EngineEvents {
  state: { state: PilotState; reason: string; pauseReason: PauseReason | null; target: Candidate | null };
  landing: { point: Point; resolution: Resolution | null; t: number };
  activate: ActivationEvent;
  blink: BlinkEvent;
  sample: ViewportSample & { fx: number; fy: number };
  correction: { t: number; reason: 'cancel-chooser' | 'cancel-confirm' };
}

type Handler<K extends keyof EngineEvents> = (e: EngineEvents[K]) => void;

const FACE_LOST_GRACE_MS = 300;
const OFFSCREEN_GRACE_MS = 300;
const POST_BLINK_IGNORE_MS = 150;
const ACTIVATION_COOLDOWN_MS = 450;

/**
 * The I-Pilot pipeline (stages 4–8) running in a page: smoothing → fixation
 * detection → DOM target resolution → blink/dwell + state machine → action
 * executor and overlay. Input (stages 1–3) comes from a GazeProvider.
 */
export class PilotEngine {
  settings: PilotSettings;
  readonly overlay: Overlay;
  readonly sm = new PilotStateMachine();
  private filter: OneEuroFilter2D;
  private idt: IDTDetector;
  readonly blink: BlinkDetector;
  private source: GazeProvider | null = null;
  private unsubSource: (() => void) | null = null;
  private handlers: { [K in keyof EngineEvents]?: Set<Handler<K>> } = {};

  private faceMissingSince: number | null = null;
  private offscreenSince: number | null = null;
  private lastOpenAt = 0;
  private lastResolution: Resolution | null = null;
  private lockAt = 0;
  private lastResolveAt = 0;
  /** Set after any activation; dwell stays off until the eyes move (prevents repeat clicks). */
  private dwellBlocked = false;
  private blockPoint: Point | null = null;
  private latched: { c: Candidate; ambiguous: Resolution | null } | null = null;
  private lastActivation = 0;
  private rawFixStart: number | null = null;
  private rawCandidate: Candidate | null = null;
  private lastLanding: Point | null = null;
  private calibrating = false;
  private lastViewport: Point | null = null;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  readonly stats = { deliberateBlinks: 0, naturalBlinks: 0, activations: 0, landings: 0, startedAt: nowMs() };

  constructor(settings: Partial<PilotSettings> = {}, private doc: Document = document) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    const s = this.settings;
    this.filter = new OneEuroFilter2D(s.filterMinCutoff, s.filterBeta);
    this.idt = new IDTDetector(s.fixationMinMs, s.fixationDispersionPx);
    this.blink = new BlinkDetector(s.blinkClosedThreshold, s.blinkMinMs, s.blinkMaxMs);
    this.overlay = new Overlay(doc, { onToolbar: (a) => this.onToolbar(a) });
    this.sm.onTransition((tr) => this.onTransition(tr));
    screenMapper.install(doc.defaultView!);
    doc.defaultView!.addEventListener('keydown', this.keyHandler, true);
    this.overlay.setToolbarVisible(false);
    this.refreshStatus();
  }

  on<K extends keyof EngineEvents>(k: K, fn: Handler<K>): () => void {
    const set = (this.handlers[k] ??= new Set() as never) as Set<Handler<K>>;
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit<K extends keyof EngineEvents>(k: K, e: EngineEvents[K]): void {
    const set = this.handlers[k] as Set<Handler<K>> | undefined;
    set?.forEach((fn) => fn(e));
  }

  updateSettings(patch: Partial<PilotSettings>): void {
    this.settings = { ...this.settings, ...patch };
    const s = this.settings;
    this.filter.configure(s.filterMinCutoff, s.filterBeta);
    this.idt.minDurationMs = s.fixationMinMs;
    this.idt.maxDispersion = s.fixationDispersionPx;
    this.blink.closedThreshold = s.blinkClosedThreshold;
    this.blink.minMs = s.blinkMinMs;
    this.blink.maxMs = s.blinkMaxMs;
    this.resetTracking();
    this.overlay.setHighlight(null, { state: this.sm.state });
    if (!this.userPaused) this.sm.reset(nowMs());
    if (!s.showGazeDot && s.snapping) this.overlay.setGaze(null);
    this.refreshStatus();
  }

  setSource(src: GazeProvider | null): void {
    this.unsubSource?.();
    this.unsubSource = null;
    this.source = src;
    this.resetTracking();
    if (src) this.unsubSource = src.subscribe((s) => this.onSample(s));
    else {
      this.overlay.setHighlight(null, { state: this.sm.state });
      this.overlay.setGaze(null);
      this.overlay.setProgress(null, null);
    }
    this.overlay.setToolbarVisible(!!src && !this.calibrating);
    this.refreshStatus();
  }

  getSource(): GazeProvider | null {
    return this.source;
  }

  /** Suspend processing (e.g. during calibration) without tearing down. */
  setCalibrating(on: boolean): void {
    this.calibrating = on;
    this.resetTracking();
    this.overlay.setHighlight(null, { state: this.sm.state });
    this.overlay.setGaze(null);
    this.overlay.setProgress(null, null);
    this.overlay.setToolbarVisible(!on && !!this.source);
    this.refreshStatus();
  }

  destroy(): void {
    this.setSource(null);
    this.doc.defaultView!.removeEventListener('keydown', this.keyHandler, true);
    this.overlay.destroy();
  }

  get state(): PilotState {
    return this.sm.state;
  }

  get userPaused(): boolean {
    return this.sm.state === 'PAUSED' && this.sm.pauseReason === 'user';
  }

  togglePause(): void {
    const t = nowMs();
    if (this.userPaused) this.sm.userResume(t);
    else this.sm.pause('user', t);
    this.overlay.setUserPaused(this.userPaused);
    this.overlay.hideModal();
    this.refreshStatus();
  }

  private resetTracking(): void {
    this.filter.reset();
    this.idt.reset();
    this.blink.reset();
    this.latched = null;
    this.rawFixStart = null;
    this.rawCandidate = null;
    this.dwellBlocked = false;
  }

  // ------------------------------------------------------------------ samples

  private onSample(s: GazeSample): void {
    if (this.calibrating) return;
    const t = s.t;
    const win = this.doc.defaultView!;

    // Face presence → PAUSED after a short grace period.
    if (!s.faceDetected) {
      this.faceMissingSince ??= t;
      if (this.blink.closed) this.blink.abort();
      if (t - this.faceMissingSince > FACE_LOST_GRACE_MS && this.sm.state !== 'PAUSED') {
        this.idt.reset();
        this.sm.pause('face-lost', t);
      }
      this.overlay.setProgress(null, null);
      return;
    }
    this.faceMissingSince = null;
    if (this.sm.pauseReason === 'face-lost') this.sm.conditionCleared('face-lost');

    // Blink detection runs on every frame with a face.
    const be = this.blink.push(s.blink, t);
    if (be) this.onBlink(be);
    const eyesClosed = this.blink.closed || s.blink >= this.settings.blinkClosedThreshold * 0.85;
    if (eyesClosed) {
      this.lastOpenAt = t;
      if (this.settings.selection === 'blink' && this.latched) {
        const dur = this.blink.closedFor(t);
        const p = centreOf(this.latched.c);
        this.overlay.setProgress(p, dur / this.settings.blinkMinMs, 'blink', dur >= this.settings.blinkMinMs);
      }
      return; // gaze is meaningless while the lids are closed
    }
    if (t - this.lastOpenAt < POST_BLINK_IGNORE_MS) return;
    if (this.settings.selection === 'blink') this.overlay.setProgress(null, null);

    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return;
    const vp = screenMapper.toViewport({ x: s.x, y: s.y }, win);
    const margin = Math.max(60, this.settings.gazeSigmaPx);
    const onScreen = vp.x > -margin && vp.y > -margin && vp.x < win.innerWidth + margin && vp.y < win.innerHeight + margin;

    if (!onScreen) {
      this.offscreenSince ??= t;
      if (t - this.offscreenSince > OFFSCREEN_GRACE_MS && this.sm.state !== 'PAUSED') {
        this.idt.reset();
        this.filter.reset();
        this.sm.pause('off-screen', t);
      }
      this.overlay.setProgress(null, null);
      this.emit('sample', { t, x: vp.x, y: vp.y, fx: NaN, fy: NaN, faceDetected: true, blink: s.blink, onScreen: false });
      return;
    }
    this.offscreenSince = null;
    if (this.sm.pauseReason === 'off-screen') this.sm.conditionCleared('off-screen');

    // Stage 4: smoothing.
    const clamped = { x: Math.min(Math.max(vp.x, 0), win.innerWidth), y: Math.min(Math.max(vp.y, 0), win.innerHeight) };
    const f = this.filter.filter(clamped.x, clamped.y, t);
    this.lastViewport = f;
    this.emit('sample', { t, x: vp.x, y: vp.y, fx: f.x, fy: f.y, faceDetected: true, blink: s.blink, onScreen: true });

    // Stage 5: fixation detection.
    const fe = this.idt.push(f.x, f.y, t);

    if (!this.settings.snapping) this.rawPipeline(f, fe, t);
    else this.snapPipeline(f, fe, t);
  }

  /** Condition A: the cursor follows the (smoothed) gaze continuously; no snapping. */
  private rawPipeline(f: Point, fe: FixationEvent | null, t: number): void {
    const userPaused = this.userPaused;
    this.overlay.setGaze(f, true);
    if (this.sm.state === 'PAUSED' && !userPaused && !this.sm.resumeArmed) return;
    const exclusive = this.overlay.exclusive || userPaused;
    // Overlay controls still work in raw mode (they are what the cursor is on).
    const ov = this.overlay.targets(this.userPaused).find((o) => f.x >= o.rect.left && f.x <= o.rect.right && f.y >= o.rect.top && f.y <= o.rect.bottom);
    const under: Candidate | null = ov
      ? { el: ov.el, rect: ov.rect, kind: 'overlay', label: ov.label, key: ov.key, score: 1, dangerous: false }
      : exclusive
        ? null
        : elementAtPoint(this.doc, f, this.overlay.host);
    if (fe?.type === 'start') {
      if (userPaused) this.sm.target = under;
      else this.sm.landing(under, t);
      this.stats.landings++;
      this.emit('landing', { point: f, resolution: null, t });
    }
    if (under?.key !== this.rawCandidate?.key) {
      // Classic dwell: the timer runs while the cursor stays on one element.
      this.rawCandidate = under;
      this.rawFixStart = t;
      this.overlay.setHighlight(under, { state: this.sm.state, raw: true });
    }
    // After a selection, the cursor must actually move away before dwell re-arms
    // (content shifting under a still cursor must not trigger a click).
    if (this.dwellBlocked && this.blockPoint && Math.hypot(f.x - this.blockPoint.x, f.y - this.blockPoint.y) > 40) this.dwellBlocked = false;
    if (this.sm.state === 'PAUSED' && !userPaused) return;
    if (this.settings.selection === 'dwell') {
      if (this.rawFixStart !== null && !this.dwellBlocked && under && (!userPaused || under.kind === 'overlay')) {
        const frac = (t - this.rawFixStart) / this.settings.dwellMs;
        this.overlay.setProgress(f, frac, 'dwell', frac >= 1);
        if (frac >= 1) {
          this.overlay.setProgress(null, null);
          this.trigger(under, null, 'dwell', t);
        }
      } else this.overlay.setProgress(null, null);
    }
    if (under) this.sm.target = under;
  }

  /** Conditions B/C: landings snap to the most likely interactive element. */
  private snapPipeline(f: Point, fe: FixationEvent | null, t: number): void {
    if (this.settings.showGazeDot) this.overlay.setGaze(f);
    else this.overlay.setGaze(null);

    // Keep the locked target valid.
    const cur = this.sm.target;
    if (cur && !cur.el.isConnected) {
      this.sm.dropTarget(t);
      this.overlay.setHighlight(null, { state: this.sm.state });
    }

    // A fixation that found nothing (or whose target vanished) is re-resolved
    // periodically, so content that appears under a steady gaze becomes selectable.
    const reResolve = fe?.type === 'update' && !this.sm.target && t - this.lastResolveAt > 500;
    if (fe && (fe.type === 'start' || reResolve)) {
      this.lastResolveAt = t;
      // Stage 6: resolve the landing against the DOM.
      const exclusive = this.overlay.exclusive || this.userPaused;
      const res = resolveTarget(
        this.doc,
        { x: fe.fixation.x, y: fe.fixation.y },
        { sigma: this.settings.gazeSigmaPx, ambiguityRatio: this.settings.ambiguityRatio, hysteresis: this.settings.hysteresis, exclude: this.overlay.host },
        this.sm.target,
        this.overlay.targets(this.userPaused),
        exclusive,
      );
      this.stats.landings++;
      this.lastLanding = { x: fe.fixation.x, y: fe.fixation.y };
      const wasPaused = this.sm.state === 'PAUSED';
      const prevKey = this.sm.target?.key;
      if (this.userPaused) {
        // Only the Resume button is live; lock it without leaving PAUSED.
        this.sm.target = res.best;
        this.overlay.setHighlight(res.best, { state: 'LOCKED' });
      } else {
        this.sm.landing(res.best, t);
        if (this.sm.state !== 'PAUSED') {
          this.lastResolution = res;
          this.overlay.setHighlight(res.best, {
            state: this.sm.state,
            alternatives: res.ambiguous ? res.ranked.slice(1, 3) : [],
          });
        }
      }
      if (fe.type === 'start' || res.best?.key !== prevKey || wasPaused) this.lockAt = t;
      this.emit('landing', { point: this.lastLanding, resolution: res, t });
      this.refreshStatus();
    } else if (fe?.type === 'end') {
      // A saccade: the eyes moved on, so dwell may fire again.
      this.dwellBlocked = false;
      this.lockAt = 0;
      this.overlay.setProgress(null, null);
    }

    // Dwell selection on the locked target.
    const canDwell = this.sm.canActivate || (this.userPaused && this.sm.target);
    if (this.settings.selection === 'dwell' && canDwell && this.idt.fixating && this.lockAt && !this.dwellBlocked) {
      const c = this.sm.target!;
      const frac = (t - this.lockAt) / this.settings.dwellMs;
      this.overlay.setProgress(centreOf(c), frac, 'dwell', frac >= 1);
      if (frac >= 1) {
        this.overlay.setProgress(null, null);
        this.trigger(c, this.lastResolution?.best?.key === c.key && this.lastResolution.ambiguous ? this.lastResolution : null, 'dwell', t);
      }
    }
  }

  // ------------------------------------------------------------------ blink

  private onBlink(e: BlinkEvent): void {
    this.emit('blink', e);
    if (e.type === 'close') {
      // Latch the target from the last stable fixation before the eyes closed.
      const c = this.sm.target;
      const usable = c && (this.sm.canActivate || (this.userPaused && c.kind === 'overlay'));
      this.latched = usable ? { c, ambiguous: this.lastResolution?.best?.key === c.key && this.lastResolution.ambiguous ? this.lastResolution : null } : null;
    } else if (e.type === 'deliberate') {
      this.stats.deliberateBlinks++;
      this.overlay.setProgress(null, null);
      const l = this.latched;
      this.latched = null;
      if (this.settings.selection !== 'blink' || !l) return;
      if (this.sm.state === 'PAUSED' && !(this.userPaused && l.c.kind === 'overlay')) return;
      this.trigger(l.c, l.ambiguous, 'blink', e.t);
    } else if (e.type === 'natural' || e.type === 'rest') {
      if (e.type === 'natural') this.stats.naturalBlinks++;
      this.latched = null;
      this.overlay.setProgress(null, null);
    }
  }

  // ------------------------------------------------------------------ actions

  /** A selection was triggered on candidate c (by blink or dwell at time t). */
  private trigger(c: Candidate, ambiguous: Resolution | null, method: 'blink' | 'dwell', t: number): void {
    if (nowMs() - this.lastActivation < ACTIVATION_COOLDOWN_MS) return;
    if (!c.el.isConnected) return;
    this.lastActivation = nowMs();
    this.dwellBlocked = true;
    this.blockPoint = this.lastViewport;

    if (c.kind === 'overlay') {
      activate(c, 'click');
      this.report(c, 'overlay', method, t);
      return;
    }
    if (ambiguous && ambiguous.ranked.length > 1) {
      this.report(c, 'chooser', method, t);
      const items = ambiguous.ranked.slice(0, 3).map((cand, i) => ({
        label: cand.label || cand.el.tagName.toLowerCase(),
        sub: cand.kind === 'grid' ? 'area' : cand.kind,
        number: i + 1,
        tone: (i === 0 ? 'primary' : undefined) as 'primary' | undefined,
        onPick: () => this.perform(cand, method, nowMs()),
      }));
      this.overlay.showChooser('Which one did you mean?', 'Look at your choice, then select it again.', items, () => this.cancelled('cancel-chooser'));
      this.afterModalChange();
      return;
    }
    this.perform(c, method, t);
  }

  private perform(c: Candidate, method: 'blink' | 'dwell', t: number): void {
    const el = c.el;
    if (el instanceof HTMLSelectElement) {
      this.report(c, 'open-select', method, t);
      const opts = Array.from(el.options).filter((o) => !o.disabled);
      this.showSelectPage(el, opts, 0, method);
      return;
    }
    if (isTextEntry(el)) {
      (el as HTMLElement).focus({ preventScroll: true });
      this.report(c, 'focus-text', method, t);
      this.openKeyboard(el);
      return;
    }
    if (c.dangerous && this.settings.confirmDangerous) {
      this.report(c, 'confirm', method, t);
      this.overlay.showChooser(
        `Confirm: “${c.label}”?`,
        'This action may delete, pay or submit something.',
        [{ label: `Yes, ${c.label}`, sub: 'go ahead', tone: 'danger', onPick: () => this.dispatch(c, method, nowMs()) }],
        () => this.cancelled('cancel-confirm'),
        'confirm',
      );
      this.afterModalChange();
      return;
    }
    this.dispatch(c, method, t);
  }

  private dispatch(c: Candidate, method: 'blink' | 'dwell', t: number): void {
    activate(c, this.settings.clickAction);
    this.report(c, this.settings.clickAction, method, t);
    this.overlay.toast(`${this.settings.clickAction === 'dblclick' ? 'Double-clicked' : 'Clicked'}: ${c.label}`);
    this.afterModalChange();
  }

  private showSelectPage(el: HTMLSelectElement, opts: HTMLOptionElement[], page: number, method: 'blink' | 'dwell'): void {
    const per = 5;
    const slice = opts.slice(page * per, page * per + per);
    const items = slice.map((o) => ({
      label: o.text,
      tone: (o.selected ? 'primary' : undefined) as 'primary' | undefined,
      onPick: () => {
        setNativeValue(el, o.value);
        this.overlay.toast(`Selected: ${o.text}`);
        this.emit('activate', { t: nowMs(), method, kind: 'select-option', element: el, label: o.text, value: o.value, latencyMs: 0, snapping: this.settings.snapping });
        this.afterModalChange();
      },
    }));
    if (opts.length > (page + 1) * per) items.push({ label: 'More…', tone: undefined, onPick: () => this.showSelectPage(el, opts, page + 1, method) });
    this.overlay.showChooser('Choose an option', `${opts.length} options`, items, () => this.cancelled('cancel-chooser'));
    this.afterModalChange();
  }

  private openKeyboard(el: Element): void {
    const value = () => ((el as HTMLInputElement).value ?? (el as HTMLElement).textContent ?? '') as string;
    this.overlay.showKeyboard(
      value(),
      (k) => {
        typeInto(el, k === 'Backspace' ? { backspace: true } : k);
        this.overlay.setKeyboardPreview(value());
      },
      () => {
        this.overlay.hideKeyboard();
        this.afterModalChange();
      },
    );
    this.afterModalChange();
  }

  private cancelled(reason: 'cancel-chooser' | 'cancel-confirm'): void {
    this.emit('correction', { t: nowMs(), reason });
    this.afterModalChange();
  }

  /** Overlay contents changed: drop the current lock so the next landing re-resolves. */
  private afterModalChange(): void {
    this.sm.target = null;
    if (this.sm.state === 'LOCKED') this.sm.dropTarget(nowMs());
    this.overlay.setHighlight(null, { state: this.sm.state });
    this.idt.reset();
    this.lockAt = 0;
    this.refreshStatus();
  }

  private report(c: Candidate, kind: ActivationKind, method: 'blink' | 'dwell', t: number): void {
    this.stats.activations++;
    this.emit('activate', { t: nowMs(), method, kind, element: c.el, label: c.label, latencyMs: Math.max(0, nowMs() - t), snapping: this.settings.snapping });
  }

  // ------------------------------------------------------------------ misc

  private onToolbar(a: ToolbarAction): void {
    const win = this.doc.defaultView!;
    if (a === 'pause') return this.togglePause();
    if (a === 'back') return win.history.back();
    if (a === 'scrollUp' || a === 'scrollDown') {
      const dir = a === 'scrollUp' ? -1 : 1;
      const p = this.lastLanding ?? { x: win.innerWidth / 2, y: win.innerHeight / 2 };
      const scroller = findScroller(this.doc, p, this.overlay.host);
      const amount = dir * (scroller ? scroller.clientHeight : win.innerHeight) * 0.6;
      if (scroller) scroller.scrollBy({ top: amount, behavior: 'smooth' });
      else win.scrollBy({ top: amount, behavior: 'smooth' });
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
      e.preventDefault();
      this.togglePause();
    } else if (e.key === 'Escape' && (this.overlay.modalKind || this.overlay.keyboardOpen)) {
      if (this.overlay.modalKind) this.cancelled(this.overlay.modalKind === 'confirm' ? 'cancel-confirm' : 'cancel-chooser');
      this.overlay.hideModal();
      this.overlay.hideKeyboard();
      this.afterModalChange();
    }
  }

  private onTransition(tr: Transition): void {
    if (tr.to === 'PAUSED') {
      this.overlay.setProgress(null, null);
      this.latched = null;
      if (this.sm.target) this.overlay.setHighlight(this.sm.target, { state: 'PAUSED', raw: !this.settings.snapping });
    }
    this.emit('state', { state: tr.to, reason: tr.reason, pauseReason: this.sm.pauseReason, target: this.sm.target });
    this.refreshStatus();
  }

  refreshStatus(): void {
    if (this.calibrating) return this.overlay.setStatus(null);
    if (!this.source) return this.overlay.setStatus('I-Pilot off', 'paused');
    if (!this.source.calibrated) return this.overlay.setStatus('Not calibrated', 'paused');
    const st = this.sm.state;
    if (st === 'PAUSED') {
      const r = this.sm.pauseReason;
      const txt = r === 'user' ? 'Paused — look at Resume to continue' : r === 'face-lost' ? 'Paused — face not detected' : r === 'off-screen' ? 'Paused — looking away' : 'Paused';
      return this.overlay.setStatus(this.sm.resumeArmed ? 'Resuming — look at something' : txt, 'paused');
    }
    const how = this.settings.selection === 'blink' ? 'slow blink to select' : `dwell ${(this.settings.dwellMs / 1000).toFixed(1)} s to select`;
    if (st === 'LOCKED') return this.overlay.setStatus(`${this.settings.snapping ? 'Locked' : 'Cursor'} · ${how}`, 'locked');
    this.overlay.setStatus(this.settings.snapping ? 'Tracking' : 'Raw cursor', 'ok');
  }

  /** Current smoothed gaze in viewport px (for debug UIs). */
  get gazePoint(): Point | null {
    return this.lastViewport;
  }
}

function centreOf(c: Candidate): Point {
  const r = c.el.isConnected && c.kind !== 'grid' && c.kind !== 'overlay' ? c.el.getBoundingClientRect() : c.rect;
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

function findScroller(doc: Document, p: Point, exclude: Element): Element | null {
  const hit = doc.elementsFromPoint(p.x, p.y).find((e) => e !== exclude && !exclude.contains(e));
  let el: Element | null = hit ?? null;
  while (el && el !== doc.body && el !== doc.documentElement) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) return el;
    el = el.parentElement;
  }
  return null;
}
