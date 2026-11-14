import type { Condition } from '@core/settings';
import { load, save } from '../lib/storage';

export type TaskName = 'pointing' | 'menu' | 'form' | 'reading';

export interface TrialRecord {
  task: TaskName;
  trial: number;
  target: string;
  /** Pointing task: target size class. */
  size?: 'small' | 'medium' | 'large';
  timeMs: number;
  wrong: number;
  /** Chooser / confirm cancellations during the trial. */
  cancels: number;
  completed: boolean;
}

export interface ReadingRecord {
  durationS: number;
  falseActivations: number;
  deliberateBlinks: number;
  naturalBlinks: number;
}

export interface ConditionResult {
  condition: Condition;
  source: 'camera' | 'mouse';
  calibrationErrorPx: number | null;
  sigmaPx: number;
  trials: TrialRecord[];
  latenciesMs: number[];
  reading: ReadingRecord | null;
  sus: number[] | null;
  startedAt: number;
  finishedAt: number;
}

export interface SessionResult {
  id: string;
  participant: string;
  order: Condition[];
  conditions: ConditionResult[];
  startedAt: number;
}

const KEY = 'ipilot.study';

export function loadSessions(): SessionResult[] {
  return load<SessionResult[]>(KEY, []);
}

export function saveSession(s: SessionResult): void {
  const all = loadSessions().filter((x) => x.id !== s.id);
  all.push(s);
  save(KEY, all);
}

export function clearSessions(): void {
  save(KEY, null);
}

/** Latin-square orders so each condition appears in each position equally often. */
export const ORDERS: Condition[][] = [
  ['A', 'B', 'C'],
  ['B', 'C', 'A'],
  ['C', 'A', 'B'],
];

/** System Usability Scale items (Brooke, 1996). Odd items positive, even items negative. */
export const SUS_ITEMS = [
  'I think that I would like to use this system frequently.',
  'I found the system unnecessarily complex.',
  'I thought the system was easy to use.',
  'I think that I would need the support of a technical person to be able to use this system.',
  'I found the various functions in this system were well integrated.',
  'I thought there was too much inconsistency in this system.',
  'I would imagine that most people would learn to use this system very quickly.',
  'I found the system very cumbersome to use.',
  'I felt very confident using the system.',
  'I needed to learn a lot of things before I could get going with this system.',
];

export function susScore(answers: number[]): number {
  // answers 1..5
  let s = 0;
  answers.forEach((a, i) => (s += i % 2 === 0 ? a - 1 : 5 - a));
  return s * 2.5;
}

export interface ConditionSummary {
  condition: Condition;
  n: number;
  meanTimeMs: number;
  wrongRate: number;
  correctionsPerTrial: number;
  falseTriggersPerMin: number;
  falseActivationsPerMin: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
  sus: number;
  accuracyPx: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function summarize(sessions: SessionResult[]): ConditionSummary[] {
  const by: Record<Condition, ConditionResult[]> = { A: [], B: [], C: [] };
  for (const s of sessions) for (const c of s.conditions) by[c.condition].push(c);
  return (Object.keys(by) as Condition[]).map((cond) => {
    const rs = by[cond];
    const trials = rs.flatMap((r) => r.trials).filter((t) => t.task !== 'reading');
    const done = trials.filter((t) => t.completed);
    const wrong = trials.reduce((s, t) => s + t.wrong, 0);
    const reads = rs.map((r) => r.reading).filter((x): x is ReadingRecord => !!x);
    const mins = reads.reduce((s, r) => s + r.durationS / 60, 0);
    const lat = rs.flatMap((r) => r.latenciesMs).sort((a, b) => a - b);
    const sus = rs.map((r) => r.sus).filter((x): x is number[] => !!x).map(susScore);
    const acc = rs.map((r) => r.calibrationErrorPx).filter((x): x is number => x !== null && Number.isFinite(x));
    return {
      condition: cond,
      n: rs.length,
      meanTimeMs: mean(done.map((t) => t.timeMs)),
      wrongRate: done.length + wrong ? wrong / (done.length + wrong) : NaN,
      correctionsPerTrial: trials.length ? trials.reduce((s, t) => s + t.wrong + t.cancels, 0) / trials.length : NaN,
      falseTriggersPerMin: mins ? reads.reduce((s, r) => s + r.deliberateBlinks, 0) / mins : NaN,
      falseActivationsPerMin: mins ? reads.reduce((s, r) => s + r.falseActivations, 0) / mins : NaN,
      meanLatencyMs: mean(lat),
      p95LatencyMs: lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : NaN,
      sus: mean(sus),
      accuracyPx: mean(acc),
    };
  });
}

export function toCSV(sessions: SessionResult[]): string {
  const rows = [['session', 'participant', 'condition', 'source', 'task', 'trial', 'target', 'size', 'time_ms', 'wrong', 'cancels', 'completed']];
  for (const s of sessions)
    for (const c of s.conditions)
      for (const t of c.trials)
        rows.push([s.id, s.participant, c.condition, c.source, t.task, String(t.trial), t.target, t.size ?? '', t.timeMs.toFixed(0), String(t.wrong), String(t.cancels), String(t.completed)]);
  return rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n');
}
