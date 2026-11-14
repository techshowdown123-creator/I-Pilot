import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivationEvent, PilotEngine } from '@core/index';
import { nowMs } from '@core/time';
import { COUNTRIES } from '../pages/demos/FormDemo';
import { SUS_ITEMS, type ReadingRecord, type TrialRecord } from './model';

const FINAL_KINDS = new Set(['click', 'dblclick', 'select-option']);

function studyId(e: ActivationEvent): string | null {
  // A <label> wrapping an input activates that input.
  const el = e.element instanceof HTMLLabelElement && e.element.control ? e.element.control : e.element;
  return el.closest?.('[data-study-id]')?.getAttribute('data-study-id') ?? null;
}

/** Subscribe to final selections and corrections from the engine. */
function useSelections(engine: PilotEngine | null, onSelect: (e: ActivationEvent, id: string | null) => void, onCancel?: () => void, onLatency?: (ms: number) => void) {
  const ref = useRef({ onSelect, onCancel, onLatency });
  ref.current = { onSelect, onCancel, onLatency };
  useEffect(() => {
    if (!engine) return;
    const a = engine.on('activate', (e) => {
      if (e.kind !== 'select-option' && e.kind !== 'overlay') ref.current.onLatency?.(e.latencyMs);
      if (FINAL_KINDS.has(e.kind)) ref.current.onSelect(e, studyId(e));
    });
    const c = engine.on('correction', () => ref.current.onCancel?.());
    return () => {
      a();
      c();
    };
  }, [engine]);
}

