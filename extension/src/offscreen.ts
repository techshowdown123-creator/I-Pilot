/// <reference types="chrome" />
import { MediaPipeFrameSource } from '@core/input/mediapipe';
import type { FaceFrame } from '@core/types';
import { FRAME_PORT, type RuntimeMessage } from './protocol';

/**
 * Offscreen document: the single place the webcam is opened. Frames are
 * reduced to a small feature vector + blink scores here and streamed to the
 * visible tab's content script; video never leaves this document.
 */
const ports = new Set<chrome.runtime.Port>();
const status = (m: Omit<Extract<RuntimeMessage, { type: 'camera-status' }>, 'type'>) =>
  chrome.runtime.sendMessage({ type: 'camera-status', ...m } satisfies RuntimeMessage).catch(() => {});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== FRAME_PORT) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});

const source = new MediaPipeFrameSource({
  wasmPath: chrome.runtime.getURL('mediapipe/wasm'),
  modelPath: chrome.runtime.getURL('mediapipe/face_landmarker.task'),
  loop: 'track',
});

let lastStatus = 0;
source.subscribeFrames((f: FaceFrame) => {
  for (const p of ports) {
    try {
      p.postMessage(f);
    } catch {
      ports.delete(p);
    }
  }
  if (f.t - lastStatus > 2000) {
    lastStatus = f.t;
    void status({ status: 'running', fps: Math.round(source.fps) });
  }
});

void status({ status: 'starting' });
source.start().then(
  () => status({ status: 'running' }),
  (e: unknown) => status({ status: 'error', error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) }),
);
