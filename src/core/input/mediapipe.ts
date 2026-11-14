import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import type { FaceFrame } from '../types';
import { blinkScores, extractFeatures } from '../gaze/features';
import { nowMs } from '../time';
import type { FrameProvider } from './sources';

export interface MediaPipeOptions {
  /** Folder holding vision_wasm_internal.{js,wasm}. */
  wasmPath: string;
  /** URL of face_landmarker.task. */
  modelPath: string;
  delegate?: 'GPU' | 'CPU';
  width?: number;
  height?: number;
  /**
   * 'video' drives detection with requestVideoFrameCallback (visible pages);
   * 'track' reads frames straight from the camera track with
   * MediaStreamTrackProcessor, which keeps running in hidden documents such
   * as the extension's offscreen page.
   */
  loop?: 'video' | 'track';
}

interface TrackProcessor {
  readable: ReadableStream<VideoFrame>;
}
declare const MediaStreamTrackProcessor: { new (init: { track: MediaStreamTrack; maxBufferSize?: number }): TrackProcessor } | undefined;

/**
 * Stages 1–2: webcam capture (getUserMedia, secure context required) and
 * MediaPipe Face Landmarker (iris landmarks, blink blendshapes, head pose).
 * Every frame is processed in memory on the device; nothing is stored or sent.
 */
export class MediaPipeFrameSource implements FrameProvider {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private landmarker: FaceLandmarker | null = null;
  private fns = new Set<(f: FaceFrame) => void>();
  private loopHandle = 0;
  private active = false;
  private lastVideoTime = -1;
  /** Most recent raw result, for the debug preview. */
  lastResult: FaceLandmarkerResult | null = null;
  fps = 0;
  private fpsCount = 0;
  private fpsT = 0;
  delegateInUse: 'GPU' | 'CPU' | null = null;

  constructor(private opts: MediaPipeOptions) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
  }

  get running(): boolean {
    return this.active;
  }

  subscribeFrames(fn: (f: FaceFrame) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  private async createLandmarker(): Promise<FaceLandmarker> {
    const fileset = await FilesetResolver.forVisionTasks(this.opts.wasmPath);
    const make = (delegate: 'GPU' | 'CPU') =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.opts.modelPath, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    const want = this.opts.delegate ?? 'GPU';
    try {
      const lm = await make(want);
      this.delegateInUse = want;
      return lm;
    } catch (e) {
      if (want === 'CPU') throw e;
      console.warn('[I-Pilot] GPU delegate failed, falling back to CPU', e);
      this.delegateInUse = 'CPU';
      return make('CPU');
    }
  }

  async start(): Promise<void> {
    if (this.active) return;
    if (!window.isSecureContext) throw new Error('Camera access needs a secure context (HTTPS or localhost).');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: this.opts.width ?? 1280 }, height: { ideal: this.opts.height ?? 720 }, facingMode: 'user', frameRate: { ideal: 30 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.landmarker ??= await this.createLandmarker();
    this.active = true;
    if (this.opts.loop === 'track' && typeof MediaStreamTrackProcessor === 'function') void this.trackLoop();
    else this.schedule();
  }

  private async trackLoop(): Promise<void> {
    const track = this.stream!.getVideoTracks()[0];
    const reader = new MediaStreamTrackProcessor!({ track, maxBufferSize: 1 }).readable.getReader();
    try {
      while (this.active) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        try {
          if (this.active && this.landmarker) this.detect(frame);
        } finally {
          frame.close();
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private detect(src: HTMLVideoElement | VideoFrame): void {
    const t = nowMs();
    const res = this.landmarker!.detectForVideo(src, performance.now());
    this.lastResult = res;
    this.emit(t, res);
    this.fpsCount++;
    if (t - this.fpsT > 1000) {
      this.fps = (this.fpsCount * 1000) / (t - this.fpsT);
      this.fpsCount = 0;
      this.fpsT = t;
    }
  }

  stop(): void {
    this.active = false;
    cancelAnimationFrame(this.loopHandle);
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    v.cancelVideoFrameCallback?.(this.loopHandle);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private schedule(): void {
    if (!this.active) return;
    const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    // requestVideoFrameCallback runs once per new camera frame (and keeps
    // running in background/offscreen documents where rAF is throttled).
    if (v.requestVideoFrameCallback) this.loopHandle = v.requestVideoFrameCallback(() => this.process());
    else this.loopHandle = requestAnimationFrame(() => this.process());
  }

  private process(): void {
    if (!this.active || !this.landmarker) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = v.currentTime;
      this.detect(v);
    }
    this.schedule();
  }

  private emit(t: number, res: FaceLandmarkerResult): void {
    const lm = res.faceLandmarks?.[0];
    let frame: FaceFrame;
    if (!lm) {
      frame = { t, faceDetected: false, features: [], blinkLeft: 0, blinkRight: 0 };
    } else {
      const shapes = res.faceBlendshapes?.[0]?.categories;
      const matrix = res.facialTransformationMatrixes?.[0]?.data;
      const b = blinkScores(shapes);
      frame = { t, faceDetected: true, features: extractFeatures(lm, shapes, matrix ? Array.from(matrix) : undefined), blinkLeft: b.left, blinkRight: b.right };
    }
    for (const f of this.fns) f(frame);
  }
}
