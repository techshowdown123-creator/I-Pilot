import type { ClickAction, SelectionMethod } from './types';

export interface PilotSettings {
  /** Semantic snapping on (conditions B/C) or raw gaze cursor (condition A). */
  snapping: boolean;
  selection: SelectionMethod;
  clickAction: ClickAction;

  // One Euro filter (Casiez et al. 2012)
  filterMinCutoff: number;
  filterBeta: number;

  // I-DT fixation detector (Salvucci & Goldberg 2000)
  fixationMinMs: number;
  fixationDispersionPx: number;

  // Blink detector
  /** Blendshape score above which the eyes count as closed (calibrated per user). */
  blinkClosedThreshold: number;
  /** Closures at least this long count as deliberate. */
  blinkMinMs: number;
  /** Closures longer than this are treated as resting the eyes and ignored. */
  blinkMaxMs: number;

  dwellMs: number;
  /** Std-dev of the Gaussian gaze-error model, px. Updated from calibration validation. */
  gazeSigmaPx: number;
  /** Second/first score ratio above which a target counts as ambiguous. */
  ambiguityRatio: number;
  /** New target must beat the current one by this factor to steal the lock. */
  hysteresis: number;

  confirmDangerous: boolean;
  showGazeDot: boolean;

  // Geometry for converting px errors to degrees.
  viewingDistanceCm: number;
  pxPerCm: number;
}

export const DEFAULT_SETTINGS: PilotSettings = {
  snapping: true,
  selection: 'blink',
  clickAction: 'click',
  filterMinCutoff: 0.6,
  filterBeta: 0.003,
  fixationMinMs: 200,
  fixationDispersionPx: 90,
  blinkClosedThreshold: 0.45,
  blinkMinMs: 500,
  blinkMaxMs: 2000,
  dwellMs: 1000,
  gazeSigmaPx: 60,
  ambiguityRatio: 0.7,
  hysteresis: 1.4,
  confirmDangerous: true,
  showGazeDot: false,
  viewingDistanceCm: 60,
  pxPerCm: 96 / 2.54,
};

export type Condition = 'A' | 'B' | 'C';

/** The three evaluation conditions from the synopsis (section 9). */
export const CONDITIONS: Record<Condition, { label: string; description: string; patch: Partial<PilotSettings> }> = {
  A: { label: 'A · Raw gaze cursor', description: 'No snapping, dwell at the cursor point (baseline).', patch: { snapping: false, selection: 'dwell' } },
  B: { label: 'B · Snapping + dwell', description: 'Semantic snapping with dwell-time selection.', patch: { snapping: true, selection: 'dwell' } },
  C: { label: 'C · Snapping + blink', description: 'Semantic snapping with blink-confirmed selection (proposed).', patch: { snapping: true, selection: 'blink' } },
};

export function conditionOf(s: PilotSettings): Condition | null {
  if (!s.snapping && s.selection === 'dwell') return 'A';
  if (s.snapping && s.selection === 'dwell') return 'B';
  if (s.snapping && s.selection === 'blink') return 'C';
  return null;
}

export function pxToDegrees(px: number, s: Pick<PilotSettings, 'pxPerCm' | 'viewingDistanceCm'>): number {
  return (Math.atan(px / s.pxPerCm / s.viewingDistanceCm) * 180) / Math.PI;
}
