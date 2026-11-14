import { describe, expect, it } from 'vitest';
import { distanceToRect, gaussianRectMass, normCdf, sizeWeight } from '../../src/core/targets/scoring';
import { scoreCandidates } from '../../src/core/targets/resolver';
import type { Candidate, Rect } from '../../src/core/types';

const rect = (l: number, t: number, w: number, h: number): Rect => ({ left: l, top: t, right: l + w, bottom: t + h });

function cand(el: Element, r: Rect, kind: Candidate['kind'] = 'button', key?: string): Candidate {
  return { el, rect: r, kind, label: key ?? 'x', key: key ?? Math.random().toString(36), score: 0, dangerous: false };
}

describe('scoring primitives', () => {
  it('normCdf matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1)).toBeCloseTo(0.1587, 3);
  });

  it('Gaussian mass is ~1 for a huge rect and smaller for an off-centre small one', () => {
    expect(gaussianRectMass({ x: 0, y: 0 }, rect(-1000, -1000, 2000, 2000), 50)).toBeCloseTo(1, 5);
    const centred = gaussianRectMass({ x: 0, y: 0 }, rect(-20, -20, 40, 40), 50);
    const offset = gaussianRectMass({ x: 100, y: 0 }, rect(-20, -20, 40, 40), 50);
    expect(centred).toBeGreaterThan(offset);
  });

  it('distanceToRect is 0 inside and Euclidean to the nearest edge outside', () => {
    expect(distanceToRect({ x: 5, y: 5 }, rect(0, 0, 10, 10))).toBe(0);
    expect(distanceToRect({ x: 13, y: 14 }, rect(0, 0, 10, 10))).toBe(5);
  });

  it('size weight discounts very large regions', () => {
    expect(sizeWeight(rect(0, 0, 40, 40), 1e6)).toBeGreaterThan(sizeWeight(rect(0, 0, 900, 900), 1e6));
  });
});

describe('scoreCandidates', () => {
  it('prefers the element under the gaze over a neighbour', () => {
    const a = document.createElement('button');
    const b = document.createElement('button');
    const ranked = scoreCandidates([cand(a, rect(0, 0, 50, 50), 'button', 'a'), cand(b, rect(60, 0, 50, 50), 'button', 'b')], { x: 20, y: 25 }, 40, 1e6);
    expect(ranked[0].key).toBe('a');
    expect(ranked[1].score / ranked[0].score).toBeLessThan(0.7);
  });

  it('flags near-ties between adjacent small targets', () => {
    const a = document.createElement('button');
    const b = document.createElement('button');
    // Gaze exactly between two 36 px buttons 4 px apart, sigma 60 px.
    const ranked = scoreCandidates([cand(a, rect(0, 0, 36, 36), 'button', 'a'), cand(b, rect(40, 0, 36, 36), 'button', 'b')], { x: 38, y: 18 }, 60, 1e6);
    expect(ranked[1].score / ranked[0].score).toBeGreaterThan(0.9);
  });

  it('subtracts clickable children from a clickable container', () => {
    const card = document.createElement('div');
    const link = document.createElement('a');
    card.appendChild(link);
    const ranked = scoreCandidates(
      [cand(card, rect(0, 0, 400, 200), 'role', 'card'), cand(link, rect(150, 90, 60, 20), 'link', 'link')],
      { x: 180, y: 100 },
      20,
      1e6,
    );
    expect(ranked[0].key).toBe('link');
    // Looking at the card away from the link picks the card.
    const ranked2 = scoreCandidates(
      [cand(card, rect(0, 0, 400, 200), 'role', 'card'), cand(link, rect(150, 90, 60, 20), 'link', 'link')],
      { x: 40, y: 40 },
      20,
      1e6,
    );
    expect(ranked2[0].key).toBe('card');
  });
});
