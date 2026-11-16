import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePilot } from '../context/PilotContext';

const STEPS = [
  { to: '/', label: '1 · Calibrate', end: true },
  { to: '/game', label: '2 · Play' },
];

export function Layout() {
  const p = usePilot();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  // Hidden switch for development and automated tests: ?sim uses the mouse as
  // the eye (hold Shift to "blink") instead of the camera.
  const sim = new URLSearchParams(window.location.search).has('sim');
  useEffect(() => {
    if (p.engine && p.source === 'none' && sim) void p.startSimulation();
  }, [p.engine, p.source, p.startSimulation, sim]);

  // After a reload, if you're already calibrated and camera access is already
  // allowed, turn the camera back on by itself (once).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || sim || !p.engine || p.source !== 'none' || !p.calibration || p.status !== 'idle') return;
    autoStarted.current = true;
    const perms = navigator.permissions as Permissions | undefined;
    void perms
      ?.query({ name: 'camera' as PermissionName })
      .then((st) => {
        if (st.state === 'granted') void p.startCamera();
      })
      .catch(() => {});
  }, [p.engine, p.source, p.calibration, p.status, p.startCamera, sim]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 pl-6 pr-28">
          <NavLink to="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-brand-700">
            <img src={import.meta.env.BASE_URL + 'favicon.svg'} alt="" className="h-8 w-8" /> I-Pilot
          </NavLink>
          <nav className="flex gap-1" aria-label="Steps">
            {STEPS.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `rounded-lg px-3 py-2 text-[15px] font-semibold ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <SourcePill />
          </div>
        </div>
      </header>
      <main className="flex-1 py-8 pl-6 pr-28">
        <Outlet />
      </main>
    </div>
  );
}

function SourcePill() {
  const p = usePilot();
  const label =
    p.status === 'starting' ? 'Starting…' : p.status === 'calibrating' ? 'Calibrating' : p.source === 'camera' ? 'Camera' : p.source === 'mouse' ? 'Mouse (test)' : 'Camera off';
  const tone = p.source === 'none' ? 'bg-slate-100 text-slate-600' : p.pilotState === 'PAUSED' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${tone}`} data-testid="source-pill">
      <span className="h-2 w-2 rounded-full bg-current" />
      {label}
    </span>
  );
}
