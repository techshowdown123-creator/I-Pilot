import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import {
  CameraGazeSource,
  CONDITIONS,
  DEFAULT_SETTINGS,
  SETTINGS_VERSION,
  migrateSettings,
  GazeModel,
  MouseGazeSource,
  PilotEngine,
  isCancelled,
  runCalibration,
  type Condition,
  type GazeModelJSON,
  type PauseReason,
  type PilotSettings,
  type PilotState,
} from '@core/index';
import { MediaPipeFrameSource } from '@core/input/mediapipe';
import { FEATURE_COUNT } from '@core/gaze/features';
import { load, save } from '../lib/storage';

export type SourceKind = 'none' | 'mouse' | 'camera';

export interface CalibrationInfo {
  errorPx: number;
  rmsPx: number;
  blinkThreshold: number | null;
  at: number;
  samples: number;
}

export interface SimOptions {
  noisePx: number;
  driftPx: number;
}

interface State {
  settings: PilotSettings;
  source: SourceKind;
  status: 'idle' | 'starting' | 'running' | 'calibrating' | 'error';
  error: string | null;
  pilotState: PilotState;
  pauseReason: PauseReason | null;
  calibration: CalibrationInfo | null;
  sim: SimOptions;
}

type Action =
  | { type: 'settings'; patch: Partial<PilotSettings> }
  | { type: 'source'; source: SourceKind }
  | { type: 'status'; status: State['status']; error?: string | null }
  | { type: 'pilot'; state: PilotState; pauseReason: PauseReason | null }
  | { type: 'calibration'; info: CalibrationInfo | null }
  | { type: 'sim'; patch: Partial<SimOptions> };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'settings':
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case 'source':
      return { ...s, source: a.source };
    case 'status':
      return { ...s, status: a.status, error: a.error ?? null };
    case 'pilot':
      return { ...s, pilotState: a.state, pauseReason: a.pauseReason };
    case 'calibration':
      return { ...s, calibration: a.info };
    case 'sim':
      return { ...s, sim: { ...s.sim, ...a.patch } };
  }
}

const K = { settingsVersion: 'ipilot.settingsVersion', settings: 'ipilot.settings', model: 'ipilot.model', calib: 'ipilot.calibration', sim: 'ipilot.sim' };

interface Ctx extends State {
  engine: PilotEngine | null;
  frames: MediaPipeFrameSource | null;
  startCamera: () => Promise<void>;
  startSimulation: () => Promise<void>;
  stop: () => void;
  calibrate: () => Promise<void>;
  clearCalibration: () => void;
  updateSettings: (p: Partial<PilotSettings>) => void;
  setCondition: (c: Condition) => void;
  setSim: (p: Partial<SimOptions>) => void;
}

const PilotCtx = createContext<Ctx | null>(null);

export function usePilot(): Ctx {
  const c = useContext(PilotCtx);
  if (!c) throw new Error('usePilot outside PilotProvider');
  return c;
}

const base = import.meta.env.BASE_URL;

/** A calibration made with an older gaze feature set can't be used; forget it so the UI asks for a new one. */
function dropIncompatibleCalibration(): void {
  const m = load<GazeModelJSON | null>(K.model, null);
  if (m && m.mean.length !== FEATURE_COUNT) {
    save(K.model, null);
    save(K.calib, null);
  }
}

