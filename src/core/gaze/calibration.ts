import type { FaceFrame, Point } from '../types';
import type { FrameProvider } from '../input/sources';
import type { Overlay } from '../overlay/overlay';
import { screenMapper } from '../input/screen';
import { GazeModel } from './regression';
import { medianPose, type HeadPose } from './headPose';
import { nowMs } from '../time';

export interface CalibrationResult {
  model: GazeModel;
  /** Mean validation error, px. */
  errorPx: number;
  /** RMS validation error, px — used as the Gaussian sigma. */
  rmsPx: number;
  /** Mean error predicting each calibration dot from a model fitted on the other dots, screen px. */
  cvErrorPx: number;
  /** Whether the head-movement step's data was kept (it is dropped when it makes the check points worse). */
  headStepUsed: boolean;
  /** Head position while calibrating (null if the camera gave none). */
  headPose: HeadPose | null;
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
  /**
   * Guided calibration: each dot waits until you confirm you're looking at it
   * (Space / Enter, a click on the dot, or a slow blink), and the check phase
   * shows where I-Pilot thinks you're looking and learns from every check dot.
   */
  guided?: boolean;
  /** Include the head-movement step (default true). */
  headStep?: boolean;
  win?: Window;
}

/** Check dots of guided calibration: the 5 check points plus top, left and right. */
const GUIDED_CHECK: Point[] = [...VALIDATION_POINTS(), { x: 0.5, y: 0.15 }, { x: 0.12, y: 0.5 }, { x: 0.88, y: 0.5 }];
function VALIDATION_POINTS(): Point[] {
  return [
    { x: 0.25, y: 0.35 },
    { x: 0.75, y: 0.35 },
    { x: 0.5, y: 0.62 },
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
  ];
}

type Confirm = { at: number; how: 'key' | 'click' | 'blink' };

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

