import { useEffect, useRef, useState } from 'react';
import { usePilot } from '../context/PilotContext';
import { pxToDegrees } from '@core/settings';
import type { ActivationEvent } from '@core/index';

/** Live diagnostics: camera preview, blink score, state, latency. */
export function DebugPanel() {
  const p = usePilot();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState({ blink: 0, fx: NaN, fy: NaN, closedMs: 0 });
  const [last, setLast] = useState<ActivationEvent | null>(null);
  const [, force] = useState(0);
  const latest = useRef(live);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!p.engine) return;
    const e = p.engine;
    const off1 = e.on('sample', (s) => (latest.current = { blink: s.blink, fx: s.fx, fy: s.fy, closedMs: e.blink.closedFor(s.t) }));
    const off2 = e.on('activate', (a) => setLast(a));
    const id = setInterval(() => {
      setLive(latest.current);
      force((n) => n + 1);
    }, 150);
    return () => {
      off1();
      off2();
      clearInterval(id);
    };
  }, [p.engine]);

  // Mount the camera <video> as a mirrored preview.
  useEffect(() => {
    const host = previewRef.current;
    const v = p.frames?.video;
    if (!host || !v || !open || p.source !== 'camera') return;
    v.className = 'h-full w-full -scale-x-100 object-cover';
    host.appendChild(v);
    return () => {
      if (v.parentElement === host) host.removeChild(v);
    };
  }, [p.frames, open, p.source, p.status]);

  if (p.source === 'none') return null;
  const s = p.settings;
  const stats = p.engine?.stats;
  const thr = s.blinkClosedThreshold;
  return (
    <aside className="fixed bottom-4 left-4 z-40 w-72 rounded-2xl bg-slate-900/95 text-slate-100 shadow-2xl ring-1 ring-white/10" aria-label="I-Pilot diagnostics" data-ipilot-ignore>
      <button className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-bold" onClick={() => setOpen(!open)}>
        Diagnostics <span className="text-xs text-slate-400">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 text-xs">
          {p.source === 'camera' && <div ref={previewRef} className="aspect-video overflow-hidden rounded-lg bg-black" />}
          <Row k="State" v={`${p.pilotState}${p.pauseReason ? ` (${p.pauseReason})` : ''}`} />
          {p.source === 'camera' && <Row k="Camera" v={`${p.frames?.fps.toFixed(0) ?? '–'} fps · ${p.frames?.delegateInUse ?? '–'}`} />}
          <Row k="Gaze" v={Number.isFinite(live.fx) ? `${Math.round(live.fx)}, ${Math.round(live.fy)} px` : '—'} />
          <Row k="σ (error model)" v={`${s.gazeSigmaPx} px · ${pxToDegrees(s.gazeSigmaPx, s).toFixed(1)}°`} />
          {p.calibration && p.source === 'camera' && (
            <Row k="Calibration error" v={`${Math.round(p.calibration.errorPx)} px · ${pxToDegrees(p.calibration.errorPx, s).toFixed(1)}°`} />
          )}
          <div>
            <div className="mb-1 flex justify-between text-slate-400">
              <span>Eye closure</span>
              <span>{live.closedMs > 0 ? `${Math.round(live.closedMs)} ms` : live.blink.toFixed(2)}</span>
            </div>
            <div className="relative h-2.5 overflow-hidden rounded bg-slate-700">
              <div className={`h-full ${live.blink >= thr ? 'bg-violet-400' : 'bg-emerald-400'}`} style={{ width: `${Math.min(100, live.blink * 100)}%` }} />
              <div className="absolute top-0 h-full w-0.5 bg-white" style={{ left: `${thr * 100}%` }} title="closed threshold" />
            </div>
          </div>
          {stats && <Row k="Blinks (deliberate / natural)" v={`${stats.deliberateBlinks} / ${stats.naturalBlinks}`} />}
          {last && <Row k="Last action" v={`${last.kind} · ${last.label.slice(0, 18)} · ${last.latencyMs.toFixed(0)} ms`} />}
          {p.source === 'mouse' && <p className="leading-snug text-slate-400">Simulation: the mouse is your gaze. Hold <kbd className="rounded bg-slate-700 px-1">Shift</kbd> ≥ {s.blinkMinMs} ms and release to blink-select. Move the mouse out of the window to look away.</p>}
        </div>
      )}
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400">{k}</span>
      <span className="truncate text-right font-mono">{v}</span>
    </div>
  );
}
