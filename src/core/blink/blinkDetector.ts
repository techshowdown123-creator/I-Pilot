/**
 * Deliberate-blink detector. A closure is a run of frames with the blink
 * score above the closed threshold. Natural blinks (~100–400 ms) are
 * ignored; a closure between `minMs` and `maxMs` fires a deliberate blink
 * when the eyes re-open. Longer closures are treated as resting the eyes.
 */
export type BlinkEvent =
  | { type: 'close'; t: number }
  | { type: 'armed'; t: number } // closure has passed minMs – reopening will select
  | { type: 'deliberate'; t: number; closedAt: number; durationMs: number }
  | { type: 'natural'; t: number; durationMs: number }
  | { type: 'rest'; t: number; durationMs: number };

export class BlinkDetector {
  private closedAt: number | null = null;
  private armed = false;
  private lastT = 0;
  /** Durations of recent natural blinks, for diagnostics / threshold tuning. */
  readonly naturalDurations: number[] = [];

  constructor(
    public closedThreshold = 0.45,
    public minMs = 500,
    public maxMs = 2000,
    /** Hysteresis: eyes count as open again below threshold − this. */
    public openHysteresis = 0.1,
  ) {}

  get closed(): boolean {
    return this.closedAt !== null;
  }

  /** ms the eyes have currently been closed (0 if open). */
  closedFor(now: number): number {
    return this.closedAt === null ? 0 : now - this.closedAt;
  }

  get closeStart(): number | null {
    return this.closedAt;
  }

  reset(): void {
    this.closedAt = null;
    this.armed = false;
  }

  push(score: number, t: number): BlinkEvent | null {
    this.lastT = t;
    if (this.closedAt === null) {
      if (score >= this.closedThreshold) {
        this.closedAt = t;
        this.armed = false;
        return { type: 'close', t };
      }
      return null;
    }
    const dur = t - this.closedAt;
    if (score < this.closedThreshold - this.openHysteresis) {
      const closedAt = this.closedAt;
      this.closedAt = null;
      this.armed = false;
      if (dur < this.minMs) {
        this.naturalDurations.push(dur);
        if (this.naturalDurations.length > 50) this.naturalDurations.shift();
        return { type: 'natural', t, durationMs: dur };
      }
      if (dur > this.maxMs) return { type: 'rest', t, durationMs: dur };
      return { type: 'deliberate', t, closedAt, durationMs: dur };
    }
    if (!this.armed && dur >= this.minMs && dur <= this.maxMs) {
      this.armed = true;
      return { type: 'armed', t };
    }
    return null;
  }

  /** Called when the face disappears mid-closure: abandon it. */
  abort(): void {
    this.reset();
  }

  get lastTimestamp(): number {
    return this.lastT;
  }
}
