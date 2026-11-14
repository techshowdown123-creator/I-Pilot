import type { Candidate, PauseReason, PilotState } from '../types';

export interface Transition {
  from: PilotState;
  to: PilotState;
  reason: string;
  t: number;
}

/**
 * TRACKING  – following landings, nothing selected
 * LOCKED    – a target is highlighted; a deliberate blink / dwell activates it
 * PAUSED    – face lost, gaze off-screen, or user pause. No events are fired and
 *             the last cursor position is kept. Automatic pauses resume only
 *             after the face is back *and* a new stable fixation occurs.
 */
export class PilotStateMachine {
  state: PilotState = 'TRACKING';
  pauseReason: PauseReason | null = null;
  target: Candidate | null = null;
  /** Set while paused once the pause condition has cleared; the next landing resumes. */
  resumeArmed = false;
  private listeners: ((tr: Transition) => void)[] = [];

  onTransition(fn: (tr: Transition) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  private go(to: PilotState, reason: string, t: number): void {
    const from = this.state;
    this.state = to;
    if (from !== to) for (const l of this.listeners) l({ from, to, reason, t });
  }

  pause(reason: PauseReason, t: number): void {
    // A user pause outranks automatic ones; don't downgrade it.
    if (this.state === 'PAUSED' && this.pauseReason === 'user' && reason !== 'stopped') return;
    this.pauseReason = reason;
    this.resumeArmed = false;
    this.go('PAUSED', reason, t);
  }

  /** The automatic pause condition (face / on-screen) has cleared. */
  conditionCleared(reason: PauseReason): void {
    if (this.state === 'PAUSED' && this.pauseReason === reason) this.resumeArmed = true;
  }

  userResume(t: number): void {
    if (this.state !== 'PAUSED') return;
    this.pauseReason = null;
    this.resumeArmed = false;
    this.go(this.target ? 'LOCKED' : 'TRACKING', 'user-resume', t);
  }

  /** A new fixation landed and resolved to `best` (or nothing). */
  landing(best: Candidate | null, t: number): void {
    if (this.state === 'PAUSED') {
      if (!this.resumeArmed) return;
      this.pauseReason = null;
      this.resumeArmed = false;
    }
    this.target = best;
    this.go(best ? 'LOCKED' : 'TRACKING', best ? 'landing' : 'landing-empty', t);
  }

  /** Locked target vanished from the DOM / became hidden. */
  dropTarget(t: number): void {
    this.target = null;
    if (this.state === 'LOCKED') this.go('TRACKING', 'target-gone', t);
  }

  get canActivate(): boolean {
    return this.state === 'LOCKED' && !!this.target;
  }

  reset(t: number): void {
    this.target = null;
    this.pauseReason = null;
    this.resumeArmed = false;
    this.go('TRACKING', 'reset', t);
  }
}
