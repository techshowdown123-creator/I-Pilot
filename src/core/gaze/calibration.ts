import type { FaceFrame, Point } from '../types';
import type { FrameProvider } from '../input/sources';
import type { Overlay } from '../overlay/overlay';
import { screenMapper } from '../input/screen';
import { GazeModel } from './regression';

export interface CalibrationResult {
  model: GazeModel;
  /** Mean validation error, px. */
  errorPx: number;
  /** RMS validation error, px — used as the Gaussian sigma. */
  rmsPx: number;
  /** Sample-to-sample spread of raw predictions while fixating, px — sets the fixation radius. */
  jitterPx: number;
  validation: { target: Point; predicted: Point; errorPx: number }[];
  blinkThreshold: number | null;
  samples: number;
}

export interface CalibrationOptions {
  points?: number; // 9 or 13 (default)
  settleMs?: number;
  collectMs?: number;
  blinkStep?: boolean;
  /** Current closed-eye threshold (for filtering blink frames during collection). */
  blinkThreshold?: number;
  win?: Window;
}

class Cancelled extends Error {}

const sleep = (ms: number, signal: { cancelled: boolean }) =>
  new Promise<void>((res, rej) => {
    const start = Date.now();
    const tick = () => {
      if (signal.cancelled) return rej(new Cancelled('cancelled'));
      if (Date.now() - start >= ms) return res();
      setTimeout(tick, 30);
    };
    tick();
  });

function beep(freq = 880, ms = 160): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, ms);
  } catch {
    /* audio optional */
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
}

/** Calibration grid as viewport fractions. */
function gridPoints(n: number): Point[] {
  const a = [0.08, 0.5, 0.92];
  const pts: Point[] = [];
  for (const y of a) for (const x of a) pts.push({ x, y });
  if (n > 9) pts.push({ x: 0.29, y: 0.29 }, { x: 0.71, y: 0.29 }, { x: 0.29, y: 0.71 }, { x: 0.71, y: 0.71 });
  // Shuffle the order (keep the centre first) so the eye can't anticipate.
  const [first, ...rest] = [pts[4], ...pts.filter((_, i) => i !== 4)];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [first, ...rest];
}

const VALIDATION: Point[] = [
  { x: 0.25, y: 0.35 },
  { x: 0.75, y: 0.35 },
  { x: 0.5, y: 0.62 },
  { x: 0.2, y: 0.8 },
  { x: 0.8, y: 0.8 },
];

/**
 * Interactive calibration (stage 3 set-up). Shows dots across the viewport,
 * records feature vectors while the user looks at each, fits the regression,
 * then measures accuracy on separate validation points. Optionally measures
 * the user's open/closed blink scores to set a per-user closure threshold.
 */
