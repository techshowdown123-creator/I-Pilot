export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;
  font: 500 16px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; }

.hl { position: fixed; border: 3px solid #2563eb; border-radius: 10px; pointer-events: none;
  box-shadow: 0 0 0 4px rgba(37,99,235,.25), 0 0 24px rgba(37,99,235,.35);
  transition: left .12s ease-out, top .12s ease-out, width .12s ease-out, height .12s ease-out, opacity .2s; }
.hl.paused { border-color: #94a3b8; box-shadow: none; opacity: .55; }
.hl.danger { border-color: #dc2626; box-shadow: 0 0 0 4px rgba(220,38,38,.25), 0 0 24px rgba(220,38,38,.35); }
.hl.alt { border: 3px dashed #f59e0b; box-shadow: none; }
.hl.raw { border-width: 2px; border-style: dotted; box-shadow: none; }
.badge { position: absolute; top: -14px; left: -14px; min-width: 28px; height: 28px; padding: 0 6px;
  border-radius: 14px; background: #2563eb; color: #fff; font-weight: 700; font-size: 15px;
  display: flex; align-items: center; justify-content: center; }
.hl.alt .badge { background: #f59e0b; color: #111827; }
.hl.danger .badge { background: #dc2626; }

.gaze { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
  background: rgba(239,68,68,.55); border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.35); pointer-events: none; }
.gaze.cursor { width: 34px; height: 34px; margin: -17px 0 0 -17px; background: rgba(37,99,235,.25); border: 3px solid #2563eb; }

.ring { position: fixed; width: 54px; height: 54px; margin: -27px 0 0 -27px; pointer-events: none; }
.ring circle { fill: none; stroke-width: 6; }
.ring .bg { stroke: rgba(15,23,42,.18); }
.ring .fg { stroke: #2563eb; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
.ring.armed .fg { stroke: #16a34a; }
.ring.blink .fg { stroke: #7c3aed; }
.ring.blink.armed .fg { stroke: #16a34a; }

.status { position: fixed; right: 100px; bottom: 16px; padding: 8px 16px; border-radius: 999px;
  background: #0f172a; color: #f8fafc; font-size: 14px; font-weight: 600; letter-spacing: .01em;
  box-shadow: 0 6px 20px rgba(0,0,0,.25); display: flex; gap: 8px; align-items: center; }
.status .dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; }
.status.paused .dot { background: #f59e0b; }
.status.locked .dot { background: #3b82f6; }
.status.hidden { display: none; }

.toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); padding: 12px 20px; border-radius: 12px;
  background: #16a34a; color: #fff; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,.25); opacity: 0; transition: opacity .2s; }
.toast.show { opacity: 1; }
.toast.warn { background: #b45309; }

.toolbar { position: fixed; right: 10px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 14px;
  pointer-events: auto; }
.tbtn, .tile, .key { pointer-events: auto; cursor: pointer; border: 0; font: inherit; }
.tbtn { width: 76px; height: 76px; border-radius: 18px; background: rgba(15,23,42,.88); color: #f8fafc;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 12px; font-weight: 600;
  box-shadow: 0 4px 14px rgba(0,0,0,.25); }
.tbtn svg { width: 28px; height: 28px; }
.tbtn.on { background: #b45309; }
.toolbar.collapsed .tbtn:not(.keep) { display: none; }

.modal { position: fixed; inset: 0; background: rgba(15,23,42,.55); pointer-events: auto;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; padding: 24px 110px 24px 24px; }
.modal h2 { margin: 0; color: #fff; font-size: 24px; font-weight: 700; text-align: center; }
.modal p { margin: -14px 0 0; color: #e2e8f0; font-size: 15px; text-align: center; }
.tiles { display: flex; flex-wrap: wrap; gap: 48px; justify-content: center; max-width: 1100px; }
.tile { min-width: 220px; max-width: 320px; min-height: 110px; padding: 16px 22px; border-radius: 20px; background: #fff; color: #0f172a;
  font-size: 20px; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  box-shadow: 0 10px 30px rgba(0,0,0,.3); text-align: center; position: relative; }
.tile small { font-size: 13px; font-weight: 500; color: #475569; }
.tile .num { position: absolute; top: -14px; left: -14px; width: 34px; height: 34px; border-radius: 50%; background: #f59e0b; color: #111827;
  display: flex; align-items: center; justify-content: center; font-size: 17px; }
.tile.primary .num { background: #2563eb; color: #fff; }
.tile.danger { background: #dc2626; color: #fff; }
.tile.danger small { color: #fee2e2; }
.tile.muted { background: #e2e8f0; }

.kbd { position: fixed; left: 0; right: 100px; bottom: 0; padding: 14px; background: rgba(15,23,42,.94); pointer-events: auto;
  display: flex; flex-direction: column; gap: 10px; }
.kbd .preview { color: #f8fafc; font-size: 22px; padding: 6px 12px; background: rgba(255,255,255,.08); border-radius: 10px; min-height: 44px;
  white-space: pre; overflow: hidden; text-overflow: ellipsis; }
.kbd .row { display: flex; gap: 10px; justify-content: center; }
.key { flex: 1 1 0; max-width: 120px; height: 72px; border-radius: 14px; background: #f8fafc; color: #0f172a; font-size: 26px; font-weight: 700; }
.key.wide { max-width: 360px; flex-grow: 3; }
.key.action { background: #334155; color: #f8fafc; font-size: 18px; }
.key.done { background: #16a34a; color: #fff; font-size: 18px; }

.calib { position: fixed; inset: 0; background: #0f172a; pointer-events: auto; color: #e2e8f0; }
.calib .msg { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); text-align: center; max-width: 560px; font-size: 18px; line-height: 1.5; }
.calib .msg h2 { font-size: 28px; color: #fff; margin: 0 0 10px; }
.calib .msg small { color: #94a3b8; font-size: 14px; }
.calib .target { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: #ef4444;
  box-shadow: 0 0 0 6px rgba(239,68,68,.25); transition: transform .5s ease-out, left .45s ease-in-out, top .45s ease-in-out; }
.calib .target::after { content: ''; position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: #fff; }
.calib .target.collect { transform: scale(.45); background: #22c55e; box-shadow: 0 0 0 6px rgba(34,197,94,.25); }
.calib .target.head { transform: none; width: 56px; height: 56px; margin: -28px 0 0 -28px; background: #22c55e; box-shadow: 0 0 0 8px rgba(34,197,94,.25); }
.calib .target.head::after { display: none; }
.calib .target .glyph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 700 30px/1 system-ui, sans-serif; color: #fff; }
.calib .hint { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); max-width: 90%; font-size: 14px; line-height: 1.4; color: #cbd5e1; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.calib .live { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #facc15; box-shadow: 0 0 0 3px rgba(250,204,21,.25); pointer-events: none; transition: left .08s linear, top .08s linear; }
.calib .bar { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); width: 320px; height: 8px; border-radius: 4px; background: #1e293b; overflow: hidden; }
.calib .bar > div { height: 100%; background: #22c55e; width: 0; transition: width .2s; }
/* Phones: the toolbar becomes a compact row along the bottom (it would cover
   a third of a narrow screen on the side), and text sizes shrink to fit. */
@media (max-width: 640px) {
  .toolbar { top: auto; bottom: 8px; right: 50%; transform: translateX(50%); flex-direction: row; gap: 8px; }
  .tbtn { width: 64px; height: 56px; border-radius: 14px; font-size: 10px; gap: 2px; }
  .tbtn svg { width: 22px; height: 22px; }
  .status { right: 50%; transform: translateX(50%); bottom: 72px; font-size: 12px; padding: 6px 12px; white-space: nowrap; }
  .toast { bottom: 110px; max-width: 90vw; }
  .modal { padding: 16px 16px 80px; gap: 18px; }
  .tiles { gap: 20px; }
  .tile { min-width: 140px; min-height: 90px; font-size: 17px; }
  .kbd { right: 0; bottom: 72px; padding: 8px; gap: 6px; }
  .kbd .row { gap: 4px; }
  .key { height: 52px; font-size: 18px; border-radius: 10px; }
  .key.action, .key.done { font-size: 13px; }
  .calib .msg { max-width: 90vw; width: 90vw; font-size: 15px; }
  .calib .msg h2 { font-size: 21px; }
  .calib .hint { white-space: normal; font-size: 13px; }
  .calib .bar { width: 70vw; bottom: 24px; }
}
.calib .err { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: #facc15; }
.calib .line { position: absolute; height: 2px; background: rgba(250,204,21,.7); transform-origin: 0 50%; }
.calib .btn { pointer-events: auto; margin-top: 18px; padding: 12px 22px; border-radius: 12px; border: 0; background: #2563eb; color: #fff; font: 600 16px system-ui; cursor: pointer; }
`;
