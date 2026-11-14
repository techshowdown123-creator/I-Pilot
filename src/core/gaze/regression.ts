/**
 * Calibrated gaze model: standardised features + a few quadratic terms of the
 * dominant eye features, fitted to screen coordinates with ridge regression
 * (a WebGazer-style regression, Papoutsaki et al. 2016).
 */

export interface GazeModelJSON {
  version: 1;
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
    for (let i = 0; i < d; i++) {
      std[i] = Math.sqrt(std[i]);
      // Floor tiny variances (e.g. head held perfectly still) so noise isn't amplified.
      if (std[i] < 1e-4) std[i] = Infinity;
    }
    const A = features.map((f) => expand(f.map((v, i) => (Number.isFinite(std[i]) ? (v - mean[i]) / std[i] : 0))));
    const wx = ridgeSolve(A, targets.map((t) => t.x), lambda);
    const wy = ridgeSolve(A, targets.map((t) => t.y), lambda);
    const now = Date.now();
    return { version: 1, mean, std: std.map((s) => (Number.isFinite(s) ? s : 0)), wx, wy, lambda, createdAt: now, updatedAt: now };
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
    const next = GazeModel.solve(X, Y, this.m.lambda);
    this.m = { ...next, createdAt: this.m.createdAt, errorPx: this.m.errorPx, train: this.m.train, adaptive: ad };
    return true;
  }

  /** Forget learned samples and go back to the pure calibration fit. */
  resetLearning(): void {
    if (!this.canLearn) return;
    const next = GazeModel.solve(this.m.train!.X, this.m.train!.Y, this.m.lambda);
    this.m = { ...next, createdAt: this.m.createdAt, errorPx: this.m.errorPx, train: this.m.train, adaptive: { X: [], Y: [] } };
  }

  predict(f: number[]): { x: number; y: number } {
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
