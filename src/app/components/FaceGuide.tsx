import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePilot } from '../context/PilotContext';
import { DEFAULT_POSE, checkPose, type HeadPose } from '@core/gaze/headPose';
import type { MediaPipeFrameSource } from '@core/input/mediapipe';

/**
 * Face-position guide drawn over the (mirrored) camera preview: a dashed
 * outline where your face was when you calibrated (or a centred default
 * before calibrating), your face now (green when close enough, amber when
 * not), and what to do to get back.
 */
export function FaceGuide({ frames, reference }: { frames: MediaPipeFrameSource; reference: HeadPose | null | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pose, setPose] = useState<HeadPose | null>(null);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    const id = setInterval(() => setPose(frames.lastPose ? { ...frames.lastPose } : null), 100);
    return () => {
      ro.disconnect();
      clearInterval(id);
    };
  }, [frames]);

  const recorded = !!reference;
  const ref = reference ?? DEFAULT_POSE;
  const check = pose ? checkPose(pose, ref, recorded) : null;

  // Image (width units, unmirrored) → preview pixels: object-cover scaling, then mirrored.
  const vw = frames.video.videoWidth || 1280;
  const vh = frames.video.videoHeight || 720;
  const { w, h } = size;
  const s = Math.max(w / vw, h / vh);
  const ox = (w - vw * s) / 2;
  const oy = (h - vh * s) / 2;
  const oval = (q: HeadPose) => {
    const iod = q.iod * vw * s;
    const x = w - (ox + q.cx * vw * s);
    const y = oy + q.cy * vw * s + 0.2 * iod; // face centre sits a little below the eye line
    return { x, y, rx: 0.85 * iod, ry: 1.15 * iod, deg: (-q.roll * 180) / Math.PI };
  };
  const target = oval(ref);
  const now = pose ? oval(pose) : null;
  const tone = !check ? '#94a3b8' : check.ok ? '#22c55e' : '#f59e0b';

  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-10" data-testid="face-guide">
      {w > 0 && (
        <svg width={w} height={h} className="absolute inset-0">
          <ellipse
            cx={target.x}
            cy={target.y}
            rx={target.rx}
            ry={target.ry}
            transform={`rotate(${target.deg} ${target.x} ${target.y})`}
            fill="none"
            stroke="white"
            strokeWidth={3}
            strokeDasharray="10 8"
            opacity={0.9}
            data-testid="face-target"
          />
          {now && (
            <ellipse
              cx={now.x}
              cy={now.y}
              rx={now.rx}
              ry={now.ry}
              transform={`rotate(${now.deg} ${now.x} ${now.y})`}
              fill="none"
              stroke={tone}
              strokeWidth={3}
              data-testid="face-now"
            />
          )}
        </svg>
      )}
      <div
        className="absolute inset-x-0 bottom-0 bg-slate-950/70 px-3 py-2 text-center text-sm font-semibold"
        style={{ color: tone === '#94a3b8' ? '#e2e8f0' : tone }}
        data-testid="face-guide-hint"
      >
        {!check
          ? 'Looking for your face…'
          : check.ok
            ? recorded
              ? '✓ Same position as when you calibrated'
              : '✓ Good position'
            : `${check.hints.slice(0, 2).join(' · ')}${recorded ? ' (back to where you calibrated)' : ''}`}
      </div>
    </div>
  );
}

/**
 * A small hint on every page except calibration (which has the full guide):
 * shown when your head has been away from the calibration position for over
 * a second, hidden half a second after you're back.
 */
export function PositionHint() {
  const p = usePilot();
  const { pathname } = useLocation();
  const ref = p.calibration?.headPose;
  const frames = p.frames;
  const active = p.source === 'camera' && p.status === 'running' && !!ref && !!frames && pathname !== '/';
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    setHint(null);
    if (!active) return;
    let badSince: number | null = null;
    let goodSince: number | null = null;
    let shown = false;
    const id = setInterval(() => {
      const cur = frames!.lastPose;
      const t = performance.now();
      const c = cur ? checkPose(cur, ref!, true) : null;
      if (c && !c.ok) {
        goodSince = null;
        badSince ??= t;
        if (t - badSince > 1200) {
          shown = true;
          setHint(c.hints[0]);
        }
      } else {
        badSince = null;
        goodSince ??= t;
        if (shown && t - goodSince > 500) {
          shown = false;
          setHint(null);
        }
      }
    }, 200);
    return () => clearInterval(id);
  }, [active, frames, ref]);
  if (!hint) return null;
  return (
    <div
      data-ipilot-ignore=""
      data-testid="position-hint"
      className="pointer-events-none fixed left-1/2 top-[76px] z-40 -translate-x-1/2 rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900 shadow ring-1 ring-amber-300"
    >
      {hint} · accuracy is best where you calibrated
    </div>
  );
}
