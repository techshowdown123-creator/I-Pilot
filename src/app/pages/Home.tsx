import { Link } from 'react-router-dom';
import { usePilot } from '../context/PilotContext';
import { CONDITIONS, conditionOf, pxToDegrees, type Condition } from '@core/settings';

const STAGES = [
  ['Camera capture', 'getUserMedia webcam stream (secure context).'],
  ['Face & iris landmarks', 'MediaPipe Face Landmarker: 478 landmarks, blink blendshapes, head pose.'],
  ['Gaze estimation', 'Ridge regression from iris/head features to screen coordinates, fitted at calibration.'],
  ['Smoothing', 'One Euro filter: heavy smoothing when still, responsive on saccades.'],
  ['Fixation detection', 'I-DT finds stable “landings” (≥ 200 ms within a small radius).'],
  ['Target resolver', 'Scores nearby interactive DOM elements by Gaussian overlap, with hysteresis.'],
  ['Blink detector & state machine', 'TRACKING / LOCKED / PAUSED; deliberate ≥ 500 ms blinks select.'],
  ['Action executor & overlay', 'Dispatches pointer + click events and draws the highlight.'],
];

const DEMOS = [
  { to: '/demo/news', title: 'News portal', text: 'Menus and dense link lists.' },
  { to: '/demo/shop', title: 'Shop', text: 'Cards, buttons, and dangerous actions with confirmation.' },
  { to: '/demo/form', title: 'Form', text: 'Text entry with the gaze keyboard, selects, radios.' },
  { to: '/demo/dense', title: 'Dense targets', text: 'Tightly packed buttons to exercise disambiguation.' },
  { to: '/demo/canvas', title: 'Canvas', text: 'No DOM inside: coarse grid fallback.' },
];

export function Home() {
  const p = usePilot();
  const cond = conditionOf(p.settings);
  const running = p.source !== 'none';
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="card">
          <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Eye-gaze web interaction</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Look at it. Blink slowly. Done.</h1>
          <p className="mt-3 text-lg text-slate-600">
            I-Pilot estimates where you are looking with an ordinary webcam, snaps that estimate to the interactive element you most likely mean, and
            activates it with a deliberate slow blink. All video stays on this device.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="btn-primary" onClick={() => p.startCamera()} disabled={p.status === 'starting' || p.status === 'calibrating'} data-testid="start-camera">
              {p.source === 'camera' ? 'Camera running' : 'Start camera'}
            </button>
            <button className="btn-primary bg-emerald-600 hover:bg-emerald-700" onClick={() => p.calibrate()} disabled={p.status === 'calibrating'}>
              {p.calibration ? 'Recalibrate' : 'Calibrate'}
            </button>
            <button className="btn-secondary" onClick={() => p.startSimulation()} data-testid="start-sim">
              {p.source === 'mouse' ? 'Simulation running' : 'Simulate with mouse'}
            </button>
            {running && (
              <button className="btn-secondary" onClick={() => p.stop()}>
                Stop
              </button>
            )}
          </div>
          {p.error && <p className="mt-4 rounded-xl bg-red-50 p-3 font-medium text-red-700" role="alert">{p.error}</p>}
          <p className="mt-4 text-sm text-slate-500">
            {p.calibration
              ? `Calibrated ${new Date(p.calibration.at).toLocaleString()} · mean error ${Math.round(p.calibration.errorPx)} px (${pxToDegrees(p.calibration.errorPx, p.settings).toFixed(1)}°).`
              : 'Not calibrated yet. Camera mode needs a 30-second calibration; simulation mode does not.'}
          </p>
        </div>

        <div className="card">
          <h2 className="text-lg font-bold">Interaction condition</h2>
          <p className="mt-1 text-sm text-slate-500">The three conditions compared in the evaluation.</p>
          <div className="mt-4 space-y-3">
            {(Object.keys(CONDITIONS) as Condition[]).map((c) => (
              <button
                key={c}
                onClick={() => p.setCondition(c)}
                className={`w-full rounded-xl p-4 text-left ring-2 transition ${cond === c ? 'bg-brand-50 ring-brand-500' : 'bg-white ring-slate-200 hover:ring-slate-300'}`}
              >
                <div className="font-bold">{CONDITIONS[c].label}</div>
                <div className="text-sm text-slate-600">{CONDITIONS[c].description}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Try it on the demo pages</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {DEMOS.map((d) => (
            <Link key={d.to} to={d.to} className="card block transition hover:ring-brand-500">
              <div className="font-bold text-brand-700">{d.title}</div>
              <div className="mt-1 text-sm text-slate-600">{d.text}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="text-xl font-bold">How to use it</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-700">
            <li>Start the camera and calibrate: follow the dot with your eyes, keep your head still.</li>
            <li>Look at a link or button. When your gaze settles, it is outlined in blue.</li>
            <li>Close your eyes slowly for about half a second, then open them: the element is clicked. Normal blinks are ignored.</li>
            <li>If two targets are close together, both are numbered and a chooser with large tiles appears when you select.</li>
            <li>Look away or leave the camera view and I-Pilot pauses; it resumes on your next steady look.</li>
            <li>Use the toolbar on the right edge to pause, scroll or go back. Keyboard: Alt+Shift+P toggles pause, Esc closes dialogs.</li>
          </ol>
        </div>
        <div className="card">
          <h2 className="text-xl font-bold">Pipeline</h2>
          <ol className="mt-3 space-y-2">
            {STAGES.map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <span>
                  <span className="font-semibold">{t}.</span> <span className="text-slate-600">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
