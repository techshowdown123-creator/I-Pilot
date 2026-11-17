/**
 * Evaluation script for the project report (Section V, Tables V-VI, Fig. 3).
 * Seeded, so every run prints the same numbers (timings vary by machine).
 * Run from the repository root:
 *   npx esbuild report/evaluate.ts --bundle --platform=node --format=esm --outfile=report/out/evaluate.mjs
 *   node report/out/evaluate.mjs
 */
import { scoreCandidates } from '../src/core/targets/resolver';
import { rectContains } from '../src/core/targets/scoring';
import { BlinkDetector } from '../src/core/blink/blinkDetector';
import { OneEuroFilter2D } from '../src/core/filters/oneEuro';
import { IDTDetector } from '../src/core/fixation/idt';
import { GazeModel } from '../src/core/gaze/regression';

// Seeded RNG (mulberry32) so every number is reproducible.
let seed = 20261116;
function rnd() { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
Math.random = rnd;
function gauss() { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const fakeEl = () => ({ contains: () => false }) as unknown as Element;
const VP = 1920 * 1080;

// ---------- E1: raw gaze point vs semantic snapping ----------
function layout(w: number, h: number, gap: number, cols: number, rows: number) {
  const out: any[] = [];
  const x0 = 400, y0 = 300;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const left = x0 + c * (w + gap), top = y0 + r * (h + gap);
    out.push({ el: fakeEl(), rect: { left, top, right: left + w, bottom: top + h }, kind: 'button', label: `b${r}${c}`, key: `b${r}${c}`, score: 0, dangerous: false });
  }
  return out;
}
const layouts = [
  { name: 'Large buttons 160x48, gap 24', c: layout(160, 48, 24, 5, 4) },
  { name: 'Medium buttons 96x36, gap 12', c: layout(96, 36, 12, 6, 4) },
  { name: 'Small icons 40x40, gap 8', c: layout(40, 40, 8, 8, 4) },
];
const E1: any[] = [];
const N = 5000;
for (const L of layouts) for (const sigma of [30, 60, 90]) {
  let raw = 0, snapOk = 0, chooser = 0, wrong = 0;
  // interior targets only, so every target has neighbours on all sides
  const inner = L.c.filter((_: any, i: number) => true);
  for (let k = 0; k < N; k++) {
    const t = inner[Math.floor(rnd() * inner.length)];
    const cx = (t.rect.left + t.rect.right) / 2, cy = (t.rect.top + t.rect.bottom) / 2;
    const p = { x: cx + gauss() * sigma, y: cy + gauss() * sigma };
    if (rectContains(t.rect, p)) raw++;
    const ranked = scoreCandidates(L.c, p, sigma, VP);
    if (!ranked.length) { wrong++; continue; }
    const amb = ranked.length > 1 && ranked[1].score / ranked[0].score > 0.7;
    if (amb) { if (ranked[0].key === t.key || ranked[1].key === t.key) chooser++; else wrong++; }
    else if (ranked[0].key === t.key) snapOk++; else wrong++;
  }
  E1.push({ layout: L.name, sigma, rawPct: (100 * raw / N).toFixed(1), snapPct: (100 * snapOk / N).toFixed(1), chooserPct: (100 * chooser / N).toFixed(1), wrongPct: (100 * wrong / N).toFixed(1) });
}
console.log('E1', JSON.stringify(E1, null, 1));

// ---------- E2: blink classification ----------
function trace(durMs: number, noise: number) {
  const fps = 30, dt = 1000 / fps, out: number[] = [];
  for (let t = 0; t < 500; t += dt) out.push(0.1 + gauss() * noise);
  for (let t = 0; t < durMs; t += dt) out.push(0.75 + gauss() * noise);
  for (let t = 0; t < 600; t += dt) out.push(0.1 + gauss() * noise);
  return out.map((s) => Math.min(1, Math.max(0, s)));
}
const E2: any = {};
for (const noise of [0.05, 0.1, 0.15]) {
  const res: any = { natural: { n: 0, deliberate: 0 }, deliberate: { n: 0, deliberate: 0 }, rest: { n: 0, deliberate: 0 } };
  const run = (kind: string, lo: number, hi: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const d = lo + rnd() * (hi - lo);
      const b = new BlinkDetector(0.45, 500, 2000);
      let fired = 0;
      trace(d, noise).forEach((s, j) => { const e = b.push(s, j * (1000 / 30)); if (e?.type === 'deliberate') fired++; });
      res[kind].n++; if (fired) res[kind].deliberate++;
    }
  };
  run('natural', 100, 400, 1000);
  run('deliberate', 600, 1800, 1000);
  run('rest', 2300, 4000, 500);
  E2[noise] = res;
}
console.log('E2', JSON.stringify(E2));

