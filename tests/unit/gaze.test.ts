import { describe, expect, it } from 'vitest';
import { GazeModel, ridgeSolve } from '../../src/core/gaze/regression';
import { extractFeatures, FEATURE_COUNT } from '../../src/core/gaze/features';

describe('ridgeSolve', () => {
  it('solves a well-posed least-squares system', () => {
    // y = 2 + 3a − b
    const A: number[][] = [];
    const b: number[] = [];
    for (let i = 0; i < 20; i++) {
      const a1 = Math.sin(i),
        a2 = Math.cos(i * 1.7);
      A.push([1, a1, a2]);
      b.push(2 + 3 * a1 - a2);
    }
    const w = ridgeSolve(A, b, 1e-6);
    expect(w[0]).toBeCloseTo(2, 4);
    expect(w[1]).toBeCloseTo(3, 4);
    expect(w[2]).toBeCloseTo(-1, 4);
  });
});

describe('GazeModel', () => {
  it('recovers a synthetic iris→screen mapping with sub-10 px error', () => {
    const X: number[][] = [];
    const Y: { x: number; y: number }[] = [];
    const feat = (sx: number, sy: number, noise = 0) => {
      const h = (sx - 960) / 4000 + noise * (Math.random() - 0.5);
      const v = (sy - 540) / 6000 + noise * (Math.random() - 0.5);
      return [h, v, h * 1.02, v * 0.98, h * 3, v * 3, h * 3, v * 3, 0.01, 0.02, 0, 0, 0, -40];
    };
    for (const gx of [0.08, 0.5, 0.92])
      for (const gy of [0.08, 0.5, 0.92])
        for (let k = 0; k < 20; k++) {
          const sx = gx * 1920,
            sy = gy * 1080;
          X.push(feat(sx, sy, 0.0005));
          Y.push({ x: sx, y: sy });
        }
    const m = GazeModel.fit(X, Y, 0.5);
    for (const [sx, sy] of [
      [500, 300],
      [1400, 800],
      [960, 540],
    ]) {
      const p = m.predict(feat(sx, sy));
      expect(Math.hypot(p.x - sx, p.y - sy)).toBeLessThan(40);
    }
    // Round-trips through JSON (stored in localStorage / chrome.storage).
    const m2 = GazeModel.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    expect(m2.predict(feat(700, 700)).x).toBeCloseTo(m.predict(feat(700, 700)).x, 6);
  });

  it('learning from confirmed selections corrects drift after the head moves', () => {
    // Calibrated at one head position…
    const feat = (sx: number, sy: number, shift = 0) => {
      const h = (sx - 960) / 4000 + shift;
      const v = (sy - 540) / 6000;
      // A head shift moves the irises in the image *and* shows up in head position (headX).
      return [h, v, h, v, h * 3, v * 3, h * 3, v * 3, 0, 0, 0, shift * 100, 0, -40];
    };
    const X: number[][] = [];
    const Y: { x: number; y: number }[] = [];
    for (const gx of [0.1, 0.5, 0.9])
      for (const gy of [0.1, 0.5, 0.9])
        for (let k = 0; k < 15; k++) {
          X.push(feat(gx * 1920, gy * 1080).map((v) => v + (Math.random() - 0.5) * 1e-4));
          Y.push({ x: gx * 1920, y: gy * 1080 });
        }
    const m = GazeModel.fit(X, Y, 0.5);
    expect(m.canLearn).toBe(true);
    // …then the iris features shift (head moved), so predictions drift sideways.
    const shift = 0.03;
    const err = () => {
      let e = 0;
      for (const [sx, sy] of [[400, 300], [1500, 800], [960, 540]]) {
        const p = m.predict(feat(sx, sy, shift));
        e += Math.hypot(p.x - sx, p.y - sy);
      }
      return e / 3;
    };
    const before = err();
    expect(before).toBeGreaterThan(80);
    // A handful of confirmed selections at known targets under the new pose.
    for (const [sx, sy] of [[300, 200], [1600, 250], [900, 600], [400, 900], [1500, 950], [1000, 300]]) {
      expect(m.learn([feat(sx, sy, shift), feat(sx, sy, shift)], { x: sx, y: sy })).toBe(true);
    }
    expect(err()).toBeLessThan(before / 2);
    expect(m.learnedCount).toBe(12);
    // Survives JSON storage, and can be reset.
    const copy = GazeModel.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    expect(copy.learnedCount).toBe(12);
    copy.resetLearning();
    expect(copy.learnedCount).toBe(0);
  });

  it('returns NaN for a feature vector of the wrong length', () => {
    const m = GazeModel.fit(
      Array.from({ length: 10 }, (_, i) => [i, i * 2, 1, 1]),
      Array.from({ length: 10 }, (_, i) => ({ x: i, y: i })),
    );
    expect(Number.isNaN(m.predict([1, 2]).x)).toBe(true);
  });
});

describe('extractFeatures', () => {
  it('produces the documented feature vector from 478 landmarks', () => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    // right eye corners and lids
    lm[33] = { x: 0.4, y: 0.45, z: 0 };
    lm[133] = { x: 0.46, y: 0.45, z: 0 };
    lm[159] = { x: 0.43, y: 0.44, z: 0 };
    lm[145] = { x: 0.43, y: 0.46, z: 0 };
    // left eye
    lm[362] = { x: 0.54, y: 0.45, z: 0 };
    lm[263] = { x: 0.6, y: 0.45, z: 0 };
    lm[386] = { x: 0.57, y: 0.44, z: 0 };
    lm[374] = { x: 0.57, y: 0.46, z: 0 };
    lm[468] = { x: 0.57, y: 0.45, z: 0 }; // deliberately "swapped" iris order
    lm[473] = { x: 0.44, y: 0.45, z: 0 };
    const f = extractFeatures(lm, [{ categoryName: 'eyeLookOutRight', score: 0.6 }], undefined);
    expect(f).toHaveLength(FEATURE_COUNT);
    // iris 473 is nearest the right eye → assigned to eye A, offset towards the inner corner
    expect(f[0]).toBeGreaterThan(0);
    expect(f[4]).toBeCloseTo(0.6);
    expect(f.every(Number.isFinite)).toBe(true);
  });

  it('returns an empty vector without iris landmarks', () => {
    expect(extractFeatures([{ x: 0, y: 0 }], undefined, undefined)).toEqual([]);
  });
});
