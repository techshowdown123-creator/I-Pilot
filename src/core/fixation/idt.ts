import type { Fixation } from '../types';

interface S {
  x: number;
  y: number;
  t: number;
}

export type FixationEvent =
  | { type: 'start'; fixation: Fixation }
  | { type: 'update'; fixation: Fixation }
  | { type: 'end'; fixation: Fixation };

/**
 * Online dispersion-threshold fixation identification (I-DT, Salvucci &
 * Goldberg 2000). A fixation ("landing") starts once samples spanning at least
 * `minDurationMs` stay within `maxDispersion` px, where dispersion is
 * (max x − min x) + (max y − min y). It ends on the first sample that breaks
 * the dispersion limit.
 */
export class IDTDetector {
  private win: S[] = [];
  private inFixation = false;
  private current: Fixation | null = null;

  constructor(
    public minDurationMs = 200,
    public maxDispersion = 90,
  ) {}

  get fixating(): boolean {
    return this.inFixation;
  }

  get fixation(): Fixation | null {
    return this.current;
  }

  reset(): FixationEvent | null {
    const ended = this.inFixation && this.current ? ({ type: 'end', fixation: this.current } as const) : null;
    this.win = [];
    this.inFixation = false;
    this.current = null;
    return ended;
  }

  push(x: number, y: number, t: number): FixationEvent | null {
    this.win.push({ x, y, t });

    if (this.inFixation) {
      if (dispersion(this.win) > this.maxDispersion) {
        const ended = this.current!;
        this.win = [{ x, y, t }];
        this.inFixation = false;
        this.current = null;
        return { type: 'end', fixation: ended };
      }
      // Cap window length so the centroid tracks slow drift during long fixations.
      while (this.win.length > 2 && this.win[this.win.length - 1].t - this.win[0].t > 1500) this.win.shift();
      this.current = summarize(this.win);
      return { type: 'update', fixation: this.current };
    }

    // Not fixating: drop oldest samples until the window satisfies dispersion.
    while (this.win.length > 1 && dispersion(this.win) > this.maxDispersion) this.win.shift();
    const span = this.win[this.win.length - 1].t - this.win[0].t;
    if (span >= this.minDurationMs) {
      this.inFixation = true;
      this.current = summarize(this.win);
      return { type: 'start', fixation: this.current };
    }
    return null;
  }
}

function dispersion(w: S[]): number {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const s of w) {
    if (s.x < minX) minX = s.x;
    if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.y > maxY) maxY = s.y;
  }
  return maxX - minX + (maxY - minY);
}

function summarize(w: S[]): Fixation {
  let sx = 0,
    sy = 0;
  for (const s of w) {
    sx += s.x;
    sy += s.y;
  }
  return { x: sx / w.length, y: sy / w.length, start: w[0].t, end: w[w.length - 1].t, dispersion: dispersion(w) };
}