export function PilotProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => (dropIncompatibleCalibration(), {
    settings: { ...DEFAULT_SETTINGS, ...migrateSettings(load<Partial<PilotSettings>>(K.settings, {}), load<number>(K.settingsVersion, 1)) },
    source: 'none' as SourceKind,
    status: 'idle' as const,
    error: null,
    pilotState: 'TRACKING' as PilotState,
    pauseReason: null,
    calibration: load<CalibrationInfo | null>(K.calib, null),
    sim: load<SimOptions>(K.sim, { noisePx: 0, driftPx: 0 }),
  }));
  const [engine, setEngine] = useState<PilotEngine | null>(null);
  const framesRef = useRef<MediaPipeFrameSource | null>(null);
  const cameraRef = useRef<CameraGazeSource | null>(null);
  const mouseRef = useRef<MouseGazeSource | null>(null);
  const settingsRef = useRef(state.settings);
  settingsRef.current = state.settings;

  // One engine per app lifetime (recreated cleanly under StrictMode).
  useEffect(() => {
    const e = new PilotEngine(settingsRef.current);
    const off = e.on('state', (ev) => dispatch({ type: 'pilot', state: ev.state, pauseReason: ev.pauseReason }));
    setEngine(e);
    // Handle for debugging and the Playwright tests.
    (window as unknown as { __ipilot?: PilotEngine }).__ipilot = e;
    return () => {
      off();
      cameraRef.current?.stop();
      mouseRef.current?.stop();
      e.destroy();
      setEngine(null);
    };
  }, []);

  useEffect(() => {
    save(K.settings, state.settings);
    save(K.settingsVersion, SETTINGS_VERSION);
  }, [state.settings]);
  useEffect(() => {
    save(K.sim, state.sim);
    if (mouseRef.current) Object.assign(mouseRef.current.opts, state.sim);
  }, [state.sim]);

  const ensureCamera = useCallback(async () => {
    if (!framesRef.current) {
      framesRef.current = new MediaPipeFrameSource({ wasmPath: base + 'mediapipe/wasm', modelPath: base + 'mediapipe/face_landmarker.task' });
    }
    if (!cameraRef.current) {
      const m = load<GazeModelJSON | null>(K.model, null);
      cameraRef.current = new CameraGazeSource(framesRef.current, m ? GazeModel.fromJSON(m) : null);
      // Persist what the model learns from selections (throttled).
      let pending = 0;
      cameraRef.current.onModelChange((model) => {
        clearTimeout(pending);
        pending = window.setTimeout(() => save(K.model, model.toJSON()), 1500);
      });
    }
    await cameraRef.current.start();
    return cameraRef.current;
  }, []);

  const stop = useCallback(() => {
    engine?.setSource(null);
    cameraRef.current?.stop();
    mouseRef.current?.stop();
    dispatch({ type: 'source', source: 'none' });
    dispatch({ type: 'status', status: 'idle' });
  }, [engine]);

  const startCamera = useCallback(async () => {
    if (!engine) return;
    mouseRef.current?.stop();
    dispatch({ type: 'status', status: 'starting' });
    try {
      const cam = await ensureCamera();
      engine.setSource(cam);
      dispatch({ type: 'source', source: 'camera' });
      dispatch({ type: 'status', status: 'running' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dispatch({ type: 'status', status: 'error', error: /Permission|NotAllowed/i.test(msg) ? 'Camera permission was denied.' : msg });
    }
  }, [engine, ensureCamera]);

  const startSimulation = useCallback(async () => {
    if (!engine) return;
    cameraRef.current?.stop();
    mouseRef.current ??= new MouseGazeSource(state.sim);
    await mouseRef.current.start();
    engine.setSource(mouseRef.current);
    dispatch({ type: 'source', source: 'mouse' });
    dispatch({ type: 'status', status: 'running' });
  }, [engine, state.sim]);

  const updateSettings = useCallback(
    (patch: Partial<PilotSettings>) => {
      dispatch({ type: 'settings', patch });
      engine?.updateSettings({ ...settingsRef.current, ...patch });
    },
    [engine],
  );

  const calibrate = useCallback(async () => {
    if (!engine) return;
    const prevSource = state.source;
    dispatch({ type: 'status', status: 'calibrating' });
    try {
      mouseRef.current?.stop();
      const cam = await ensureCamera();
      engine.setSource(cam);
      dispatch({ type: 'source', source: 'camera' });
      engine.setCalibrating(true);
      const res = await runCalibration(engine.overlay, cam.frames, { blinkThreshold: settingsRef.current.blinkClosedThreshold });
      cam.setModel(res.model);
      save(K.model, res.model.toJSON());
      const info: CalibrationInfo = { errorPx: res.errorPx, rmsPx: res.rmsPx, blinkThreshold: res.blinkThreshold, at: Date.now(), samples: res.samples };
      save(K.calib, info);
      dispatch({ type: 'calibration', info });
      const patch: Partial<PilotSettings> = {};
      if (Number.isFinite(res.rmsPx)) patch.gazeSigmaPx = Math.round(Math.min(160, Math.max(30, res.rmsPx)));
      // Fixation radius follows the measured jitter, so noisy setups still produce landings.
      if (Number.isFinite(res.jitterPx)) patch.fixationDispersionPx = Math.round(Math.min(200, Math.max(70, res.jitterPx * 2.2)));
      if (res.blinkThreshold !== null) patch.blinkClosedThreshold = Math.round(res.blinkThreshold * 100) / 100;
      updateSettings(patch);
      dispatch({ type: 'status', status: 'running' });
    } catch (err) {
      if (isCancelled(err)) dispatch({ type: 'status', status: prevSource === 'none' ? 'idle' : 'running' });
      else dispatch({ type: 'status', status: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      engine.setCalibrating(false);
    }
  }, [engine, ensureCamera, state.source, updateSettings]);

  const clearCalibration = useCallback(() => {
    save(K.model, null);
    save(K.calib, null);
    cameraRef.current?.setModel(null);
    dispatch({ type: 'calibration', info: null });
    engine?.refreshStatus();
  }, [engine]);

  const setCondition = useCallback((c: Condition) => updateSettings(CONDITIONS[c].patch), [updateSettings]);
  const setSim = useCallback((p: Partial<SimOptions>) => dispatch({ type: 'sim', patch: p }), []);

  const value = useMemo<Ctx>(
    () => ({ ...state, engine, frames: framesRef.current, startCamera, startSimulation, stop, calibrate, clearCalibration, updateSettings, setCondition, setSim }),
    [state, engine, startCamera, startSimulation, stop, calibrate, clearCalibration, updateSettings, setCondition, setSim],
  );
  return <PilotCtx.Provider value={value}>{children}</PilotCtx.Provider>;
}
