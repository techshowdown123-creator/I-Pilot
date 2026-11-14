import { describe, expect, it } from 'vitest';
import { PilotStateMachine } from '../../src/core/engine/stateMachine';
import { susScore, summarize, type SessionResult } from '../../src/app/study/model';
import { pxToDegrees } from '../../src/core/settings';
import type { Candidate } from '../../src/core/types';

const target = (key: string): Candidate => ({
  el: document.createElement('button'),
  rect: { left: 0, top: 0, right: 10, bottom: 10 },
  kind: 'button',
  label: key,
  key,
  score: 1,
  dangerous: false,
});

describe('PilotStateMachine', () => {
  it('TRACKING → LOCKED on a landing with a target, back to TRACKING on an empty landing', () => {
    const sm = new PilotStateMachine();
    sm.landing(target('a'), 1);
    expect(sm.state).toBe('LOCKED');
    expect(sm.canActivate).toBe(true);
    sm.landing(null, 2);
    expect(sm.state).toBe('TRACKING');
    expect(sm.canActivate).toBe(false);
  });

  it('pauses on face loss, keeps the last target, and resumes only after the face returns and a new landing occurs', () => {
    const sm = new PilotStateMachine();
    sm.landing(target('a'), 1);
    sm.pause('face-lost', 2);
    expect(sm.state).toBe('PAUSED');
    expect(sm.target?.key).toBe('a');
    expect(sm.canActivate).toBe(false);
    sm.landing(target('b'), 3); // face still lost: ignored
    expect(sm.state).toBe('PAUSED');
    expect(sm.target?.key).toBe('a');
    sm.conditionCleared('face-lost');
    expect(sm.state).toBe('PAUSED'); // not until a new fixation
    sm.landing(target('b'), 4);
    expect(sm.state).toBe('LOCKED');
    expect(sm.target?.key).toBe('b');
  });

  it('a user pause is not overridden by automatic pause reasons and only lifts on userResume', () => {
    const sm = new PilotStateMachine();
    sm.pause('user', 1);
    sm.pause('off-screen', 2);
    expect(sm.pauseReason).toBe('user');
    sm.conditionCleared('off-screen');
    sm.landing(target('x'), 3);
    expect(sm.state).toBe('PAUSED');
    sm.userResume(4);
    expect(sm.state).toBe('TRACKING');
  });

  it('emits transitions', () => {
    const sm = new PilotStateMachine();
    const seen: string[] = [];
    sm.onTransition((t) => seen.push(`${t.from}>${t.to}`));
    sm.landing(target('a'), 1);
    sm.pause('off-screen', 2);
    expect(seen).toEqual(['TRACKING>LOCKED', 'LOCKED>PAUSED']);
  });
});

describe('evaluation metrics', () => {
  it('computes SUS scores', () => {
    expect(susScore(new Array(10).fill(3))).toBe(50);
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
  });

  it('converts px error to visual angle (≈1 cm per degree at 60 cm)', () => {
    expect(pxToDegrees(37.8, { pxPerCm: 37.8, viewingDistanceCm: 60 })).toBeCloseTo(0.955, 2);
  });

  it('summarises sessions per condition', () => {
    const s: SessionResult = {
      id: 's',
      participant: 'P-1',
      order: ['A', 'B', 'C'],
      startedAt: 0,
      conditions: [
        {
          condition: 'C',
          source: 'mouse',
          calibrationErrorPx: null,
          sigmaPx: 60,
          trials: [
            { task: 'pointing', trial: 1, target: 't', timeMs: 1000, wrong: 1, cancels: 0, completed: true },
            { task: 'pointing', trial: 2, target: 't', timeMs: 3000, wrong: 0, cancels: 1, completed: true },
          ],
          latenciesMs: [2, 4],
          reading: { durationS: 60, falseActivations: 1, deliberateBlinks: 2, naturalBlinks: 10 },
          sus: new Array(10).fill(3),
          startedAt: 0,
          finishedAt: 1,
        },
      ],
    };
    const c = summarize([s]).find((x) => x.condition === 'C')!;
    expect(c.meanTimeMs).toBe(2000);
    expect(c.wrongRate).toBeCloseTo(1 / 3);
    expect(c.correctionsPerTrial).toBe(1);
    expect(c.falseTriggersPerMin).toBe(2);
    expect(c.sus).toBe(50);
    expect(c.meanLatencyMs).toBe(3);
  });
});
