import type { PilotSettings } from '@core/settings';
import type { GazeModelJSON } from '@core/gaze/regression';

/** Port name content scripts use to receive face frames from the offscreen camera page. */
export const FRAME_PORT = 'ipilot-frames';

export interface StoredState {
  enabled: boolean;
  settings: Partial<PilotSettings>;
  model: GazeModelJSON | null;
  calibration: { errorPx: number; rmsPx: number; at: number } | null;
}

export const DEFAULT_STORED: StoredState = { enabled: false, settings: {}, model: null, calibration: null };

export type RuntimeMessage =
  | { type: 'camera-status'; status: 'starting' | 'running' | 'error'; error?: string; fps?: number }
  | { type: 'get-camera-status' }
  | { type: 'calibrate' }
  | { type: 'toggle-pause' }
  | { type: 'open-permission' };

export async function getStored(): Promise<StoredState> {
  const s = (await chrome.storage.local.get(Object.keys(DEFAULT_STORED) as (keyof StoredState)[])) as Partial<StoredState>;
  return { ...DEFAULT_STORED, ...s };
}
