import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePilot } from '../context/PilotContext';
import { PositionHint } from './FaceGuide';

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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:gap-x-6 sm:py-3 sm:pl-6 sm:pr-28">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-brand-700 sm:text-xl">
            <img src={import.meta.env.BASE_URL + 'favicon.svg'} alt="" className="h-7 w-7 sm:h-8 sm:w-8" /> I-Pilot
          </NavLink>
          <nav className="flex gap-1" aria-label="Steps">
            {STEPS.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `rounded-lg px-2 py-2 text-sm font-semibold sm:px-3 sm:text-[15px] ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}
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
      {/* Phones: I-Pilot's toolbar sits along the bottom, so leave room there; wider screens keep it on the right. */}
      <main className="flex-1 px-3 pb-36 pt-4 sm:py-8 sm:pl-6 sm:pr-28">
        <Outlet />
      </main>
      <PositionHint />
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
