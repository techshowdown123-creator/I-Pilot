import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePilot } from '../context/PilotContext';
import { CONDITIONS, type Condition } from '@core/settings';
import { nowMs } from '@core/time';
import { ORDERS, saveSession, type ConditionResult, type SessionResult } from '../study/model';
import { FormTask, MenuTask, PointingTask, ReadingTask, SusForm } from '../study/tasks';
import { postLogs } from '../lib/logServer';

type Phase = 'setup' | 'intro' | 'pointing' | 'menu' | 'form' | 'reading' | 'sus' | 'done';
const TASK_ORDER: Phase[] = ['pointing', 'menu', 'form', 'reading', 'sus'];

function newParticipantCode(): string {
  return 'P-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export function Study() {
  const p = usePilot();
  const [phase, setPhase] = useState<Phase>('setup');
  const [participant, setParticipant] = useState(newParticipantCode);
  const [orderIdx, setOrderIdx] = useState(0);
  const [condIdx, setCondIdx] = useState(0);
  const [readingS, setReadingS] = useState(60);
  const [tasks, setTasks] = useState<Record<string, boolean>>({ pointing: true, menu: true, form: true, reading: true, sus: true });
  const session = useRef<SessionResult | null>(null);
  const cur = useRef<ConditionResult | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const order = ORDERS[orderIdx];
  const condition: Condition = order[condIdx];
  const enabled = TASK_ORDER.filter((t) => tasks[t]);

  const begin = () => {
    session.current = { id: `${participant}-${Date.now().toString(36)}`, participant, order, conditions: [], startedAt: Date.now() };
    setCondIdx(0);
    startCondition(0);
  };

  const startCondition = (i: number) => {
    const c = order[i];
    p.setCondition(c);
    cur.current = {
      condition: c,
      source: p.source === 'camera' ? 'camera' : 'mouse',
      calibrationErrorPx: p.source === 'camera' ? (p.calibration?.errorPx ?? null) : null,
      sigmaPx: p.settings.gazeSigmaPx,
      trials: [],
      latenciesMs: [],
      reading: null,
      sus: null,
      startedAt: nowMs(),
      finishedAt: 0,
    };
    setPhase('intro');
  };

  const next = () => {
    const i = enabled.indexOf(phase as never);
    const nxt = enabled[i + 1];
    if (nxt) return setPhase(nxt);
    // condition finished
    cur.current!.finishedAt = nowMs();
    session.current!.conditions.push(cur.current!);
    saveSession(session.current!);
    if (condIdx + 1 < order.length) {
      setCondIdx(condIdx + 1);
      startCondition(condIdx + 1);
    } else {
      setPhase('done');
      setSaved(session.current!.id);
      postLogs(session.current!).catch(() => {});
    }
  };

  const onLatency = (ms: number) => cur.current?.latenciesMs.push(ms);

  if (p.source === 'none') {
    return (
      <div className="card mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">Evaluation study</h1>
        <p className="mt-2 text-slate-600">Start the camera (and calibrate) or the mouse simulation on the Home page first.</p>
        <Link to="/" className="btn-primary mt-4">
          Go to Home
        </Link>
      </div>
    );
  }

  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="card">
          <h1 className="text-2xl font-bold">Evaluation study</h1>
          <p className="mt-2 text-slate-600">
            Each participant completes the same tasks under conditions A, B and C in a counterbalanced order. Logs contain only an anonymous code,
            timings and counts — never video.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">Participant code (anonymous)</span>
              <input className="field mt-1 font-mono" value={participant} onChange={(e) => setParticipant(e.target.value)} />
            </label>
            <label className="block">
              <span className="field-label">Condition order (Latin square)</span>
              <select className="field mt-1" value={orderIdx} onChange={(e) => setOrderIdx(Number(e.target.value))}>
                {ORDERS.map((o, i) => (
                  <option key={i} value={i}>
                    {o.join(' → ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Reading task length</span>
              <select className="field mt-1" value={readingS} onChange={(e) => setReadingS(Number(e.target.value))}>
                {[30, 60, 120].map((s) => (
                  <option key={s} value={s}>
                    {s} seconds
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="field-label">Tasks</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {TASK_ORDER.map((t) => (
                  <label key={t} className="flex items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-slate-300">
                    <input type="checkbox" checked={tasks[t]} onChange={(e) => setTasks({ ...tasks, [t]: e.target.checked })} /> {t}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Before starting: obtain the participant’s informed consent, and run calibration{p.calibration ? ' (done)' : ''} if using the camera. Input
            source: <b>{p.source === 'camera' ? 'camera' : 'mouse simulation'}</b>.
          </div>
          <button className="btn-primary mt-5" onClick={begin} disabled={!enabled.length} data-testid="study-begin">
            Begin with condition {order[0]}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'intro') {
    return (
      <div className="card mx-auto max-w-2xl text-center">
        <div className="text-sm font-bold uppercase tracking-wider text-brand-600">
          Condition {condIdx + 1} of {order.length}
        </div>
        <h1 className="mt-2 text-3xl font-extrabold">{CONDITIONS[condition].label}</h1>
        <p className="mt-2 text-lg text-slate-600">{CONDITIONS[condition].description}</p>
        <p className="mt-4 text-slate-500">Tasks: {enabled.join(', ')}</p>
        <button className="btn-primary mt-6 px-10 py-5 text-xl" onClick={() => setPhase(enabled[0])} data-testid="condition-start">
          Start
        </button>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="card mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-extrabold">Session complete</h1>
        <p className="mt-2 text-slate-600">Saved as {saved}. Thank the participant!</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link className="btn-primary" to="/results">
            View results
          </Link>
          <button
            className="btn-secondary"
            onClick={() => {
              setParticipant(newParticipantCode());
              setOrderIdx((orderIdx + 1) % ORDERS.length);
              setPhase('setup');
            }}
          >
            Next participant
          </button>
        </div>
      </div>
    );
  }

  const key = `${condition}-${phase}`;
  return (
    <div>
      {phase === 'pointing' && <PointingTask key={key} engine={p.engine} onLatency={onLatency} onDone={(t) => (cur.current!.trials.push(...t), next())} />}
      {phase === 'menu' && <MenuTask key={key} engine={p.engine} onLatency={onLatency} onDone={(t) => (cur.current!.trials.push(...t), next())} />}
      {phase === 'form' && <FormTask key={key} engine={p.engine} onLatency={onLatency} onDone={(t) => (cur.current!.trials.push(...t), next())} />}
      {phase === 'reading' && <ReadingTask key={key} engine={p.engine} seconds={readingS} onDone={(r) => ((cur.current!.reading = r), next())} />}
      {phase === 'sus' && <SusForm key={key} onDone={(a) => ((cur.current!.sus = a), next())} />}
      <div className="mx-auto mt-6 max-w-5xl text-right">
        <button className="text-sm font-semibold text-slate-500 underline" onClick={next} data-ipilot-safe>
          Skip task
        </button>
      </div>
    </div>
  );
}