// ---------- E3: gaze model accuracy and drift correction ----------
const feat = (sx: number, sy: number, noise = 0, shift = 0) => {
  const h = (sx - 960) / 4000 + shift + noise * gauss();
  const v = (sy - 540) / 6000 + noise * gauss();
  return [h, v, h * 1.02, v * 0.98, h * 3, v * 3, h * 3, v * 3, 0.01, 0.02, 0, shift * 100, 0, -40, 0.3, 0.3];
};
const test = [] as [number, number][];
for (let i = 0; i < 200; i++) test.push([100 + rnd() * 1720, 80 + rnd() * 920]);
const E3: any[] = [];
for (const noise of [0.0005, 0.001, 0.002]) {
  const X: number[][] = [], Y: any[] = [];
  for (const gx of [0.08, 0.3, 0.5, 0.7, 0.92]) for (const gy of [0.08, 0.5, 0.92]) for (let k = 0; k < 20; k++) { X.push(feat(gx * 1920, gy * 1080, noise)); Y.push({ x: gx * 1920, y: gy * 1080 }); }
  const m = GazeModel.fit(X, Y, 0.5);
  const errs = test.map(([sx, sy]) => { const p = m.predict(feat(sx, sy, noise)); return Math.hypot(p.x - sx, p.y - sy); }).sort((a, b) => a - b);
  // drift: head shift then 6 learned selections
  const shift = 0.03;
  const errShift = () => test.reduce((a, [sx, sy]) => { const p = m.predict(feat(sx, sy, noise, shift)); return a + Math.hypot(p.x - sx, p.y - sy); }, 0) / test.length;
  const before = errShift();
  for (const [sx, sy] of [[300, 200], [1600, 250], [900, 600], [400, 900], [1500, 950], [1000, 300]]) m.learn([feat(sx, sy, noise, shift), feat(sx, sy, noise, shift)], { x: sx, y: sy });
  const after = errShift();
  E3.push({ noise, meanPx: (errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1), medianPx: errs[100].toFixed(1), driftBefore: before.toFixed(1), driftAfter6: after.toFixed(1) });
}
console.log('E3', JSON.stringify(E3));

// ---------- E4: per-frame cost ----------
const f2 = new OneEuroFilter2D(1, 0.003); const idt = new IDTDetector(200, 90);
const X: number[][] = [], Y: any[] = [];
for (const gx of [0.1, 0.5, 0.9]) for (const gy of [0.1, 0.5, 0.9]) for (let k = 0; k < 20; k++) { X.push(feat(gx * 1920, gy * 1080, 0.001)); Y.push({ x: gx * 1920, y: gy * 1080 }); }
const gm = GazeModel.fit(X, Y, 0.5);
const cands = layout(96, 36, 12, 6, 5);
const F = 100000; const fv = feat(900, 500, 0.001);
const timeIt = (fn: (i: number) => void) => { for (let i = 0; i < 2000; i++) fn(i); const t0 = performance.now(); for (let i = 0; i < F; i++) fn(i); return ((performance.now() - t0) * 1000 / F).toFixed(2); };
const E4 = {
  predictUs: timeIt(() => gm.predict(fv)),
  filterIdtUs: timeIt((i) => { const p = f2.filter(900 + gauss() * 20, 500 + gauss() * 20, i * 33.3); idt.push(p.x, p.y, i * 33.3); }),
  score30Us: timeIt(() => scoreCandidates(cands, { x: 700, y: 400 }, 60, VP)),
  calibFitMs: (() => { const t0 = performance.now(); for (let i = 0; i < 20; i++) GazeModel.fit(X, Y, 0.5); return ((performance.now() - t0) / 20).toFixed(2); })(),
};
console.log('E4', JSON.stringify(E4));
