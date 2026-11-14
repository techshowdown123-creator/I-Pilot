import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePilot } from '../context/PilotContext';
import { CONDITIONS, conditionOf, type Condition } from '@core/settings';
import { DebugPanel } from './DebugPanel';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/demo/news', label: 'News' },
  { to: '/demo/shop', label: 'Shop' },
  { to: '/demo/form', label: 'Form' },
  { to: '/demo/dense', label: 'Dense targets' },
  { to: '/demo/canvas', label: 'Canvas' },
  { to: '/study', label: 'Study' },
  { to: '/results', label: 'Results' },
  { to: '/settings', label: 'Settings' },
];

export function Layout() {
  const p = usePilot();
  const cond = conditionOf(p.settings);
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 pl-6 pr-28">
          <NavLink to="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-brand-700">
            <img src={import.meta.env.BASE_URL + 'favicon.svg'} alt="" className="h-8 w-8" /> I-Pilot
          </NavLink>
          <nav className="flex flex-wrap gap-1" aria-label="Main">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-[15px] font-semibold ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SourcePill />
            <select
              aria-label="Condition"
              className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm font-semibold"
              value={cond ?? ''}
              onChange={(e) => p.setCondition(e.target.value as Condition)}
            >
              {cond === null && <option value="">Custom</option>}
              {(Object.keys(CONDITIONS) as Condition[]).map((c) => (
                <option key={c} value={c}>
                  {CONDITIONS[c].label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <main className="flex-1 py-8 pl-6 pr-28">
        <Outlet />
      </main>
      <DebugPanel />
    </div>
  );
}

function SourcePill() {
  const p = usePilot();
  const label =
    p.status === 'starting' ? 'Starting…' : p.status === 'calibrating' ? 'Calibrating' : p.source === 'camera' ? 'Camera' : p.source === 'mouse' ? 'Simulation' : 'Off';
  const tone = p.source === 'none' ? 'bg-slate-100 text-slate-600' : p.pilotState === 'PAUSED' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${tone}`} data-testid="source-pill">
      <span className="h-2 w-2 rounded-full bg-current" />
      {label}
      {p.source !== 'none' && <span className="font-mono text-xs opacity-80">{p.pilotState}</span>}
    </span>
  );
}
