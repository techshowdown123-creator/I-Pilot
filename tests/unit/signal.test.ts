import { describe, expect, it } from 'vitest';
import { OneEuroFilter } from '../../src/core/filters/oneEuro';
import { IDTDetector } from '../../src/core/fixation/idt';
import { BlinkDetector } from '../../src/core/blink/blinkDetector';
import { DEFAULT_SETTINGS } from '../../src/core/settings';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const rand = rng(42);
const randn = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

describe('OneEuroFilter', () => {
  it('passes a constant signal through unchanged', () => {
    const f = new OneEuroFilter(1, 0.01);
    for (let i = 0; i < 50; i++) expect(f.filter(100, i * 33)).toBeCloseTo(100, 6);
  });

  it('reduces jitter on a still signal', () => {
    const f = new OneEuroFilter(DEFAULT_SETTINGS.filterMinCutoff, DEFAULT_SETTINGS.filterBeta);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 500 + randn() * 30;
      raw.push(x);
      out.push(f.filter(x, i * 33));
    }
    const sd = (a: number[]) => {
      const m = a.reduce((s, v) => s + v, 0) / a.length;
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
    };
    expect(sd(out.slice(50))).toBeLessThan(sd(raw.slice(50)) / 2.5);
  });

  it('follows a saccade quickly thanks to the speed-adaptive cutoff', () => {
    const slow = new OneEuroFilter(0.6, 0);
    const fast = new OneEuroFilter(0.6, 0.01);
    let a = 0,
      b = 0;
    for (let i = 0; i < 30; i++) {
      a = slow.filter(i < 10 ? 0 : 800, i * 33);
      b = fast.filter(i < 10 ? 0 : 800, i * 33);
      if (i === 15) expect(b).toBeGreaterThan(a);
    }
    expect(b).toBeGreaterThan(700);
  });
});

describe('IDTDetector', () => {
  it('registers a landing once samples stay within the dispersion limit for the minimum duration', () => {
    const d = new IDTDetector(200, 60);
    const events = [];
    for (let i = 0; i < 12; i++) {
      const e = d.push(300 + (i % 2) * 5, 200 + (i % 3) * 4, i * 33);
      if (e) events.push(e);
    }
    expect(events[0].type).toBe('start');
    expect(events[0].fixation.x).toBeGreaterThan(299);
    expect(events[0].fixation.x).toBeLessThan(306);
    // ~200 ms after the first sample
    expect(events[0].fixation.end - events[0].fixation.start).toBeGreaterThanOrEqual(200);
  });

  it('ends the fixation on a saccade and starts a new one at the new location', () => {
    const d = new IDTDetector(150, 60);
    const types: string[] = [];
    let t = 0;
    for (let i = 0; i < 10; i++) types.push(d.push(100, 100, (t += 33))?.type ?? '-');
    for (let i = 0; i < 10; i++) types.push(d.push(600, 400, (t += 33))?.type ?? '-');
    expect(types.filter((x) => x === 'start')).toHaveLength(2);
    expect(types).toContain('end');
    expect(d.fixation!.x).toBe(600);
  });

  it('does not land while the gaze keeps moving', () => {
    const d = new IDTDetector(200, 60);
    for (let i = 0; i < 40; i++) expect(d.push(i * 40, 300, i * 33)).toBeNull();
  });
});

describe('BlinkDetector', () => {
  const run = (d: BlinkDetector, closedMs: number, t0 = 0) => {
    const ev: string[] = [];
    let t = t0;
    for (; t < t0 + 200; t += 33) d.push(0.05, t) && ev.push('x');
    const start = t;
    for (; t < start + closedMs; t += 10) {
      const e = d.push(0.9, t);
      if (e) ev.push(e.type);
    }
    for (let i = 0; i < 5; i++, t += 33) {
      const e = d.push(0.05, t);
      if (e) ev.push(e.type);
    }
    return ev;
  };

  it('ignores natural blinks', () => {
    const d = new BlinkDetector(0.45, 500, 2000);
    expect(run(d, 200)).toEqual(['close', 'natural']);
    expect(d.naturalDurations[0]).toBeGreaterThanOrEqual(190);
  });

  it('fires a deliberate blink for a 500–2000 ms closure, arming first', () => {
    const d = new BlinkDetector(0.45, 500, 2000);
    expect(run(d, 700)).toEqual(['close', 'armed', 'deliberate']);
  });

  it('treats very long closures as resting the eyes', () => {
    const d = new BlinkDetector(0.45, 500, 2000);
    expect(run(d, 2600)).toEqual(['close', 'armed', 'rest']);
  });

  it('uses hysteresis so a score hovering near the threshold does not end the closure', () => {
    const d = new BlinkDetector(0.5, 500, 2000, 0.1);
    d.push(0.9, 0);
    expect(d.push(0.45, 100)).toBeNull(); // between 0.4 and 0.5: still closed
    expect(d.closed).toBe(true);
  });
});
