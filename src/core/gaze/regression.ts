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
}

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
    return new GazeModel({ version: 1, mean, std: std.map((s) => (Number.isFinite(s) ? s : 0)), wx, wy, lambda, createdAt: Date.now() });
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
