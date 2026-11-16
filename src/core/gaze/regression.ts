/**
 * Calibrated gaze model: standardised features + a few quadratic terms of the
 * dominant eye features, fitted to screen coordinates with ridge regression
 * (a WebGazer-style regression, Papoutsaki et al. 2016).
 */

import { FEATURE_STD_FLOOR } from './features';

export interface GazeModelJSON {
  version: 1;
  /** 2 = fitted with feature-spread floors and a cross-validated λ. Older models are refitted by recalibrating. */
  fit?: 2;
  /** Mean error on calibration dots left out of the fit (leave-one-dot-out), screen px. */
  cvErrorPx?: number;
  mean: number[];
  std: number[];
  wx: number[];
  wy: number[];
  lambda: number;
  /** Validation error measured after calibration, px (mean Euclidean). */
  errorPx?: number;
  createdAt: number;
  /** Bumped whenever the model is refitted (e.g. after learning from a selection). */
  updatedAt?: number;
  /** Calibration samples, kept so the model can be refitted with new data. */
  train?: { X: number[][]; Y: { x: number; y: number }[] };
  /** Samples learned from confirmed selections (most recent last). */
  adaptive?: { X: number[][]; Y: { x: number; y: number }[] };
  /**
   * Explicit corrections: "I was really looking here" (screen px), with the
   * feature vectors from just before. Most recent last. They drive a small
   * correction layer (shift, and stretch once there are several) on top of the
   * fitted model; see `predict`.
   */
  corrections?: { X: number[][]; t: { x: number; y: number } }[];
}

/** Corrections kept; older ones are dropped first. */
export const MAX_CORRECTIONS = 20;