interface TaskProps {
  engine: PilotEngine | null;
  onDone: (trials: TrialRecord[]) => void;
  onLatency: (ms: number) => void;
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const TRIAL_TIMEOUT_MS = 25000;

/** Generic sequential-trial runner: each trial has a target id; anything else in scope is a wrong selection. */
function useTrials<T extends { id: string; label: string; size?: TrialRecord['size'] }>(
  task: TrialRecord['task'],
  trials: T[],
  engine: PilotEngine | null,
  onDone: (r: TrialRecord[]) => void,
  onLatency: (ms: number) => void,
  opts: { inScope: (id: string) => boolean; isCorrect?: (e: ActivationEvent, id: string | null, t: T) => boolean; gapMs?: number },
) {
  const [idx, setIdx] = useState(-1);
  const rec = useRef<TrialRecord[]>([]);
  const cur = useRef({ start: 0, wrong: 0, cancels: 0 });

  useEffect(() => {
    const id = setTimeout(() => setIdx(0), 800);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (idx < 0) return;
    if (idx >= trials.length) {
      onDone(rec.current);
      return;
    }
    cur.current = { start: nowMs(), wrong: 0, cancels: 0 };
    const to = setTimeout(() => finish(false), TRIAL_TIMEOUT_MS);
    return () => clearTimeout(to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  const finish = (completed: boolean) => {
    const t = trials[idx];
    if (!t) return;
    rec.current.push({ task, trial: idx + 1, target: t.label, size: t.size, timeMs: nowMs() - cur.current.start, wrong: cur.current.wrong, cancels: cur.current.cancels, completed });
    setIdx(-2);
    setTimeout(() => setIdx(idx + 1), opts.gapMs ?? 600);
  };

  useSelections(
    engine,
    (e, id) => {
      const t = trials[idx];
      if (!t || !id) return;
      const ok = opts.isCorrect ? opts.isCorrect(e, id, t) : id === t.id;
      if (ok) finish(true);
      else if (opts.inScope(id)) cur.current.wrong++;
    },
    () => cur.current.cancels++,
    onLatency,
  );
  return { idx, current: idx >= 0 ? trials[idx] : null, total: trials.length };
}

// ------------------------------------------------------------------ pointing

const SIZES = { small: 32, medium: 56, large: 88 } as const;

export function PointingTask({ engine, onDone, onLatency, count = 12 }: TaskProps & { count?: number }) {
  const layout = useMemo(() => {
    const sizes = shuffle(Array.from({ length: 18 }, (_, i) => (['small', 'medium', 'large'] as const)[i % 3]));
    return sizes.map((size, i) => ({ id: `pt-${i}`, label: `${size} #${i + 1}`, size, col: i % 6, row: Math.floor(i / 6), jx: Math.random() * 0.4 - 0.2, jy: Math.random() * 0.4 - 0.2 }));
  }, []);
  const trials = useMemo(() => {
    const per = Math.ceil(count / 3);
    const pick = (['small', 'medium', 'large'] as const).flatMap((s) => shuffle(layout.filter((l) => l.size === s)).slice(0, per));
    return shuffle(pick).slice(0, count);
  }, [layout, count]);
  const { idx, current, total } = useTrials('pointing', trials, engine, onDone, onLatency, { inScope: (id) => id.startsWith('pt-') });
  return (
    <div>
      <TaskHeader title="Pointing" text="Select the highlighted (amber) button as quickly and accurately as you can." progress={`${Math.max(0, idx) + (current ? 1 : 0)} / ${total}`} />
      <div className="relative mx-auto mt-4 h-[460px] max-w-5xl rounded-2xl bg-white ring-1 ring-slate-200">
        {layout.map((l) => {
          const s = SIZES[l.size];
          const isT = current?.id === l.id;
          return (
            <button
              key={l.id}
              data-study-id={l.id}
              aria-label={`Button ${l.label}`}
              className={`absolute rounded-lg text-xs font-bold ${isT ? 'bg-amber-400 text-slate-900 shadow-lg ring-4 ring-amber-200' : 'bg-slate-200 text-slate-500'}`}
              style={{ width: s, height: s, left: `calc(${((l.col + 0.5 + l.jx) / 6) * 100}% - ${s / 2}px)`, top: `calc(${((l.row + 0.5 + l.jy) / 3) * 100}% - ${s / 2}px)` }}
            >
              {isT ? '★' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ menu

const MENU: Record<string, string[]> = {
  News: ['Local', 'National', 'World', 'Weather'],
  Sports: ['Cricket', 'Football', 'Tennis', 'Chess'],
  Shop: ['Books', 'Music', 'Toys', 'Garden'],
  Help: ['FAQ', 'Contact', 'Privacy', 'About'],
};

export function MenuTask({ engine, onDone, onLatency, count = 4 }: TaskProps & { count?: number }) {
  const trials = useMemo(
    () =>
      shuffle(Object.entries(MENU).flatMap(([s, subs]) => subs.map((sub) => ({ id: `m-${s}-${sub}`, label: `${s} › ${sub}`, section: s }))))
        .slice(0, count),
    [count],
  );
  const [open, setOpen] = useState<string | null>(null);
  const { idx, current, total } = useTrials('menu', trials, engine, onDone, onLatency, {
    inScope: (id) => id.startsWith('m-') || id.startsWith('ms-'),
    isCorrect: (_e, id, t) => id === t.id,
  });
  useEffect(() => setOpen(null), [idx]);
  // Opening the right section is a correct intermediate step, not a wrong selection.
  const onSection = (s: string) => setOpen(open === s ? null : s);
  return (
    <div>
      <TaskHeader title="Menu" text={current ? `Open: ${current.label}` : 'Get ready…'} progress={`${Math.max(0, idx) + (current ? 1 : 0)} / ${total}`} />
      <div className="mx-auto mt-6 max-w-4xl">
        <nav className="relative flex gap-3 rounded-2xl bg-slate-900 p-3">
          {Object.keys(MENU).map((s) => (
            <button
              key={s}
              data-study-id={current?.section === s ? `ok-${s}` : `ms-${s}`}
              onClick={() => onSection(s)}
              className={`rounded-xl px-6 py-3 text-lg font-semibold ${open === s ? 'bg-white text-slate-900' : 'text-white'}`}
            >
              {s} ▾
            </button>
          ))}
        </nav>
        {open && (
          <div className="mt-3 grid grid-cols-4 gap-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
            {MENU[open].map((sub) => (
              <a key={sub} href="#" data-study-id={`m-${open}-${sub}`} onClick={(e) => e.preventDefault()} className="rounded-xl px-4 py-4 text-center text-lg font-medium ring-1 ring-slate-200">
                {sub}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ form

export function FormTask({ engine, onDone, onLatency }: TaskProps) {
  const steps = useMemo(
    () => [
      { id: 'f-contact-Phone', label: 'Choose “Phone” as preferred contact' },
      { id: 'f-agree', label: 'Tick “I agree to be contacted”' },
      { id: 'f-country', label: 'Set Country to Japan', value: 'JP' },
      { id: 'f-submit', label: 'Press Submit' },
    ],
    [],
  );
  const { idx, current, total } = useTrials('form', steps, engine, onDone, onLatency, {
    inScope: (id) => id.startsWith('f-'),
    isCorrect: (e, id, t) => id === t.id && ((t as { value?: string }).value === undefined || e.value === (t as { value?: string }).value),
  });
  return (
    <div>
      <TaskHeader title="Form" text={current ? current.label : 'Get ready…'} progress={`${Math.max(0, idx) + (current ? 1 : 0)} / ${total}`} />
      <form className="card mx-auto mt-6 max-w-2xl space-y-5" onSubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend className="field-label">Preferred contact</legend>
          <div className="mt-2 flex gap-3">
            {['Email', 'Phone', 'Post'].map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-slate-300">
                <input type="radio" name="st-contact" className="h-5 w-5" data-study-id={`f-contact-${c}`} /> {c}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 ring-1 ring-slate-300">
          <input type="checkbox" className="h-5 w-5" data-study-id="f-agree" /> I agree to be contacted
        </label>
        <label className="block">
          <span className="field-label">Country</span>
          <select className="field mt-1" data-study-id="f-country" defaultValue="">
            {COUNTRIES.map(([v, l]) => (
              <option key={v} value={v} disabled={!v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary" data-study-id="f-submit">
          Submit
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ reading

const PASSAGE = [
  'The river town wakes slowly. Before the shops open, a few cyclists cross the old iron bridge and the tea stalls set out their benches. By eight the market street is full: vegetables stacked in careful pyramids, a radio playing the morning news, children in uniforms hurrying to the bus stop.',
  'Most visitors come for the riverfront, but the town’s real character is in its lanes. Here houses lean towards each other, painted in faded blues and yellows, and every second doorway seems to hold a workshop — a tailor, a cycle mechanic, a man who repairs umbrellas and nothing else.',
  'In the afternoon the heat settles and the streets go quiet. The library on the hill stays open until six; its reading room has tall windows, ceiling fans, and a long table where students spread out their notes. Nobody hurries there.',
  'When the evening comes, the bridge fills again. Families walk along the embankment, vendors sell roasted corn, and the lights of the boats move slowly across the dark water. It is an ordinary day, and that is exactly what people love about it.',
];

export function ReadingTask({ engine, onDone, seconds = 60 }: { engine: PilotEngine | null; onDone: (r: ReadingRecord) => void; seconds?: number }) {
  const [left, setLeft] = useState(seconds);
  const counts = useRef({ falseActivations: 0, deliberateBlinks: 0, naturalBlinks: 0 });
  useEffect(() => {
    if (!engine) return;
    const a = engine.on('activate', (e) => {
      if (e.kind !== 'overlay') counts.current.falseActivations++;
    });
    const b = engine.on('blink', (e) => {
      if (e.type === 'deliberate') counts.current.deliberateBlinks++;
      if (e.type === 'natural') counts.current.naturalBlinks++;
    });
    return () => {
      a();
      b();
    };
  }, [engine]);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const l = Math.max(0, seconds - Math.floor((Date.now() - start) / 1000));
      setLeft(l);
      if (l === 0) {
        clearInterval(id);
        onDone({ durationS: seconds, ...counts.current });
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <TaskHeader title="Natural reading" text="Just read normally. Don’t try to select anything — this measures accidental triggers." progress={`${left} s`} />
      <article className="card mx-auto mt-6 max-w-3xl space-y-4 text-lg leading-relaxed text-slate-700">
        {PASSAGE.map((p, i) => (
          <p key={i}>
            {p}{' '}
            {i % 2 === 0 && (
              <a href="#" onClick={(e) => e.preventDefault()} className="text-brand-700 underline">
                Read more
              </a>
            )}
          </p>
        ))}
      </article>
    </div>
  );
}

// ------------------------------------------------------------------ SUS

export function SusForm({ onDone }: { onDone: (answers: number[]) => void }) {
  const [a, setA] = useState<number[]>(new Array(10).fill(0));
  const done = a.every((x) => x > 0);
  return (
    <div>
      <TaskHeader title="Questionnaire" text="System Usability Scale: 1 = strongly disagree, 5 = strongly agree. The participant or the researcher may answer with the mouse." />
      <div className="card mx-auto mt-6 max-w-4xl space-y-4">
        {SUS_ITEMS.map((q, i) => (
          <div key={i} className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-3 last:border-0">
            <span className="min-w-0 flex-1 text-[15px]">
              {i + 1}. {q}
            </span>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  aria-label={`Item ${i + 1}: ${v}`}
                  onClick={() => setA((x) => x.map((y, j) => (j === i ? v : y)))}
                  className={`h-11 w-11 rounded-lg font-bold ${a[i] === v ? 'bg-brand-600 text-white' : 'bg-slate-100'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button className="btn-primary" disabled={!done} onClick={() => onDone(a)} data-ipilot-safe>
          Save answers
        </button>
      </div>
    </div>
  );
}

export function TaskHeader({ title, text, progress }: { title: string; text: string; progress?: string }) {
  return (
    <div className="mx-auto flex max-w-5xl items-end justify-between gap-4">
      <div>
        <div className="text-sm font-bold uppercase tracking-wider text-brand-600">{title}</div>
        <div className="text-2xl font-bold" data-testid="task-prompt">
          {text}
        </div>
      </div>
      {progress && <div className="rounded-full bg-slate-900 px-4 py-1.5 font-mono text-sm text-white">{progress}</div>}
    </div>
  );
}
