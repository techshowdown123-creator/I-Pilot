import type { Point, Rect } from '../types';

/** Standard normal CDF via the Abramowitz–Stegun erf approximation (|err| < 1.5e-7). */
export function normCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * Probability mass of an isotropic 2-D Gaussian (centre p, std sigma) that
 * falls inside an axis-aligned rectangle — the "overlap with a Gaussian model
 * of gaze error". Separable, so it's a product of two 1-D integrals.
 */
export function gaussianRectMass(p: Point, r: Rect, sigma: number): number {
  const px = normCdf((r.right - p.x) / sigma) - normCdf((r.left - p.x) / sigma);
  const py = normCdf((r.bottom - p.y) / sigma) - normCdf((r.top - p.y) / sigma);
  return Math.max(0, px) * Math.max(0, py);
}

/** Euclidean distance from a point to the nearest edge of a rect (0 if inside). */
export function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right);
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.hypot(dx, dy);
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

export function rectArea(r: Rect): number {
  return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
}

/**
 * Size weight: very large clickable regions (whole cards, page-wide click
 * handlers) are rarely the intended target, so they are gently discounted.
 */
export function sizeWeight(r: Rect, viewportArea: number): number {
  return 1 / (1 + rectArea(r) / (0.15 * viewportArea));
}

export const TYPE_WEIGHT: Record<string, number> = {
  button: 1.0,
  link: 1.0,
  input: 1.0,
  select: 1.0,
  role: 0.95,
  generic: 0.8,
  grid: 0.9,
  overlay: 1.1,
};
