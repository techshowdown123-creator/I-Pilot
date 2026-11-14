import { useState } from 'react';
import { usePilot } from '../context/PilotContext';
import { DEFAULT_SETTINGS, pxToDegrees, type PilotSettings } from '@core/settings';
import { getLogServer, setLogServer } from '../lib/logServer';

type NumKey = { [K in keyof PilotSettings]: PilotSettings[K] extends number ? K : never }[keyof PilotSettings];

const NUMBERS: { key: NumKey; label: string; min: number; max: number; step: number; unit?: string; help: string }[] = [
  { key: 'blinkMinMs', label: 'Deliberate blink: minimum closure', min: 300, max: 1500, step: 50, unit: 'ms', help: 'Closures shorter than this are natural blinks and ignored.' },
  { key: 'blinkMaxMs', label: 'Deliberate blink: maximum closure', min: 1000, max: 5000, step: 100, unit: 'ms', help: 'Longer closures count as resting the eyes.' },
  { key: 'blinkClosedThreshold', label: 'Eye-closed threshold', min: 0.15, max: 0.9, step: 0.01, help: 'Blendshape score treated as “closed”. Set by calibration.' },
  { key: 'dwellMs', label: 'Dwell time', min: 400, max: 3000, step: 100, unit: 'ms', help: 'Fallback selection for users who cannot blink deliberately.' },
  { key: 'fixationMinMs', label: 'Fixation minimum duration', min: 100, max: 500, step: 10, unit: 'ms', help: 'I-DT: how long gaze must stay put to count as a landing.' },
  { key: 'fixationDispersionPx', label: 'Fixation dispersion limit', min: 20, max: 250, step: 5, unit: 'px', help: 'I-DT: (max−min x) + (max−min y) allowed within a fixation.' },
  { key: 'gazeSigmaPx', label: 'Gaze error σ', min: 10, max: 200, step: 1, unit: 'px', help: 'Width of the Gaussian error model used to score targets.' },
  { key: 'ambiguityRatio', label: 'Ambiguity ratio', min: 0.3, max: 1, step: 0.05, help: 'Runner-up/best score above this opens the chooser.' },
  { key: 'hysteresis', label: 'Hysteresis factor', min: 1, max: 3, step: 0.05, help: 'A new target must score this many times higher to steal the lock.' },
  { key: 'filterMinCutoff', label: 'One Euro: min cutoff', min: 0.05, max: 5, step: 0.05, unit: 'Hz', help: 'Lower = smoother but laggier when still.' },
  { key: 'filterBeta', label: 'One Euro: beta', min: 0, max: 0.05, step: 0.001, help: 'Higher = more responsive during fast eye movements.' },
  { key: 'viewingDistanceCm', label: 'Viewing distance', min: 30, max: 120, step: 1, unit: 'cm', help: 'For converting pixel errors to degrees.' },
  { key: 'pxPerCm', label: 'Screen pixel density', min: 10, max: 120, step: 0.1, unit: 'px/cm', help: 'CSS px per physical cm on this screen (default 37.8).' },
];

