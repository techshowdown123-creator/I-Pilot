/** Shared types for the I-Pilot pipeline. All gaze coordinates are CSS pixels. */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * One processed camera frame (stages 1-2): landmark-derived features plus
 * blink scores. Produced by the MediaPipe source, consumed by the gaze model.
 */
export interface FaceFrame {
  /** Timestamp in ms (performance.now() of the producer). */
  t: number;
  faceDetected: boolean;
  /** Gaze feature vector, see gaze/features.ts. Empty when no face. */
  features: number[];
  /** Where the face is in the image and how it's turned (gaze/headPose.ts). */
  pose?: import('./gaze/headPose').HeadPose;
  /** Eye-closure scores 0..1 from MediaPipe blendshapes. */
  blinkLeft: number;
  blinkRight: number;
}

/** A gaze estimate in *screen* coordinates (stage 3 output). */
export interface GazeSample {
  t: number;
  /** Screen-space CSS px (window.screenX-relative), NaN when invalid. */
  x: number;
  y: number;
  faceDetected: boolean;
  /** Mean eye-closure 0..1. */
  blink: number;
}

/** A sample converted to viewport coordinates (what the page sees). */
export interface ViewportSample {
  t: number;
  x: number;
  y: number;
  faceDetected: boolean;
  blink: number;
  onScreen: boolean;
}

export interface Fixation {
  /** Centroid of the fixation window in viewport px. */
  x: number;
  y: number;
  start: number;
  end: number;
  dispersion: number;
}

export type TargetKind = 'button' | 'link' | 'input' | 'select' | 'role' | 'generic' | 'grid' | 'overlay';

export interface Candidate {
  /** Element that will receive the action. */
  el: Element;
  rect: Rect;
  kind: TargetKind;
  label: string;
  /** For grid-fallback targets: the exact point to click. */
  point?: Point;
  /** Stable identity for hysteresis (element + grid cell). */
  key: string;
  score: number;
  dangerous: boolean;
}

export interface Resolution {
  best: Candidate | null;
  /** Top candidates, sorted by score (best first). */
  ranked: Candidate[];
  ambiguous: boolean;
}

export type PilotState = 'TRACKING' | 'LOCKED' | 'PAUSED';

export type PauseReason = 'face-lost' | 'off-screen' | 'user' | 'not-calibrated' | 'stopped';

export type SelectionMethod = 'blink' | 'dwell';
export type ClickAction = 'click' | 'dblclick';
