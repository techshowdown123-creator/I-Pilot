/// <reference types="chrome" />
import { PilotEngine } from '@core/engine/engine';
import { CameraGazeSource, type FrameProvider } from '@core/input/sources';
import { GazeModel } from '@core/gaze/regression';
import { runCalibration, isCancelled } from '@core/gaze/calibration';
import type { FaceFrame } from '@core/types';
import { FRAME_PORT, getStored, type RuntimeMessage, type StoredState } from './protocol';

/** Receives face frames from the offscreen camera document over a runtime port. */
class RemoteFrameSource implements FrameProvider {
  private port: chrome.runtime.Port | null = null;
  private fns = new Set<(f: FaceFrame) => void>();
  private wanted = false;
  private retry = 0;

  get running(): boolean {
    return !!this.port;
  }

  subscribeFrames(fn: (f: FaceFrame) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  async start(): Promise<void> {
    this.wanted = true;
    this.connect();
  }

  stop(): void {
    this.wanted = false;
    clearTimeout(this.retry);
    this.port?.disconnect();
    this.port = null;
  }

  private connect(): void {
    if (!this.wanted || this.port) return;
    try {
      const port = chrome.runtime.connect({ name: FRAME_PORT });
      this.port = port;
      port.onMessage.addListener((f: FaceFrame) => this.fns.forEach((fn) => fn(f)));
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError; // offscreen not ready yet, or closed
        this.port = null;
        // While enabled, keep trying: the camera page may still be starting.
        if (this.wanted) this.retry = window.setTimeout(() => this.connect(), 1000);
      });
    } catch {
      // Extension was reloaded: this content script is orphaned.
      this.wanted = false;
    }
  }
}

let engine: PilotEngine | null = null;
let frames: RemoteFrameSource | null = null;
let camera: CameraGazeSource | null = null;
let state: StoredState | null = null;
let appliedSettings = '';

function visible(): boolean {
  return document.visibilityState === 'visible';
}

// The I-Pilot demo app runs its own engine; don't stack a second one on it.
const hostIsApp = !!document.querySelector('meta[name="ipilot-app"]');

async function apply(): Promise<void> {
  if (hostIsApp) return;
  state = await getStored();
  if (!state.enabled) {
    camera?.stop();
    engine?.destroy();
    engine = null;
    camera = null;
    frames = null;
    return;
  }
  const settingsJSON = JSON.stringify(state.settings);
  if (!engine) {
    engine = new PilotEngine(state.settings);
    frames = new RemoteFrameSource();
    camera = new CameraGazeSource(frames, null);
    engine.setSource(camera);
    // Share what the model learns from selections with every tab (throttled).
    let pending = 0;
    camera.onModelChange((m) => {
      clearTimeout(pending);
      pending = window.setTimeout(() => void chrome.storage.local.set({ model: m.toJSON() }), 1500);
    });
  } else if (settingsJSON !== appliedSettings) {
    engine.updateSettings(state.settings);
  }
  appliedSettings = settingsJSON;
  // Only swap the model if another tab (or a calibration) changed it, so a
  // storage write doesn't reset what this tab is doing.
  const current = camera!.getModel();
  const incoming = state.model;
  if (!incoming) camera!.setModel(null);
  else if (!current || (incoming.updatedAt ?? incoming.createdAt) !== current.version) camera!.setModel(GazeModel.fromJSON(incoming));
  engine.refreshStatus();
  if (visible()) await camera!.start();
  else camera!.stop();
}

async function calibrate(): Promise<void> {
  if (!state?.enabled) {
    await chrome.storage.local.set({ enabled: true });
    await apply();
  }
  if (!engine || !camera || !frames) return;
  await camera.start();
  engine.setCalibrating(true);
  try {
    const res = await runCalibration(engine.overlay, frames, { blinkThreshold: engine.settings.blinkClosedThreshold });
    const settings = { ...(state?.settings ?? {}) };
    if (Number.isFinite(res.rmsPx)) settings.gazeSigmaPx = Math.round(Math.min(160, Math.max(30, res.rmsPx)));
    if (Number.isFinite(res.jitterPx)) settings.fixationDispersionPx = Math.round(Math.min(260, Math.max(70, res.jitterPx * 2.2)));
    if (res.blinkThreshold !== null) settings.blinkClosedThreshold = Math.round(res.blinkThreshold * 100) / 100;
    // Saving triggers storage.onChanged → apply() in every tab, so all tabs share the calibration.
    await chrome.storage.local.set({ model: res.model.toJSON(), settings, calibration: { errorPx: res.errorPx, rmsPx: res.rmsPx, at: Date.now() } });
    engine.overlay.toast(`Calibrated · ${Math.round(res.errorPx)} px average error`);
  } catch (e) {
    if (!isCancelled(e)) engine.overlay.toast(e instanceof Error ? e.message : String(e), true);
  } finally {
    engine?.setCalibrating(false);
  }
}

chrome.storage.onChanged.addListener((_c, area) => {
  if (area === 'local') void apply();
});

document.addEventListener('visibilitychange', () => {
  if (!camera || !state?.enabled) return;
  // Only the visible tab listens to the camera stream.
  if (visible()) void camera.start();
  else camera.stop();
});

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _s, sendResponse) => {
  if (msg.type === 'calibrate') {
    void calibrate();
    sendResponse(true);
  } else if (msg.type === 'toggle-pause') {
    engine?.togglePause();
    sendResponse(true);
  }
  return false;
});

void apply();