export function SettingsPage() {
  const p = usePilot();
  const s = p.settings;
  const [server, setServer] = useState(getLogServer());
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-3xl font-extrabold">Settings</h1>

      <section className="card space-y-4">
        <h2 className="text-lg font-bold">Interaction</h2>
        <Toggle label="Semantic snapping" help="Off = raw gaze cursor (condition A)." value={s.snapping} onChange={(v) => p.updateSettings({ snapping: v })} />
        <Choice
          label="Selection method"
          value={s.selection}
          options={[
            ['blink', 'Slow blink'],
            ['dwell', 'Dwell'],
          ]}
          onChange={(v) => p.updateSettings({ selection: v as PilotSettings['selection'] })}
        />
        <Choice
          label="Action"
          value={s.clickAction}
          options={[
            ['click', 'Click'],
            ['dblclick', 'Double click'],
          ]}
          onChange={(v) => p.updateSettings({ clickAction: v as PilotSettings['clickAction'] })}
        />
        <Toggle label="Confirm dangerous actions" help="Delete, pay, submit… ask before acting." value={s.confirmDangerous} onChange={(v) => p.updateSettings({ confirmDangerous: v })} />
        <Toggle
          label="Learn from selections"
          help="Each confirmed selection refines the gaze model, correcting drift as you use it."
          value={s.learnFromSelections}
          onChange={(v) => p.updateSettings({ learnFromSelections: v })}
        />
        <Toggle label="Show gaze dot" help="Draw the smoothed gaze estimate (debugging)." value={s.showGazeDot} onChange={(v) => p.updateSettings({ showGazeDot: v })} />
      </section>

      <section className="card space-y-5">
        <h2 className="text-lg font-bold">Parameters</h2>
        {NUMBERS.map((n) => (
          <label key={n.key} className="block">
            <div className="flex justify-between gap-3">
              <span className="font-semibold">{n.label}</span>
              <span className="font-mono text-sm">
                {s[n.key]}
                {n.unit ? ' ' + n.unit : ''}
                {n.key === 'gazeSigmaPx' && ` (${pxToDegrees(s.gazeSigmaPx, s).toFixed(1)}°)`}
              </span>
            </div>
            <input
              type="range"
              className="mt-2 w-full accent-brand-600"
              min={n.min}
              max={n.max}
              step={n.step}
              value={s[n.key]}
              onChange={(e) => p.updateSettings({ [n.key]: Number(e.target.value) } as Partial<PilotSettings>)}
            />
            <span className="text-sm text-slate-500">{n.help}</span>
          </label>
        ))}
        <button className="btn-secondary" onClick={() => p.updateSettings({ ...DEFAULT_SETTINGS, gazeSigmaPx: s.gazeSigmaPx, blinkClosedThreshold: s.blinkClosedThreshold })}>
          Reset parameters (keep calibrated values)
        </button>
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-bold">Mouse simulation</h2>
        <p className="text-sm text-slate-500">Adds webcam-like error to the mouse so snapping and disambiguation can be tried without a camera.</p>
        <Slider label="Noise σ" unit="px" min={0} max={80} value={p.sim.noisePx} onChange={(v) => p.setSim({ noisePx: v })} />
        <Slider label="Drift" unit="px" min={0} max={80} value={p.sim.driftPx} onChange={(v) => p.setSim({ driftPx: v })} />
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-bold">Calibration & data</h2>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" onClick={() => p.calibrate()}>
            Run calibration
          </button>
          <button className="btn-secondary" onClick={() => p.clearCalibration()} disabled={!p.calibration}>
            Forget calibration
          </button>
        </div>
        <label className="block">
          <span className="field-label">Optional log server URL (anonymised study logs only)</span>
          <div className="mt-1 flex gap-2">
            <input className="field" placeholder="http://localhost:8787" value={server} onChange={(e) => setServer(e.target.value)} />
            <button className="btn-secondary" onClick={() => setLogServer(server)}>
              Save
            </button>
          </div>
        </label>
      </section>
    </div>
  );
}

function Toggle({ label, help, value, onChange }: { label: string; help: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="font-semibold">{label}</div>
        <div className="text-sm text-slate-500">{help}</div>
      </div>
      <button
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`relative h-9 w-16 shrink-0 rounded-full transition ${value ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-1 h-7 w-7 rounded-full bg-white shadow transition-all ${value ? 'left-8' : 'left-1'}`} />
      </button>
    </div>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="font-semibold">{label}</span>
      <div className="flex gap-2">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)} className={`rounded-xl px-4 py-2.5 font-semibold ${value === v ? 'bg-brand-600 text-white' : 'bg-slate-100'}`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slider({ label, unit, min, max, value, onChange }: { label: string; unit: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex justify-between">
        <span className="font-semibold">{label}</span>
        <span className="font-mono text-sm">
          {value} {unit}
        </span>
      </div>
      <input type="range" className="mt-2 w-full accent-brand-600" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
