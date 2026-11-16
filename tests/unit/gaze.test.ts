import { describe, expect, it } from 'vitest';
import { GazeModel, ridgeSolve } from '../../src/core/gaze/regression';
import { extractFeatures, FEATURE_COUNT } from '../../src/core/gaze/features';
import { validationError } from '../../src/core/gaze/calibration';
import { CameraGazeSource } from '../../src/core/input/sources';
import type { FaceFrame } from '../../src/core/types';

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

  it('a head-movement step during calibration makes later head turns and leans cost little accuracy', () => {
    // Physical simulation of a webcam user: gaze = head rotation + eye-in-head
    // rotation; the camera measures iris position (noisy), blendshapes, head
    // pose and lids. Calibration: 13 dots with the head almost still.
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const randn = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
    const D = 2280; // viewing distance in px (60 cm)
    type Head = { yaw: number; pitch: number; tx: number; tz: number };
    const feat = (sx: number, sy: number, h: Head) => {
      const ex = Math.atan((sx - 960) / D) - h.yaw - h.tx / 60;
      const ey = Math.atan((sy - 540) / D) - h.pitch;
      const ih = () => 0.4 * Math.sin(ex) + randn() * 0.004;
      const iv = () => 0.3 * Math.sin(ey) + randn() * 0.006;
      const lk = (a: number) => Math.max(-1, Math.min(1, a * 2.5 + randn() * 0.05));
      return [ih(), iv(), ih(), iv(), lk(ex), lk(ey), lk(ex), lk(ey),
        h.yaw + randn() * 0.003, h.pitch + randn() * 0.003, randn() * 0.003,
        h.tx + randn() * 0.05, randn() * 0.05, h.tz + randn() * 0.08,
        0.3 + 0.4 * ey + randn() * 0.01, 0.3 + 0.4 * ey + randn() * 0.01];
    };
    const still: Head = { yaw: 0, pitch: 0, tx: 0, tz: -55 };
    const X: number[][] = [];
    const Y: { x: number; y: number }[] = [];
    const G: number[] = [];
    const dots: [number, number][] = [];
    for (const y of [0.08, 0.5, 0.92]) for (const x of [0.08, 0.5, 0.92]) dots.push([x, y]);
    dots.push([0.29, 0.29], [0.71, 0.29], [0.29, 0.71], [0.71, 0.71]);
    dots.forEach(([x, y], k) => {
      const h = { ...still, yaw: randn() * 0.004, pitch: randn() * 0.004, tx: randn() * 0.1 };
      for (let i = 0; i < 25; i++) {
        X.push(feat(x * 1920, y * 1080, h));
        Y.push({ x: x * 1920, y: y * 1080 });
        G.push(k);
      }
    });
    const err = (m: GazeModel, h: Head) => {
      let e = 0, c = 0;
      for (const x of [0.2, 0.4, 0.6, 0.8])
        for (const y of [0.25, 0.5, 0.75]) {
          const p = m.predict(feat(x * 1920, y * 1080, h));
          e += Math.hypot(p.x - x * 1920, p.y - y * 1080);
          c++;
        }
      return e / c;
    };
    const turned = { ...still, yaw: 0.05 }; // 3° head turn
    const leaned = { ...still, tz: -50 }; // 5 cm closer
    const noSweep = GazeModel.fitCV(X, Y, G);
    expect(noSweep.cvErrorPx).toBeGreaterThan(0);
    const [dX, dY, dG] = [[...X], [...Y], [...G]];
    // Head-movement step: eyes on the centre dot while turning, nodding, leaning.
    for (let i = 0; i < 150; i++) {
      const ph = (i / 150) * Math.PI * 2;
      X.push(feat(960, 540, { yaw: 0.08 * Math.sin(ph), pitch: 0.06 * Math.sin(2 * ph), tx: 1.5 * Math.cos(ph), tz: -55 + 4 * Math.sin(3 * ph) }));
      Y.push({ x: 960, y: 540 });
      G.push(-1);
    }
    const withSweep = GazeModel.fitCV(X, Y, G).model;
    expect(err(withSweep, still)).toBeLessThan(45);
    expect(err(withSweep, turned)).toBeLessThan(45);
    expect(err(withSweep, leaned)).toBeLessThan(45);
    expect(err(withSweep, turned)).toBeLessThan(err(noSweep.model, turned) * 0.7);
    expect(err(withSweep, leaned)).toBeLessThan(err(noSweep.model, leaned) * 0.7);
    expect(withSweep.toJSON().fit).toBe(2);

    // A head step where the eyes were NOT on the dot (reading text above it)
    // but the frames are labelled "centre": the check points expose it, so
    // calibration's rule (keep it only if within 10% + 5 px) drops it.
    const bX = [...dX], bY = [...dY], bG = [...dG];
    for (let i = 0; i < 150; i++) {
      const ph = (i / 150) * Math.PI * 2;
      bX.push(feat(960, 300, { yaw: 0.08 * Math.sin(ph), pitch: 0.06 * Math.sin(2 * ph), tx: 1.5 * Math.cos(ph), tz: -55 + 4 * Math.sin(3 * ph) }));
      bY.push({ x: 960, y: 540 });
      bG.push(-1);
    }
    const badSweep = GazeModel.fitCV(bX, bY, bG).model;
    const checks = [[0.25, 0.35], [0.75, 0.35], [0.5, 0.62], [0.2, 0.8], [0.8, 0.8]].map(([x, y]) => ({
      target: { x: x * 1920, y: y * 1080 },
      feats: Array.from({ length: 15 }, () => feat(x * 1920, y * 1080, still)),
    }));
    const keep = (m: GazeModel) => validationError(m, checks) <= validationError(noSweep.model, checks) * 1.1 + 5;
    expect(keep(withSweep)).toBe(true);
    expect(keep(badSweep)).toBe(false);
  });

  describe('explicit corrections ("I was really looking here")', () => {
    // A model that is consistently off: it says x + 220, y − 60.
    const feat = (sx: number, sy: number) => [sx / 4000, sy / 6000, sx / 4000, sy / 6000, 0, 0, 0, 0, 0, 0, 0, 0, 0, -50, 0.3, 0.3].map((v, i) => v + (i > 3 ? 0 : Math.sin(sx * 7 + sy * 3 + i) * 1e-5));
    const biased = () => {
      const X: number[][] = [];
      const Y: { x: number; y: number }[] = [];
      for (const gx of [0.1, 0.5, 0.9]) for (const gy of [0.1, 0.5, 0.9]) for (let k = 0; k < 10; k++) {
        const sx = gx * 1920 + k, sy = gy * 1080 - k;
        X.push(feat(sx, sy));
        Y.push({ x: sx + 220, y: sy - 60 });
      }
      return GazeModel.fit(X, Y, 0.5);
    };
    const miss = (m: GazeModel, sx: number, sy: number) => {
      const p = m.predict(feat(sx, sy));
      return Math.hypot(p.x - sx, p.y - sy);
    };

    it('one correction removes a consistent offset everywhere', () => {
      const m = biased();
      expect(miss(m, 500, 400)).toBeGreaterThan(200);
      expect(m.addCorrection([feat(960, 540), feat(962, 541)], { x: 961, y: 540 })).toBe(true);
      expect(m.correctionCount).toBe(1);
      for (const [x, y] of [[300, 200], [1600, 900], [960, 540]]) expect(miss(m, x, y)).toBeLessThan(15);
      // Stored with the model, and can be undone.
      const copy = GazeModel.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
      expect(miss(copy, 300, 200)).toBeLessThan(15);
      copy.clearCorrections();
      expect(miss(copy, 300, 200)).toBeGreaterThan(200);
    });

    it('a few spread-out corrections also fix a stretched estimate', () => {
      const X: number[][] = [];
      const Y: { x: number; y: number }[] = [];
      // Estimates 30% too wide around the centre.
      for (const gx of [0.1, 0.5, 0.9]) for (const gy of [0.1, 0.5, 0.9]) for (let k = 0; k < 10; k++) {
        const sx = gx * 1920 + k, sy = gy * 1080 - k;
        X.push(feat(sx, sy));
        Y.push({ x: 960 + (sx - 960) * 1.3, y: sy });
      }
      const m = GazeModel.fit(X, Y, 0.5);
      expect(miss(m, 200, 540)).toBeGreaterThan(200);
      for (const [x, y] of [[200, 300], [1700, 300], [960, 800], [400, 900], [1500, 700]]) m.addCorrection([feat(x, y)], { x, y });
      for (const [x, y] of [[300, 540], [1650, 500], [960, 300]]) expect(miss(m, x, y)).toBeLessThan(40);
    });

    it('keeps working after the model also learns from a selection', () => {
      const m = biased();
      m.addCorrection([feat(960, 540)], { x: 960, y: 540 });
      m.learn([feat(400, 300)], { x: 400, y: 300 });
      expect(miss(m, 1500, 800)).toBeLessThan(40);
    });

    it('the camera source uses the frames from before a slow blink, not the closed-eye ones', async () => {
      const fns = new Set<(f: FaceFrame) => void>();
      const frames = { subscribeFrames: (fn: (f: FaceFrame) => void) => (fns.add(fn), () => fns.delete(fn)), start: async () => {}, stop() {}, running: true };
      const src = new CameraGazeSource(frames, biased());
      await src.start();
      const send = (t: number, sx: number, sy: number, closed: boolean) =>
        fns.forEach((fn) => fn({ t, faceDetected: true, features: feat(sx, sy), blinkLeft: closed ? 0.9 : 0.05, blinkRight: closed ? 0.9 : 0.05 }));
      // Looking at (700, 500) for 1 s, then a 600 ms slow blink (the closed
      // frames carry junk), confirmed when the eyes reopen at 1.65 s.
      for (let t = 0; t <= 1000; t += 33) send(t, 700, 500, false);
      for (let t = 1033; t <= 1633; t += 33) send(t, 100, 1000, true);
      const r = src.correct({ x: 700, y: 500 }, 1650, { closedThreshold: 0.45 })!;
      expect(r).not.toBeNull();
      expect(r.missPx).toBeGreaterThan(200); // the model was 228 px off before the correction
      expect(src.getModel()!.correctionCount).toBe(1);
      expect(miss(src.getModel()!, 700, 500)).toBeLessThan(15);
      src.clearCorrections();
      expect(src.getModel()!.correctionCount).toBe(0);
    });

    it('ignores the frames from before the eyes moved onto the button', async () => {
      const fns = new Set<(f: FaceFrame) => void>();
      const frames = { subscribeFrames: (fn: (f: FaceFrame) => void) => (fns.add(fn), () => fns.delete(fn)), start: async () => {}, stop() {}, running: true };
      const src = new CameraGazeSource(frames, biased());
      await src.start();
      const send = (t: number, sx: number, sy: number) => fns.forEach((fn) => fn({ t, faceDetected: true, features: feat(sx, sy), blinkLeft: 0.05, blinkRight: 0.05 }));
      // Looking at (700, 500), then over to (1200, 500) and confirming 0.3 s later.
      for (let t = 0; t <= 1000; t += 33) send(t, 700, 500);
      for (let t = 1033; t <= 1300; t += 33) send(t, 1200, 500);
      const r = src.correct({ x: 1200, y: 500 }, 1300, { closedThreshold: 0.45 })!;
      expect(r.missPx).toBeGreaterThan(200);
      expect(r.missPx).toBeLessThan(260); // the model's own 228 px offset, not a mix with the other spot
      expect(miss(src.getModel()!, 1200, 500)).toBeLessThan(15);
      expect(miss(src.getModel()!, 700, 500)).toBeLessThan(15);
    });
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
