import { useState } from 'react';

const SECTIONS: Record<string, string[]> = {
  World: ['Asia', 'Europe', 'Africa', 'Americas', 'Middle East'],
  Sports: ['Cricket', 'Football', 'Tennis', 'Hockey', 'Athletics'],
  Technology: ['AI', 'Gadgets', 'Security', 'Startups', 'Space tech'],
  Science: ['Climate', 'Health', 'Physics', 'Biology'],
  Culture: ['Books', 'Film', 'Music', 'Food'],
};

const HEADLINES = [
  'City council approves new cycle lanes along the riverfront',
  'Monsoon arrives early across the southern coast',
  'Local team clinches the regional championship in a tense final',
  'University lab builds a low-cost water purifier',
  'Metro line extension opens to commuters next month',
  'Farmers adopt solar pumps to cut diesel costs',
  'Museum reopens with a gallery of restored textiles',
  'Students design a tactile map for visually impaired visitors',
];

const TRENDING = ['Budget', 'Elections', 'Heatwave', 'Exams', 'Startups', 'Rail', 'Space', 'Health', 'Film awards', 'Markets'];

export function NewsDemo() {
  const [open, setOpen] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const go = (label: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setOpened(label);
    setOpen(null);
  };
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-3xl font-extrabold">The Daily Glance</h1>
      <p className="text-slate-500">A sample news portal: menus, link lists and small inline links.</p>

      <nav className="relative mt-5 flex flex-wrap gap-2 rounded-2xl bg-slate-900 p-2" aria-label="Sections">
        {Object.keys(SECTIONS).map((s) => (
          <button
            key={s}
            data-study-id={`menu-${s}`}
            aria-expanded={open === s}
            onClick={() => setOpen(open === s ? null : s)}
            className={`rounded-xl px-5 py-3 text-lg font-semibold ${open === s ? 'bg-white text-slate-900' : 'text-white hover:bg-white/10'}`}
          >
            {s} ▾
          </button>
        ))}
        {open && (
          <div className="absolute left-2 right-2 top-full z-10 mt-2 grid grid-cols-2 gap-2 rounded-2xl bg-white p-3 shadow-xl ring-1 ring-slate-200 sm:grid-cols-5">
            {SECTIONS[open].map((sub) => (
              <a key={sub} href="#" data-study-id={`sub-${open}-${sub}`} onClick={go(`${open} › ${sub}`)} className="rounded-xl px-4 py-3 text-lg font-medium hover:bg-brand-50">
                {sub}
              </a>
            ))}
          </div>
        )}
      </nav>

      {opened && (
        <div className="mt-4 rounded-xl bg-emerald-50 p-4 font-semibold text-emerald-800" role="status" data-testid="news-opened">
          Opened: {opened}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="card">
          <h2 className="text-xl font-bold">Top stories</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {HEADLINES.map((h) => (
              <li key={h} className="py-2">
                <a href="#" onClick={go(h)} className="text-lg font-medium text-brand-700 hover:underline">
                  {h}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            Officials said the plan, first proposed <a href="#" onClick={go('in March')} className="text-brand-700 underline">in March</a>, will be reviewed{' '}
            <a href="#" onClick={go('next week')} className="text-brand-700 underline">next week</a> along with the{' '}
            <a href="#" onClick={go('traffic report')} className="text-brand-700 underline">traffic report</a>. Small inline links like these are the hardest
            targets for gaze; snapping and the chooser help.
          </p>
        </section>
        <aside className="card">
          <h2 className="text-xl font-bold">Trending</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {TRENDING.map((t) => (
              <a key={t} href="#" onClick={go('#' + t)} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200">
                #{t}
              </a>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