/** Solve a 3×3 linear system by Cramer's rule. */
function solve3(M: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(M);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  return [0, 1, 2].map((c) => det(M.map((row, r) => row.map((v, k) => (k === c ? b[r] : v)))) / d);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

/** Maximum learned samples kept; older ones are dropped first. */
export const MAX_ADAPTIVE = 240;
/** Learned samples count this many times as much as calibration samples (they reflect the current pose). */
const ADAPTIVE_WEIGHT = 2;

/** Expand a standardised feature vector with bias and quadratic terms. */
export function expand(z: number[]): number[] {
  // Average the two eyes' iris features — the main gaze signal.
  const h = (z[0] + z[2]) / 2;
  const v = (z[1] + z[3]) / 2;
  return [1, ...z, h * h, v * v, h * v];
}

/** Solve (A^T A + λI) w = A^T b by Gaussian elimination with partial pivoting. */
export function ridgeSolve(A: number[][], b: number[], lambda: number): number[] {
  const n = A[0].length;
  const M: number[][] = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (const [k, row] of A.entries()) {
    for (let i = 0; i < n; i++) {
      const ri = row[i];
      if (ri === 0) continue;
      for (let j = 0; j < n; j++) M[i][j] += ri * row[j];
      M[i][n] += ri * b[k];
    }
  }
  for (let i = 1; i < n; i++) M[i][i] += lambda; // don't regularise the bias term
  M[0][0] += 1e-9;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / piv;
      if (f === 0) continue;
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

export class GazeModel {
  constructor(private m: GazeModelJSON) {}

  static fit(features: number[][], targets: { x: number; y: number }[], lambda = 1.0): GazeModel {
    const m = new GazeModel(GazeModel.solve(features, targets, lambda));
    m.m.train = { X: features.map((f) => [...f]), Y: targets.map((t) => ({ x: t.x, y: t.y })) };
    return m;
  }

  private static solve(features: number[][], targets: { x: number; y: number }[], lambda: number): GazeModelJSON {
    if (features.length < 4) throw new Error('Not enough calibration samples');
    const d = features[0].length;
    const mean = new Array(d).fill(0);
    const std = new Array(d).fill(0);
    for (const f of features) for (let i = 0; i < d; i++) mean[i] += f[i] / features.length;
    for (const f of features) for (let i = 0; i < d; i++) std[i] += (f[i] - mean[i]) ** 2 / features.length;
    const floors = d === FEATURE_STD_FLOOR.length ? FEATURE_STD_FLOOR : null;
    for (let i = 0; i < d; i++) {
      std[i] = Math.sqrt(std[i]);
      // Scale by at least a realistic spread, so a feature that barely moved
      // during calibration (head held still) can't turn its noise into signal.
      if (floors) std[i] = Math.max(std[i], floors[i]);
      if (std[i] < 1e-4) std[i] = Infinity;
    }
    const A = features.map((f) => expand(f.map((v, i) => (Number.isFinite(std[i]) ? (v - mean[i]) / std[i] : 0))));
    const wx = ridgeSolve(A, targets.map((t) => t.x), lambda);
    const wy = ridgeSolve(A, targets.map((t) => t.y), lambda);
    const now = Date.now();
    return { version: 1, fit: 2, mean, std: std.map((s) => (Number.isFinite(s) ? s : 0)), wx, wy, lambda, createdAt: now, updatedAt: now };
  }

  /**
   * Fit with the regularisation strength chosen by leave-one-dot-out
   * cross-validation: for each candidate λ, every calibration dot is predicted
   * by a model fitted on the other dots, and the λ with the lowest error wins.
   * This prefers a mapping that works for gaze positions it wasn't trained on
   * over one that fits the calibration dots exactly. `groups[i]` names the dot
   * sample i was recorded at; a negative group (the head-movement step) is
   * always used for training and never held out.
   */
  static fitCV(features: number[][], targets: { x: number; y: number }[], groups: number[]): { model: GazeModel; cvErrorPx: number } {
    const ids = [...new Set(groups)].filter((g) => g >= 0);
    const n = features.length;
    if (ids.length < 5) return { model: GazeModel.fit(features, targets, 2), cvErrorPx: NaN };
    let best = { lambda: 2, err: Infinity };
    for (const k of [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1]) {
      const lambda = k * n;
      let total = 0;
      for (const g of ids) {
        const trX: number[][] = [];
        const trY: { x: number; y: number }[] = [];
        const te: number[][] = [];
        let target = { x: 0, y: 0 };
        for (let i = 0; i < n; i++) {
          if (groups[i] === g) {
            te.push(features[i]);
            target = targets[i];
          } else {
            trX.push(features[i]);
            trY.push(targets[i]);
          }
        }
        const m = new GazeModel(GazeModel.solve(trX, trY, lambda));
        const preds = te.map((f) => m.predict(f));
        const p = { x: median(preds.map((q) => q.x)), y: median(preds.map((q) => q.y)) };
        total += Math.hypot(p.x - target.x, p.y - target.y);
      }
      const err = total / ids.length;
      if (err < best.err) best = { lambda, err };
    }
    const model = GazeModel.fit(features, targets, best.lambda);
    model.m.cvErrorPx = best.err;
    return { model, cvErrorPx: best.err };
  }

  get cvErrorPx(): number | undefined {
    return this.m.cvErrorPx;
  }

  static fromJSON(j: GazeModelJSON): GazeModel {
    return new GazeModel(j);
  }

  toJSON(): GazeModelJSON {
    return this.m;
  }

  get errorPx(): number | undefined {
    return this.m.errorPx;
  }

  set errorPx(v: number | undefined) {
    this.m.errorPx = v;
  }

  get version(): number {
    return this.m.updatedAt ?? this.m.createdAt;
  }

  /** Number of input features the model was fitted on. */
  get dims(): number {
    return this.m.mean.length;
  }

  get learnedCount(): number {
    return this.m.adaptive?.X.length ?? 0;
  }

  /** Whether the calibration data is stored, so learning is possible. */
  get canLearn(): boolean {
    return !!this.m.train && this.m.train.X.length > 0;
  }

  /**
   * Add samples whose true gaze target is known (a confirmed selection) and
   * refit: calibration data plus recent learned samples, the latter weighted
   * higher so the model follows head-pose drift. Returns false if not possible.
   */
  learn(features: number[][], target: { x: number; y: number }): boolean {
    if (!this.canLearn || !features.length) return false;
    const ad = (this.m.adaptive ??= { X: [], Y: [] });
    for (const f of features) {
      if (f.length !== this.m.mean.length) continue;
      ad.X.push([...f]);
      ad.Y.push({ x: target.x, y: target.y });
    }
    while (ad.X.length > MAX_ADAPTIVE) {
      ad.X.shift();
      ad.Y.shift();
    }
    const X = [...this.m.train!.X];
    const Y = [...this.m.train!.Y];
    for (let k = 0; k < ADAPTIVE_WEIGHT; k++) {
      X.push(...ad.X);
      Y.push(...ad.Y);
    }
    // Keep the regularisation per sample the same as at calibration.
    const next = GazeModel.solve(X, Y, (this.m.lambda * X.length) / this.m.train!.X.length);
    this.m = {
      ...next,
      lambda: this.m.lambda,
      createdAt: this.m.createdAt,
      errorPx: this.m.errorPx,
      cvErrorPx: this.m.cvErrorPx,
      train: this.m.train,
      adaptive: ad,
      corrections: this.m.corrections,
    };
    this.affineDirty = true; // the base moved: refit the correction layer on it
    return true;
  }

  get correctionCount(): number {
    return this.m.corrections?.length ?? 0;
  }

  /**
   * An explicit correction: while these features were measured the user was
   * looking at `target` (screen px). Takes effect immediately.
   */
  addCorrection(features: number[][], target: { x: number; y: number }): boolean {
    const X = features.filter((f) => f.length === this.m.mean.length).map((f) => [...f]);
    if (!X.length) return false;
    const cs = (this.m.corrections ??= []);
    cs.push({ X, t: { x: target.x, y: target.y } });
    while (cs.length > MAX_CORRECTIONS) cs.shift();
    this.m.updatedAt = Date.now();
    this.affineDirty = true;
    return true;
  }

  /** Forget all explicit corrections. */
  clearCorrections(): void {
    this.m.corrections = [];
    this.m.updatedAt = Date.now();
    this.affineDirty = true;
  }

  private affine: number[] | null = null;
  private affineDirty = true;

  /**
   * The correction layer: x' = a·x + b·y + c, y' = d·x + e·y + f, fitted to
   * where the model said the user looked vs. where they really looked, newer
   * corrections weighted more. A prior towards "no stretch" means one
   * correction is a pure shift; a few spread-out ones can also fix scale.
   */
  private fitAffine(): number[] | null {
    const cs = this.m.corrections ?? [];
    if (!cs.length) return null;
    const S = 1000; // work in units of 1000 px so the prior has a sensible strength
    // Stretch needs corrections spread across the screen to outweigh this;
    // ones close together (whose differences are mostly noise) only shift.
    const lam = 0.2;
    const M = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const bx = [0, 0, 0];
    const by = [0, 0, 0];
    cs.forEach((c, i) => {
      const preds = c.X.map((f) => this.basePredict(f));
      const p = { x: median(preds.map((q) => q.x)), y: median(preds.map((q) => q.y)) };
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const w = Math.pow(0.85, cs.length - 1 - i);
      const r = [p.x / S, p.y / S, 1];
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) M[a][b] += w * r[a] * r[b];
        bx[a] += (w * r[a] * c.t.x) / S;
        by[a] += (w * r[a] * c.t.y) / S;
      }
    });
    const Mx = M.map((row) => [...row]);
    const My = M.map((row) => [...row]);
    Mx[0][0] += lam;
    Mx[1][1] += lam;
    My[0][0] += lam;
    My[1][1] += lam;
    const ax = solve3(Mx, [bx[0] + lam, bx[1], bx[2]]);
    const ay = solve3(My, [by[0], by[1] + lam, by[2]]);
    if (!ax || !ay) return null;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    return [clamp(ax[0], 0.5, 2), clamp(ax[1], -0.5, 0.5), ax[2] * S, clamp(ay[0], -0.5, 0.5), clamp(ay[1], 0.5, 2), ay[2] * S];
  }

  /** Forget learned samples and go back to the pure calibration fit. */
  resetLearning(): void {
    if (!this.canLearn) return;
    const next = GazeModel.solve(this.m.train!.X, this.m.train!.Y, this.m.lambda);
    this.m = {
      ...next,
      createdAt: this.m.createdAt,
      errorPx: this.m.errorPx,
      cvErrorPx: this.m.cvErrorPx,
      train: this.m.train,
      adaptive: { X: [], Y: [] },
      corrections: this.m.corrections,
    };
    this.affineDirty = true;
  }

  /** Gaze estimate (screen px), including the correction layer. */
  predict(f: number[]): { x: number; y: number } {
    const p = this.basePredict(f);
    if (this.affineDirty) {
      this.affine = this.fitAffine();
      this.affineDirty = false;
    }
    const a = this.affine;
    return a ? { x: a[0] * p.x + a[1] * p.y + a[2], y: a[3] * p.x + a[4] * p.y + a[5] } : p;
  }

  /** The fitted model alone, without the correction layer. */
  basePredict(f: number[]): { x: number; y: number } {
    const { mean, std, wx, wy } = this.m;
    if (f.length !== mean.length) return { x: NaN, y: NaN };
    const z = f.map((v, i) => (std[i] > 0 ? (v - mean[i]) / std[i] : 0));
    const e = expand(z);
    let x = 0,
      y = 0;
    for (let i = 0; i < e.length; i++) {
      x += e[i] * wx[i];
      y += e[i] * wy[i];
    }
    return { x, y };
  }
}
