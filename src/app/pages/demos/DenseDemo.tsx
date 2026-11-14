import { useState } from 'react';

const ICONS = ['B', 'I', 'U', 'S', '≡', '⇤', '⇥', '•', '1.', '“', '⌘', '↺', '↻', '🔗', '🖼'];

export function DenseDemo() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [last, setLast] = useState<string | null>(null);
  const hit = (k: string) => {
    setCounts((c) => ({ ...c, [k]: (c[k] ?? 0) + 1 }));
    setLast(k);
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Dense targets</h1>
        <p className="text-slate-500">
          Targets smaller than typical webcam gaze error. When two candidates score similarly they are numbered (1 solid, 2 dashed) and selecting opens
          a chooser.
        </p>
        {last && (
          <p className="mt-3 rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-800" role="status" data-testid="dense-last">
            Pressed: {last} (×{counts[last]})
          </p>
        )}
      </div>

      <section className="card">
        <h2 className="mb-3 font-bold">Editor toolbar · 36 px buttons, 4 px apart</h2>
        <div className="flex flex-wrap gap-1">
          {ICONS.map((i) => (
            <button key={i} aria-label={`Tool ${i}`} onClick={() => hit(`Tool ${i}`)} className="h-9 w-9 rounded-md bg-slate-100 font-bold hover:bg-slate-200">
              {i}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-bold">Number pad · 56 px keys, 8 px apart</h2>
        <div className="grid w-fit grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((k) => (
            <button key={k} onClick={() => hit(`Key ${k}`)} className="h-14 w-14 rounded-xl bg-brand-600 text-xl font-bold text-white hover:bg-brand-700">
              {k}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-bold">Pagination · small adjacent links</h2>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 12 }, (_, i) => (
            <a
              key={i}
              href="#"
              onClick={(e) => (e.preventDefault(), hit(`Page ${i + 1}`))}
              className="rounded px-2.5 py-1 text-sm font-semibold text-brand-700 ring-1 ring-slate-200 hover:bg-brand-50"
            >
              {i + 1}
            </a>
          ))}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-bold">Clickable card with a link inside</h2>
        <div role="button" tabIndex={0} onClick={() => hit('Card')} className="cursor-pointer rounded-xl bg-slate-100 p-6 hover:bg-slate-200">
          <div className="text-lg font-bold">Whole card is clickable</div>
          <p className="text-slate-600">
            …but this{' '}
            <a
              href="#"
              className="font-semibold text-brand-700 underline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                hit('Inner link');
              }}
            >
              inner link
            </a>{' '}
            is its own target. The resolver subtracts child targets from the card’s area.
          </p>
        </div>
      </section>
    </div>
  );
}
