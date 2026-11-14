import { useMemo, useState } from 'react';
import { usePilot } from '../context/PilotContext';
import { CONDITIONS, pxToDegrees } from '@core/settings';
import { download } from '../lib/storage';
import { clearSessions, loadSessions, summarize, susScore, toCSV, type ConditionSummary } from '../study/model';
import { postLogs } from '../lib/logServer';

const fmt = (v: number, d = 0, unit = '') => (Number.isFinite(v) ? v.toFixed(d) + unit : '—');

const METRICS: { key: keyof ConditionSummary; label: string; render: (s: ConditionSummary, deg: (px: number) => number) => string; lowerIsBetter: boolean }[] = [
  { key: 'meanTimeMs', label: 'Mean selection time', render: (s) => fmt(s.meanTimeMs / 1000, 2, ' s'), lowerIsBetter: true },
  { key: 'wrongRate', label: 'Wrong-selection rate', render: (s) => fmt(s.wrongRate * 100, 1, ' %'), lowerIsBetter: true },
  { key: 'correctionsPerTrial', label: 'Corrections per trial', render: (s) => fmt(s.correctionsPerTrial, 2), lowerIsBetter: true },
  { key: 'falseTriggersPerMin', label: 'False blink triggers / min (reading)', render: (s) => fmt(s.falseTriggersPerMin, 2), lowerIsBetter: true },
  { key: 'falseActivationsPerMin', label: 'Accidental activations / min (reading)', render: (s) => fmt(s.falseActivationsPerMin, 2), lowerIsBetter: true },
  { key: 'meanLatencyMs', label: 'Trigger → action latency (mean)', render: (s) => fmt(s.meanLatencyMs, 1, ' ms'), lowerIsBetter: true },
  { key: 'p95LatencyMs', label: 'Trigger → action latency (p95)', render: (s) => fmt(s.p95LatencyMs, 1, ' ms'), lowerIsBetter: true },
  { key: 'sus', label: 'SUS score (0–100)', render: (s) => fmt(s.sus, 1), lowerIsBetter: false },
  { key: 'accuracyPx', label: 'Gaze accuracy (calibration check)', render: (s, deg) => (Number.isFinite(s.accuracyPx) ? `${s.accuracyPx.toFixed(0)} px · ${deg(s.accuracyPx).toFixed(1)}°` : '—'), lowerIsBetter: true },
];

export function Results() {
  const p = usePilot();
  const [version, setVersion] = useState(0);
  const sessions = useMemo(() => loadSessions(), [version]);
  const summary = useMemo(() => summarize(sessions), [sessions]);
  const deg = (px: number) => pxToDegrees(px, p.settings);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Results</h1>
          <p className="text-slate-500">
            {sessions.length} session{sessions.length === 1 ? '' : 's'} stored in this browser.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => download('ipilot-sessions.json', JSON.stringify(sessions, null, 2))} disabled={!sessions.length}>
            Export JSON
          </button>
          <button className="btn-secondary" onClick={() => download('ipilot-trials.csv', toCSV(sessions), 'text/csv')} disabled={!sessions.length}>
            Export CSV
          </button>
          <button
            className="btn-secondary"
            disabled={!sessions.length}
            onClick={async () => {
              try {
                let ok = 0;
                for (const s of sessions) if (await postLogs(s)) ok++;
                setMsg(ok ? `Sent ${ok} session(s) to the log server.` : 'No log server configured (Settings).');
              } catch (e) {
                setMsg('Upload failed: ' + (e instanceof Error ? e.message : String(e)));
              }
            }}
          >
            Send to log server
          </button>
          <button
            className="btn-secondary text-red-700"
            disabled={!sessions.length}
            onClick={() => {
              if (window.confirm('Delete all stored study sessions from this browser? This cannot be undone.')) {
                clearSessions();
                setVersion((v) => v + 1);
              }
            }}
            data-ipilot-safe
          >
            Delete all
          </button>
        </div>
      </div>
      {msg && <p className="rounded-xl bg-slate-100 p-3 text-sm">{msg}</p>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-sm text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Measure</th>
              {summary.map((s) => (
                <th key={s.condition} className="px-5 py-3 font-semibold">
                  {CONDITIONS[s.condition].label}
                  <div className="text-xs font-normal">n = {s.n}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {METRICS.map((m) => {
              const vals = summary.map((s) => s[m.key] as number).filter(Number.isFinite);
              const best = vals.length > 1 ? (m.lowerIsBetter ? Math.min(...vals) : Math.max(...vals)) : NaN;
              return (
                <tr key={m.key}>
                  <td className="px-5 py-3 font-medium">{m.label}</td>
                  {summary.map((s) => (
                    <td key={s.condition} className={`px-5 py-3 font-mono ${(s[m.key] as number) === best ? 'font-bold text-emerald-700' : ''}`}>
                      {m.render(s, deg)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <TimeChart summary={summary} />

      <div className="card">
        <h2 className="text-lg font-bold">Sessions</h2>
        {!sessions.length && <p className="mt-2 text-slate-500">No sessions yet. Run one from the Study page.</p>}
        <ul className="mt-3 divide-y divide-slate-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <span className="font-mono">{s.participant}</span>
              <span>{s.order.join(' → ')}</span>
              <span className="text-slate-500">{new Date(s.startedAt).toLocaleString()}</span>
              <span className="text-slate-500">
                SUS {s.conditions.map((c) => `${c.condition}:${c.sus ? susScore(c.sus) : '—'}`).join(' ')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TimeChart({ summary }: { summary: ConditionSummary[] }) {
  const max = Math.max(...summary.map((s) => (Number.isFinite(s.meanTimeMs) ? s.meanTimeMs : 0)), 1);
  if (!summary.some((s) => Number.isFinite(s.meanTimeMs))) return null;
  return (
    <div className="card">
      <h2 className="text-lg font-bold">Mean selection time by condition</h2>
      <div className="mt-4 space-y-3">
        {summary.map((s) => (
          <div key={s.condition} className="flex items-center gap-3">
            <span className="w-48 shrink-0 text-sm font-semibold">{CONDITIONS[s.condition].label}</span>
            <div className="h-7 flex-1 rounded-md bg-slate-100">
              <div className="flex h-full items-center justify-end rounded-md bg-brand-600 pr-2 text-xs font-bold text-white" style={{ width: `${(Number.isFinite(s.meanTimeMs) ? s.meanTimeMs / max : 0) * 100}%` }}>
                {Number.isFinite(s.meanTimeMs) ? (s.meanTimeMs / 1000).toFixed(2) + ' s' : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
