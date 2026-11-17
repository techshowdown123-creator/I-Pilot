import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePilot } from '../context/PilotContext';
import type { CameraGazeSource } from '@core/input/sources';
import { screenMapper } from '@core/input/screen';
import { nowMs } from '@core/time';

const LABELS = 'ABCDEFGHIJKL'.split('');

/** True on phone-width screens (≤ 640 px), updated when the window is resized or rotated. */
function useNarrow(): boolean {
  const q = '(max-width: 640px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/**
 * Fine-tuning by correction. Look at any button: the blue highlight is
 * I-Pilot's guess. Right → slow-blink or press Enter. Wrong → keep looking at
 * your button, move the guess onto it with the arrow keys and press Enter, or
 * just click it. Each confirmation tells the model where you really looked
 * (at your current head position and lighting), through a correction layer
 * that takes effect immediately.
 */
export function TunePage() {
  const p = usePilot();
  // 4 × 3 buttons on wider screens, 3 × 4 on phones (4 columns don't fit).
  const narrow = useNarrow();
  const COLS = narrow ? 3 : 4;
  const ROWS = narrow ? 4 : 3;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [cam, setCam] = useState<CameraGazeSource | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const pickRef = useRef<number | null>(null);
  pickRef.current = pick;
  const [count, setCount] = useState(0);
  const [misses, setMisses] = useState<number[]>([]);
  const [flash, setFlash] = useState<{ i: number; text: string; ok: boolean } | null>(null);

  // The camera source (it may start after this page opens, so check again periodically).
  useEffect(() => {
    const check = () => {
      const s = p.engine?.getSource();
      // Checked by ability, not instanceof (a hot reload can swap the class).
      const c = s && s.kind === 'camera' && s.calibrated && typeof (s as CameraGazeSource).correct === 'function' ? (s as CameraGazeSource) : null;
      setCam((prev) => (prev === c ? prev : c));
      if (c) setCount(c.getModel()?.correctionCount ?? 0);
    };
    check();
    const id = setInterval(check, 500);
    return () => clearInterval(id);
  }, [p.engine]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(id);
  }, [flash]);

  /** Index of the button I-Pilot currently highlights (its guess), or -1. */
  const guessIndex = useCallback(() => {
    const el = p.engine?.sm.target?.el;
    return el ? refs.current.findIndex((b) => !!b && (b === el || b.contains(el))) : -1;
  }, [p.engine]);

  const confirm = useCallback(
    (i: number) => {
      const b = refs.current[i];
      if (!cam || !b) return;
      const r = b.getBoundingClientRect();
      const target = screenMapper.toScreen({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, window);
      const res = cam.correct(target, nowMs(), { closedThreshold: p.settings.blinkClosedThreshold });
      setPick(null);
      if (!res) {
        setFlash({ i, text: 'Couldn’t see your eyes just then. Try again.', ok: false });
        return;
      }
      setCount(cam.getModel()?.correctionCount ?? 0);
      setMisses((m) => [...m.slice(-19), res.missPx]);
      setFlash({ i, text: `Learned ✓ I was ${Math.round(res.missPx)} px off`, ok: true });
    },
    [cam, p.settings.blinkClosedThreshold],
  );

  // Arrow keys move "your button" (starting from the guess); Enter / Space confirm.
  useEffect(() => {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const onKey = (e: KeyboardEvent) => {
      if (!cam) return;
      if (e.key in dirs) {
        e.preventDefault();
        const [dx, dy] = dirs[e.key];
        const from = pickRef.current ?? guessIndex();
        if (from < 0) return setPick(Math.floor(ROWS / 2) * COLS + 1);
        const c = Math.min(COLS - 1, Math.max(0, (from % COLS) + dx));
        const r = Math.min(ROWS - 1, Math.max(0, Math.floor(from / COLS) + dy));
        setPick(r * COLS + c);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const i = pickRef.current ?? guessIndex();
        if (i >= 0) confirm(i);
      } else if (e.key === 'Escape') setPick(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cam, confirm, guessIndex, COLS, ROWS]);

  const recent = misses.slice(-5);
  const avg = recent.length ? recent.reduce((a, v) => a + v, 0) / recent.length : null;

  if (!cam) {
    return (
      <div className="card mx-auto max-w-xl text-center">
        <h1 className="text-2xl font-extrabold">Correct my guesses</h1>
        <p className="mt-2 text-slate-600">This needs the camera on and a first calibration, so I can make guesses to correct.</p>
        <Link to="/" className="btn-primary mt-4 inline-flex" data-testid="tune-go-calibrate">
          Go to calibration
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="card mb-3 flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="max-w-3xl text-slate-700">
          <h1 className="text-2xl font-extrabold">Correct my guesses</h1>
          <p className="mt-1 text-sm">
            Look at any button. <b className="text-blue-600">Blue</b> = where I think you’re looking. <b>Right?</b> Slow-blink or press <kbd>Enter</kbd>.{' '}
            <b>Wrong?</b> Keep looking at your button and press the <kbd>arrow keys</kbd> to move my guess onto it (<span className="font-semibold text-amber-600">orange</span>), then <kbd>Enter</kbd>, or just click it.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:gap-4">
          <div className="w-full text-sm sm:w-auto sm:text-right" data-testid="tune-stats">
            <div>
              Corrections learned: <b data-testid="tune-count">{count}</b>
            </div>
            <div>{avg !== null ? `How far off I was (last ${recent.length}): ${Math.round(avg)} px` : 'No corrections yet'}</div>
          </div>
          <button
            className="btn-secondary min-h-12"
            data-testid="tune-undo"
            onClick={() => {
              cam.clearCorrections();
              setCount(0);
              setMisses([]);
            }}
          >
            Undo all corrections
          </button>
          <Link to="/" className="btn-primary min-h-12" data-testid="tune-done">
            Done
          </Link>
        </div>
      </div>
      <div
        className={`grid h-[480px] place-items-center rounded-3xl bg-slate-100 ring-1 ring-slate-200 sm:h-[calc(100vh-330px)] sm:min-h-[360px] ${
          narrow ? 'grid-cols-3 grid-rows-4' : 'grid-cols-4 grid-rows-3'
        }`}
      >
        {LABELS.slice(0, COLS * ROWS).map((label, i) => (
          <button
            key={label}
            ref={(el) => (refs.current[i] = el)}
            data-testid={`tune-${label}`}
            onClick={(e) => {
              (e.currentTarget as HTMLElement).blur();
              confirm(i);
            }}
            className={`relative h-20 w-24 rounded-2xl bg-white text-3xl font-extrabold sm:h-28 sm:w-44 sm:text-4xl text-slate-800 shadow-sm ring-1 ring-slate-300 transition ${
              pick === i ? 'outline outline-[6px] outline-offset-4 outline-amber-400' : ''
            }`}
          >
            {label}
            {flash?.i === i && (
              <span className={`absolute -bottom-9 left-1/2 w-max -translate-x-1/2 rounded-lg px-2 py-1 text-sm font-semibold ${flash.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                {flash.text}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