export async function runCalibration(overlay: Overlay, frames: FrameProvider, opts: CalibrationOptions = {}): Promise<CalibrationResult> {
  const win = opts.win ?? window;
  const settleMs = opts.settleMs ?? 650;
  const collectMs = opts.collectMs ?? 1100;
  const signal = { cancelled: false };
  const layer = overlay.createCalibrationLayer();
  const msg = document.createElement('div');
  msg.className = 'msg';
  layer.appendChild(msg);
  const dot = document.createElement('div');
  dot.className = 'target';
  dot.style.display = 'none';
  layer.appendChild(dot);
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = '<div></div>';
  layer.appendChild(bar);
  const barFill = bar.firstElementChild as HTMLElement;

  let latest: FaceFrame | null = null;
  let recorder: ((f: FaceFrame) => void) | null = null;
  const unsub = frames.subscribeFrames((f) => {
    latest = f;
    recorder?.(f);
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') signal.cancelled = true;
  };
  win.addEventListener('keydown', onKey, true);

  const say = (html: string) => {
    msg.style.display = '';
    msg.innerHTML = html;
  };

  const record = async (ms: number, keep: (f: FaceFrame) => boolean): Promise<FaceFrame[]> => {
    const out: FaceFrame[] = [];
    recorder = (f) => {
      if (keep(f)) out.push(f);
    };
    await sleep(ms, signal);
    recorder = null;
    return out;
  };

  const moveDot = (p: Point) => {
    dot.style.display = '';
    dot.classList.remove('collect');
    dot.style.left = p.x * win.innerWidth + 'px';
    dot.style.top = p.y * win.innerHeight + 'px';
  };

  const blinkOf = (f: FaceFrame) => (f.blinkLeft + f.blinkRight) / 2;

  /** Record every frame with a face at point p (viewport fraction) after a settle delay. */
  const collectAt = async (p: Point): Promise<FaceFrame[]> => {
    moveDot(p);
    await sleep(settleMs, signal);
    dot.classList.add('collect');
    return record(collectMs, (f) => f.faceDetected && f.features.length > 0);
  };

  /** Drop closed-eye frames, then the 20% of samples farthest from the per-feature median. */
  const clean = (frames: FaceFrame[], thr: number): number[][] => {
    const feats = frames.filter((f) => blinkOf(f) < thr).map((f) => f.features);
    if (feats.length < 4) return feats;
    const med = feats[0].map((_, i) => median(feats.map((f) => f[i])));
    const mad = feats[0].map((_, i) => median(feats.map((f) => Math.abs(f[i] - med[i]))) || 1e-6);
    const dist = feats.map((f) => f.reduce((s, v, i) => s + ((v - med[i]) / mad[i]) ** 2, 0));
    const cut = quantile(dist, 0.8);
    return feats.filter((_, i) => dist[i] <= cut);
  };

  try {
    // 0. Wait for a face.
    say('<h2>Calibration</h2>Sit comfortably about an arm\u2019s length from the screen and keep your head still.<br><small>Looking for your face…  (Esc to cancel)</small>');
    const t0 = Date.now();
    while (!(latest as FaceFrame | null)?.faceDetected) {
      await sleep(100, signal);
      if (Date.now() - t0 > 15000) throw new Error('No face detected. Check lighting and that the camera can see you.');
    }

    // 1. Per-user blink scores: eyes open vs. closed.
    let closedMedian = NaN;
    let stepThreshold: number | null = null;
    if (opts.blinkStep !== false) {
      dot.style.display = '';
      moveDot({ x: 0.5, y: 0.5 });
      say('<h2>Blink check</h2>Keep your eyes <b>open</b> and look at the dot.');
      msg.style.top = '35%';
      await sleep(900, signal);
      const open = (await record(1300, (f) => f.faceDetected)).map(blinkOf);
      say('<h2>Blink check</h2>Now <b>close your eyes</b> until you hear the beep.');
      beep(660);
      await sleep(700, signal);
      const closed = (await record(1300, (f) => f.faceDetected)).map(blinkOf);
      beep(990);
      const o = quantile(open, 0.9);
      closedMedian = median(closed);
      if (Number.isFinite(o) && Number.isFinite(closedMedian) && closedMedian - o > 0.15) stepThreshold = o + 0.45 * (closedMedian - o);
      say('<h2>Blink check done</h2>Open your eyes. Next: follow the dot with your eyes.');
      await sleep(1500, signal);
    }
    msg.style.top = '';
    msg.style.display = 'none';

    // 2. Calibration points (frames are kept whatever the lid position).
    const pts = gridPoints(opts.points ?? 13);
    const perPoint: { target: Point; frames: FaceFrame[] }[] = [];
    for (const [i, p] of pts.entries()) {
      const frames = await collectAt(p);
      perPoint.push({ target: screenMapper.toScreen({ x: p.x * win.innerWidth, y: p.y * win.innerHeight }, win), frames });
      barFill.style.width = ((i + 1) / (pts.length + VALIDATION.length)) * 100 + '%';
    }

    // Looking at the bottom of the screen lowers the eyelids and raises the
    // blink score. Put the closed threshold above what open eyes produced
    // anywhere on screen, but below the measured closed-eye score.
    const openScores = perPoint.flatMap((pp) => pp.frames.map(blinkOf));
    const openHigh = quantile(openScores, 0.95);
    let thr = Math.max(stepThreshold ?? opts.blinkThreshold ?? 0.45, openHigh + 0.08);
    if (Number.isFinite(closedMedian)) thr = Math.min(thr, closedMedian - 0.05);
    thr = Math.min(0.9, Math.max(0.2, thr));
    const blinkThreshold = Number.isFinite(thr) ? thr : null;

    const X: number[][] = [];
    const Y: Point[] = [];
    for (const pp of perPoint) {
      for (const f of clean(pp.frames, thr)) {
        X.push(f);
        Y.push(pp.target);
      }
    }
    if (X.length < 40) throw new Error('Too few usable samples. Keep your eyes open and your face visible.');
    const model = GazeModel.fit(X, Y, 2.0);

    // 3. Validation on unseen points: accuracy (median error) and precision (jitter).
    const validation: CalibrationResult['validation'] = [];
    const jitters: number[] = [];
    for (const [i, p] of VALIDATION.entries()) {
      const feats = clean(await collectAt(p), thr);
      barFill.style.width = ((pts.length + i + 1) / (pts.length + VALIDATION.length)) * 100 + '%';
      if (!feats.length) continue;
      const preds = feats.map((f) => screenMapper.toViewport(model.predict(f), win));
      const predicted = { x: median(preds.map((q) => q.x)), y: median(preds.map((q) => q.y)) };
      const target = { x: p.x * win.innerWidth, y: p.y * win.innerHeight };
      validation.push({ target, predicted, errorPx: Math.hypot(predicted.x - target.x, predicted.y - target.y) });
      if (preds.length > 3) {
        const mx = preds.reduce((s, q) => s + q.x, 0) / preds.length;
        const my = preds.reduce((s, q) => s + q.y, 0) / preds.length;
        jitters.push(Math.sqrt(preds.reduce((s, q) => s + ((q.x - mx) ** 2 + (q.y - my) ** 2) / 2, 0) / preds.length));
      }
    }
    const errorPx = validation.length ? validation.reduce((s, v) => s + v.errorPx, 0) / validation.length : NaN;
    const rmsPx = validation.length ? Math.sqrt(validation.reduce((s, v) => s + v.errorPx ** 2, 0) / validation.length) : NaN;
    const jitterPx = jitters.length ? median(jitters) : NaN;
    model.errorPx = errorPx;

    // 4. Show the result briefly.
    dot.style.display = 'none';
    bar.style.display = 'none';
    for (const v of validation) {
      const t = document.createElement('div');
      t.className = 'target';
      t.style.cssText = `left:${v.target.x}px;top:${v.target.y}px;transform:scale(.35);transition:none`;
      const e = document.createElement('div');
      e.className = 'err';
      e.style.cssText = `left:${v.predicted.x}px;top:${v.predicted.y}px`;
      const l = document.createElement('div');
      l.className = 'line';
      const len = Math.hypot(v.predicted.x - v.target.x, v.predicted.y - v.target.y);
      const ang = Math.atan2(v.predicted.y - v.target.y, v.predicted.x - v.target.x);
      l.style.cssText = `left:${v.target.x}px;top:${v.target.y}px;width:${len}px;transform:rotate(${ang}rad)`;
      layer.append(l, t, e);
    }
    say(`<h2>Calibration complete</h2>Average error <b>${Math.round(errorPx)} px</b> on ${validation.length} check points.<br><small>Red: where you looked · yellow: where I-Pilot thought you looked</small>`);
    await sleep(2600, signal);
    return { model, errorPx, rmsPx, jitterPx, validation, blinkThreshold, samples: X.length };
  } finally {
    unsub();
    recorder = null;
    win.removeEventListener('keydown', onKey, true);
    layer.remove();
  }
}

export function isCancelled(e: unknown): boolean {
  return e instanceof Cancelled;
}
