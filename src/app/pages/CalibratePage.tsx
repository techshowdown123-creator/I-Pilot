import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { usePilot } from '../context/PilotContext';
import { pxToDegrees } from '@core/settings';
import { FaceGuide } from '../components/FaceGuide';

/** Step 1: start the camera, see yourself, calibrate. Then on to the game. */
export function CalibratePage() {
  const p = usePilot();
  const previewRef = useRef<HTMLDivElement>(null);
  const cameraOn = p.source === 'camera';
  const calibrated = !!p.calibration && cameraOn;
  const busy = p.status === 'starting' || p.status === 'calibrating';

  // Mirrored camera preview so the user can centre their face. It is a
  // separate <video> showing the same stream: moving the tracker's own video
  // element into the page would get it paused by the browser when this page
  // is left (removed media elements are paused), stopping the face tracking.
  useEffect(() => {
    const host = previewRef.current;
    const stream = p.frames?.video.srcObject;
    if (!host || !(stream instanceof MediaStream) || !cameraOn) return;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.className = 'h-full w-full -scale-x-100 object-cover';
    v.srcObject = stream;
    host.appendChild(v);
    void v.play().catch(() => {});
    return () => {
      v.srcObject = null;
      v.remove();
    };
  }, [p.frames, cameraOn, p.status]);

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="card">
        <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Step 1</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Calibrate your eyes</h1>
        <p className="mt-2 text-slate-600">About a minute. Everything runs on this device; no video leaves your computer.</p>

        <ol className="mt-5 space-y-3">
          {[
            ['Blink check', 'Eyes open, then closed until you hear the beep.'],
            ['Follow the dot', 'Head still, follow the dot with your eyes only.'],
            ['Move your head', 'One movement at a time (nod, turn, lean): read its instruction, then keep your eyes on the centre dot while you do it.'],          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
              <span>
                <span className="font-semibold">{t}.</span> <span className="text-slate-600">{d}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* Webcam gaze is accurate to roughly 50–100 px, so the two actions are
            big and pushed to opposite ends of the row: a slightly-off estimate
            still lands clearly on one of them, not between them. */}
        <div className="mt-6 flex flex-col items-stretch gap-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          {!cameraOn ? (
            <button className="btn-primary min-h-16 w-full px-8 text-lg sm:w-auto" onClick={() => p.startCamera()} disabled={busy} data-testid="start-camera">
              {p.status === 'starting' ? 'Starting camera…' : 'Start camera'}
            </button>
          ) : (
            <button className="btn-primary min-h-16 w-full px-8 text-lg sm:w-auto" onClick={() => p.calibrate()} disabled={busy} data-testid="calibrate">
              {p.calibration ? 'Recalibrate' : 'Calibrate'}
            </button>
          )}
          {calibrated && (
            <Link to="/game" className="btn-primary min-h-16 w-full bg-emerald-600 px-8 text-lg hover:bg-emerald-700 sm:w-auto" data-testid="play">
              Play Lantern Drift →
            </Link>
          )}
        </div>
        {calibrated && (
          <label className="mt-5 flex min-h-12 cursor-pointer items-center gap-3 text-slate-700" data-testid="gaze-dot-toggle">
            <input
              type="checkbox"
              className="h-6 w-6 accent-brand-600"
              checked={p.settings.showGazeDot}
              onChange={(e) => p.updateSettings({ showGazeDot: e.target.checked })}
            />
            Show where I-Pilot thinks I’m looking (a small dot)
          </label>
        )}
        {cameraOn && (
          <button
            className="btn-secondary mt-3 flex min-h-14 w-full justify-center text-lg"
            onClick={() => p.calibrate({ guided: true })}
            disabled={busy}
            data-testid="calibrate-guided"
          >
            Guided calibration: go at your own pace and watch it learn
          </button>
        )}
        {calibrated && (
          <Link to="/tune" className="btn-secondary mt-3 flex min-h-14 w-full justify-center text-lg" data-testid="tune">
            Fine-tune: correct my guesses →
          </Link>
        )}
        {p.error && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 font-medium text-red-700" role="alert">
            {p.error}
          </p>
        )}

        {p.calibration && (
          <div className="mt-6 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200" data-testid="calibration-result">
            <div className="font-semibold">
              Calibrated · average error {Math.round(p.calibration.errorPx)} px ({pxToDegrees(p.calibration.errorPx, p.settings).toFixed(1)}°)
            </div>
            {p.calibration.cvErrorPx !== undefined && Number.isFinite(p.calibration.cvErrorPx) && (
              <div className="mt-1 text-sm text-slate-600" data-testid="cv-error">
                Calibration dots predicted without seeing them: {Math.round(p.calibration.cvErrorPx)} px. Expect about this much once you look around.
              </div>
            )}
            {p.calibration.headStepUsed !== undefined && (
              <div className="mt-1 text-sm text-slate-600" data-testid="head-step">
                {p.calibration.headStepUsed
                  ? 'Head-movement step used: small head movements are corrected.'
                  : 'Head-movement step not used: it made accuracy worse (your eyes may have left the dot). Keep your head still while using I-Pilot.'}
              </div>
            )}
            <div className="mt-1 text-sm text-slate-500">{new Date(p.calibration.at).toLocaleString()}</div>
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-4">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900" ref={previewRef} data-testid="camera-preview">
          {!cameraOn && <div className="flex h-full items-center justify-center text-slate-400">Camera preview</div>}
          {cameraOn && p.frames && <FaceGuide frames={p.frames} reference={p.calibration?.headPose} />}
        </div>
        <ul className="space-y-2 text-sm text-slate-600">
          <li>• Sit about an arm’s length from the screen with your face in the dashed outline. After calibrating, the outline marks where you sat: come back to it if accuracy drops.</li>
          <li>• Light your face from the front (a lamp or window behind the screen), not from behind.</li>
          <li>• Recalibrate if you move your seat or the laptop.</li>
        </ul>
      </section>
    </div>
  );
}