const VALIDATION: Point[] = VALIDATION_POINTS();

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

  // Guided mode: a one-line hint at the very top (away from the dots) and the
  // live "where I think you're looking" ring.
  const hintEl = document.createElement('div');
  hintEl.className = 'hint';
  hintEl.style.display = 'none';
  layer.appendChild(hintEl);
  const ring = document.createElement('div');
  ring.className = 'live';
  ring.style.display = 'none';
  layer.appendChild(ring);
  const hint = (html: string | null) => {
    hintEl.style.display = html ? '' : 'none';
    if (html) hintEl.innerHTML = html;
  };

  let latest: FaceFrame | null = null;
  let recorder: ((f: FaceFrame) => void) | null = null;
  let onFrame: ((f: FaceFrame) => void) | null = null;
  /** Recent frames (~3 s), to take the frames from just before a confirmation. */
  const hist: FaceFrame[] = [];
  // Confirmations (guided mode): Space / Enter, a click on the dot, or a slow blink.
  let confirmWaiter: ((c: Confirm) => void) | null = null;
  let closedSince: number | null = null;
  let liveThr = opts.blinkThreshold ?? 0.45;
  const fire = (c: Confirm) => {
    const w = confirmWaiter;
    confirmWaiter = null;
    w?.(c);
  };
  const unsub = frames.subscribeFrames((f) => {
    latest = f;
    recorder?.(f);
    hist.push(f);
    while (hist.length && f.t - hist[0].t > 3000) hist.shift();
    if (confirmWaiter && f.faceDetected) {
      const b = (f.blinkLeft + f.blinkRight) / 2;
      if (b >= liveThr) closedSince ??= f.t;
      else if (closedSince !== null) {
        const d = f.t - closedSince;
        const at = closedSince;
        closedSince = null;
        if (d >= 400 && d <= 2500) fire({ at, how: 'blink' });
      }
    }
    onFrame?.(f);
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') signal.cancelled = true;
    else if (confirmWaiter && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      fire({ at: nowMs(), how: 'key' });
    }
  };
  win.addEventListener('keydown', onKey, true);
  layer.addEventListener('click', (e) => {
    if (!confirmWaiter) return;
    if (dot.style.display === 'none') return fire({ at: nowMs(), how: 'click' });
    const r = dot.getBoundingClientRect();
    // A click counts only on (or right next to) the dot: that's where the eyes are.
    if (Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) <= 80) fire({ at: nowMs(), how: 'click' });
    else hint('Click <b>on the dot</b> (or press Space) while you look at it.');
  });
  const waitConfirm = () =>
    new Promise<Confirm>((res, rej) => {
      closedSince = null;
      confirmWaiter = res;
      const check = () => {
        if (signal.cancelled) {
          confirmWaiter = null;
          rej(new Cancelled('cancelled'));
        } else if (confirmWaiter === res) setTimeout(check, 50);
      };
      check();
    });
  /**
   * The open-eye frames from just before a confirmation (`ms` long, ending
   * shortly before the last open frame so a blink's falling lids are skipped),
   * not earlier than `since` (the eyes need time to reach a new dot).
   */
  const lookFrames = (c: Confirm, since: number, ms: number): FaceFrame[] => {
    const open = hist.filter((f) => f.t <= c.at && f.t >= since && f.faceDetected && f.features.length > 0 && (f.blinkLeft + f.blinkRight) / 2 < liveThr);
    if (!open.length) return [];
    const end = open[open.length - 1].t - (c.how === 'blink' ? 100 : 60);
    return open.filter((f) => f.t <= end && f.t >= end - ms);
  };

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
    if (stepThreshold !== null) liveThr = stepThreshold;

    // 2. Calibration points (frames are kept whatever the lid position).
    const guided = !!opts.guided;
    const nCheck = guided ? GUIDED_CHECK.length : VALIDATION.length;
    const pts = gridPoints(opts.points ?? 13);
    const perPoint: { target: Point; frames: FaceFrame[] }[] = [];
    if (guided) {
      // Self-paced: each dot waits until you confirm you're looking at it; only
      // the 0.8 s before that is used, so frames from while the eyes were
      // still travelling to the dot (or had wandered) are left out.
      dot.style.display = 'none';
      say(
        '<h2>Guided calibration</h2>Look at each dot. When your eyes are on it, press <b>Space</b>, <b>click the dot</b>, or <b>slow-blink</b>.<br>' +
          'Go at your own pace.<br><small>Press Space (or slow-blink) to begin · Esc to cancel</small>',
      );
      await waitConfirm();
      msg.style.display = 'none';
      for (const [i, p] of pts.entries()) {
        moveDot(p);
        const shownAt = nowMs();
        hint(`Dot ${i + 1} of ${pts.length}: look at it, then press <b>Space</b>, click it, or slow-blink`);
        for (;;) {
          const c = await waitConfirm();
          const got = lookFrames(c, shownAt + 300, 800);
          if (got.length >= 6) {
            perPoint.push({ target: screenMapper.toScreen({ x: p.x * win.innerWidth, y: p.y * win.innerHeight }, win), frames: got });
            dot.classList.add('collect');
            beep(880, 70);
            await sleep(250, signal);
            break;
          }
          hint('Keep your eyes on the dot a moment longer, then confirm again');
        }
        barFill.style.width = ((i + 1) / (pts.length + nCheck + 1)) * 100 + '%';
      }
      hint(null);
    } else {
      for (const [i, p] of pts.entries()) {
        const frames = await collectAt(p);
        perPoint.push({ target: screenMapper.toScreen({ x: p.x * win.innerWidth, y: p.y * win.innerHeight }, win), frames });
        barFill.style.width = ((i + 1) / (pts.length + nCheck + 1)) * 100 + '%';
      }
    }

    // 3. Head movement: eyes stay on the centre dot while the head turns, nods
    //    and leans. Without this the model never sees the head move, so it
    //    can't learn to correct for it, and any head shift after calibration
    //    shifts the gaze estimate (in simulation: 60–90 px → ~25 px after a 3°
    //    turn or 5 cm lean).
    //    One movement at a time: its instruction is shown on its own (no dot)
    //    with a short countdown; then the text goes away, the dot appears with
    //    that movement's arrow inside, and only then is it recorded. There is
    //    nothing to read while recording: text next to the dot made people read
    //    instead of looking at the dot, which taught the model "everything is
    //    the centre of the screen". A beep marks the start and the end.
    const sweep: FaceFrame[] = [];
    const centre = { x: 0.5, y: 0.5 };
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    const moves = [
      { arrow: '↕', title: 'Nod your head up and down', how: 'Slowly and only a little, like saying “yes”.' },
      { arrow: '↔', title: 'Turn your head left and right', how: 'Slowly and only a little, like saying “no”.' },
      { arrow: '⤢', title: 'Lean a little closer, then back', how: 'Slowly, about a hand’s width.' },
    ];
    for (const [i, m] of (opts.headStep === false ? [] : moves).entries()) {
      dot.style.display = 'none';
      const text = (countdown: string) =>
        `<h2>Head movement ${i + 1} of ${moves.length}</h2>` +
        `<div style="font-size:26px;font-weight:700;color:#fff;margin:4px 0 8px">${m.arrow}&nbsp; ${m.title}</div>` +
        `${m.how}<br>Keep your <b>eyes on the dot</b> the whole time.<br><small>${countdown}</small>`;
      say(text('Get ready…'));
      await sleep(1500, signal);
      for (let n = 3; n > 0; n--) {
        say(text(`The dot appears in ${n}…`));
        await sleep(1000, signal);
      }
      msg.style.display = 'none';
      moveDot(centre);
      dot.classList.add('head');
      glyph.textContent = m.arrow;
      dot.appendChild(glyph);
      beep(660, 120);
      await sleep(500, signal); // eyes settle on the dot
      sweep.push(...(await record(3000, (f) => f.faceDetected && f.features.length > 0)));
      beep(990, 120);
      glyph.remove();
      dot.classList.remove('head');
      dot.style.display = 'none';
      if (i < moves.length - 1) {
        say('<h2>Done ✓</h2>Next movement coming up.');
        await sleep(1000, signal);
      }
    }
    msg.style.display = 'none';
    barFill.style.width = ((pts.length + 1) / (pts.length + nCheck + 1)) * 100 + '%';

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
    const G: number[] = [];
    for (const [k, pp] of perPoint.entries()) {
      for (const f of clean(pp.frames, thr)) {
        X.push(f);
        Y.push(pp.target);
        G.push(k);
      }
    }
    if (X.length < 40) throw new Error('Too few usable samples. Keep your eyes open and your face visible.');
    // Head-movement frames: drop closed-eye frames only (the head poses are
    // meant to spread out). Group -1: always trained on, never held out.
    // Capped at 60% of the dot frames so they can't outweigh the dots.
    const centreScreen = screenMapper.toScreen({ x: centre.x * win.innerWidth, y: centre.y * win.innerHeight }, win);
    const open = sweep.filter((f) => blinkOf(f) < thr);
    const step = Math.max(1, Math.ceil(open.length / (0.6 * X.length)));
    const HX = open.filter((_, i) => i % step === 0).map((f) => f.features);

    // Two candidates, both with regularisation chosen by predicting each dot
    // from the other dots: dots only, and dots + head movement.
    const dotsOnly = GazeModel.fitCV(X, Y, G);
    const withHead = HX.length >= 20 ? GazeModel.fitCV([...X, ...HX], [...Y, ...HX.map(() => centreScreen)], [...G, ...HX.map(() => -1)]) : null;

    let model: GazeModel;
    let cvErrorPx: number;
    let headUsed: boolean;
    const validation: CalibrationResult['validation'] = [];
    const jitters: number[] = [];
    /** Spread of predictions while fixating (precision), px. */
    const spread = (preds: Point[]) => {
      const mx = preds.reduce((s, q) => s + q.x, 0) / preds.length;
      const my = preds.reduce((s, q) => s + q.y, 0) / preds.length;
      return Math.sqrt(preds.reduce((s, q) => s + ((q.x - mx) ** 2 + (q.y - my) ** 2) / 2, 0) / preds.length);
    };
    let learnLine = '';

    if (guided) {
      // Dots only vs. + head movement, by how well each predicts calibration
      // dots it wasn't fitted on (the check dots below are learned from).
      headUsed = !!withHead && withHead.cvErrorPx <= dotsOnly.cvErrorPx * 1.1 + 5;
      const TX = [...X, ...(headUsed ? HX : [])];
      const TY = [...Y, ...(headUsed ? HX.map(() => centreScreen) : [])];
      const TG = [...G, ...(headUsed ? HX.map(() => -1) : [])];
      let fitted = headUsed ? withHead! : dotsOnly;

      // 4. Check with live feedback: the ring shows where I-Pilot thinks you
      //    look; at each check dot it notes how far off it was (before
      //    learning, so the number is honest), then learns that spot.
      const recentPred: Point[] = [];
      ring.style.display = '';
      ring.style.left = '-100px';
      onFrame = (f) => {
        if (!f.faceDetected || !f.features.length || blinkOf(f) >= thr) return;
        recentPred.push(screenMapper.toViewport(fitted.model.predict(f.features), win));
        while (recentPred.length > 6) recentPred.shift();
        ring.style.left = median(recentPred.map((q) => q.x)) + 'px';
        ring.style.top = median(recentPred.map((q) => q.y)) + 'px';
      };
      for (const [i, p] of GUIDED_CHECK.entries()) {
        moveDot(p);
        const target = { x: p.x * win.innerWidth, y: p.y * win.innerHeight };
        const shownAt = nowMs();
        hint(`Check ${i + 1} of ${GUIDED_CHECK.length}: the <b style="color:#facc15">yellow ring</b> is where I think you’re looking. Look at the dot and confirm, and I’ll learn from it`);
        for (;;) {
          const c = await waitConfirm();
          let got = lookFrames(c, shownAt + 300, 600);
          if (got.length >= 3) {
            // Only the last steady look (the eyes may have just arrived).
            const all = got.map((f) => fitted.model.predict(f.features));
            const tail = all.slice(-4);
            const anchor = { x: median(tail.map((q) => q.x)), y: median(tail.map((q) => q.y)) };
            const dist = all.map((q) => Math.hypot(q.x - anchor.x, q.y - anchor.y));
            const limit = Math.max(120, 3 * median(dist.slice(-4)));
            got = got.filter((_, k) => dist[k] <= limit);
          }
          if (got.length >= 5) {
            const preds = got.map((f) => screenMapper.toViewport(fitted.model.predict(f.features), win));
            const predicted = { x: median(preds.map((q) => q.x)), y: median(preds.map((q) => q.y)) };
            const miss = Math.hypot(predicted.x - target.x, predicted.y - target.y);
            validation.push({ target, predicted, errorPx: miss });
            if (preds.length > 3) jitters.push(spread(preds));
            // Learn this spot: add it to the calibration data and refit.
            const ts = screenMapper.toScreen(target, win);
            for (const f of clean(got, thr)) {
              TX.push(f);
              TY.push(ts);
              TG.push(100 + i);
            }
            fitted = GazeModel.fitCV(TX, TY, TG);
            recentPred.length = 0;
            dot.classList.add('collect');
            beep(880, 70);
            hint(`I was <b>${Math.round(miss)} px</b> off here → learned ✓`);
            await sleep(900, signal);
            break;
          }
          hint('Keep your eyes on the dot a moment longer, then confirm again');
        }
        barFill.style.width = ((pts.length + i + 2) / (pts.length + nCheck + 1)) * 100 + '%';
      }
      onFrame = null;
      ring.style.display = 'none';
      hint(null);
      model = fitted.model;
      cvErrorPx = fitted.cvErrorPx;
      const half = Math.floor(validation.length / 2);
      const avg = (vs: typeof validation) => vs.reduce((s, v) => s + v.errorPx, 0) / vs.length;
      if (validation.length >= 4)
        learnLine = `<br>First ${half} checks: <b>${Math.round(avg(validation.slice(0, half)))} px</b> → last ${validation.length - half}: <b>${Math.round(avg(validation.slice(half)))} px</b> (it learned as you went)`;
    } else {
      // 4. Validation on unseen points: accuracy (median error) and precision (jitter).
      const valSets: { target: Point; feats: number[][] }[] = [];
      for (const [i, p] of VALIDATION.entries()) {
        const feats = clean(await collectAt(p), thr);
        barFill.style.width = ((pts.length + i + 2) / (pts.length + VALIDATION.length + 1)) * 100 + '%';
        if (feats.length) valSets.push({ target: { x: p.x * win.innerWidth, y: p.y * win.innerHeight }, feats });
      }
      // Keep the head-movement model only if it predicts the check points about
      // as well (head movement is then handled for free). If the eyes left the
      // dot during the head step, its data is wrong and the check points show it.
      const valError = (m: GazeModel) => validationError(m, valSets, (q) => screenMapper.toViewport(q, win));
      headUsed = !!withHead && valSets.length > 0 && valError(withHead.model) <= valError(dotsOnly.model) * 1.1 + 5;
      ({ model, cvErrorPx } = headUsed ? withHead! : dotsOnly);
      for (const { target, feats } of valSets) {
        const preds = feats.map((f) => screenMapper.toViewport(model.predict(f), win));
        const predicted = { x: median(preds.map((q) => q.x)), y: median(preds.map((q) => q.y)) };
        validation.push({ target, predicted, errorPx: Math.hypot(predicted.x - target.x, predicted.y - target.y) });
        if (preds.length > 3) jitters.push(spread(preds));
      }
    }
    const errorPx = validation.length ? validation.reduce((s, v) => s + v.errorPx, 0) / validation.length : NaN;
    const rmsPx = validation.length ? Math.sqrt(validation.reduce((s, v) => s + v.errorPx ** 2, 0) / validation.length) : NaN;
    const jitterPx = jitters.length ? median(jitters) : NaN;
    model.errorPx = errorPx;

    // 5. Show the result briefly.
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
    const cvLine = Number.isFinite(cvErrorPx) ? `<br>Calibration dots predicted without seeing them: <b>${Math.round(cvErrorPx)} px</b>` : '';
    const headLine = headUsed ? 'Head-movement step used.' : 'Head-movement step not used (it made the check points worse).';
    say(
      `<h2>Calibration complete</h2>Average error <b>${Math.round(errorPx)} px</b> on ${validation.length} check points${guided ? ' (measured before it learned each one)' : ''}.${learnLine}${cvLine}<br><small>${headLine}<br>Red: where you looked · yellow: where I-Pilot thought you looked</small>`,
    );
    await sleep(3200, signal);
    // Where the head was while following the dots (head still): the spot the face guide points back to.
    const headPose = medianPose(perPoint.flatMap((pp) => pp.frames.map((f) => f.pose).filter((q): q is HeadPose => !!q)));
    return { model, errorPx, rmsPx, cvErrorPx, headStepUsed: headUsed, headPose, jitterPx, validation, blinkThreshold, samples: X.length };
  } finally {
    unsub();
    recorder = null;
    win.removeEventListener('keydown', onKey, true);
    layer.remove();
  }
}

/**
 * Mean distance between each check point and the median prediction there.
 * `toViewport` converts the model's screen-px output to the targets' frame.
 */
export function validationError(
  model: GazeModel,
  sets: { target: Point; feats: number[][] }[],
  toViewport: (p: Point) => Point = (p) => p,
): number {
  if (!sets.length) return NaN;
  let total = 0;
  for (const { target, feats } of sets) {
    const preds = feats.map((f) => toViewport(model.predict(f)));
    total += Math.hypot(median(preds.map((q) => q.x)) - target.x, median(preds.map((q) => q.y)) - target.y);
  }
  return total / sets.length;
}

export function isCancelled(e: unknown): boolean {
  return e instanceof Cancelled;
}
