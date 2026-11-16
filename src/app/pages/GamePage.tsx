import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePilot } from '../context/PilotContext';
import { load, save } from '../lib/storage';
import { OneEuroFilter } from '@core/filters/oneEuro';
import { DEFAULT_SETTINGS } from '@core/settings';

/**
 * Lantern Drift — an eye-controlled side-scroller. The lantern follows the
 * height you look at; steer it through the gaps between bamboo stalks.
 * I-Pilot runs in gaze-only mode while playing (no snapping or clicks), and
 * the game pauses automatically when I-Pilot does (face lost / looking away).
 */

type Phase = 'menu' | 'countdown' | 'playing' | 'over';
type GamePause = 'face' | 'user' | 'away' | 'nogaze';
type Difficulty = 'easy' | 'normal' | 'hard';

interface Obstacle {
  x: number;
  gapY: number; // centre of the gap, px
  gapH: number;
  w: number;
  passed: boolean;
}

const DIFF: Record<Difficulty, { gap: number; minGap: number; speed: number; maxSpeed: number; spacing: number }> = {
  easy: { gap: 0.46, minGap: 0.32, speed: 140, maxSpeed: 260, spacing: 0.55 },
  normal: { gap: 0.38, minGap: 0.26, speed: 170, maxSpeed: 330, spacing: 0.48 },
  hard: { gap: 0.3, minGap: 0.2, speed: 210, maxSpeed: 400, spacing: 0.42 },
};

const LANTERN_R = 16;
const BEST_KEY = 'ipilot.game.best';

interface GameState {
  phase: Phase;
  W: number;
  H: number;
  y: number;
  vy: number;
  target: number;
  obstacles: Obstacle[];
  score: number;
  speed: number;
  distance: number;
  countdownEnd: number;
  lastGazeAt: number;
  paused: boolean;
  pauseReason: GamePause | null;
  /** When the gaze went far outside the screen (null = it hasn't). */
  awaySince: number | null;
  stars: { x: number; y: number; r: number; tw: number }[];
  sparks: { x: number; y: number; vx: number; vy: number; life: number }[];
  time: number;
}

function newState(W: number, H: number): GameState {
  return {
    phase: 'menu',
    W,
    H,
    y: H / 2,
    vy: 0,
    target: H / 2,
    obstacles: [],
    score: 0,
    speed: 0,
    distance: 0,
    countdownEnd: 0,
    lastGazeAt: 0,
    paused: false,
    pauseReason: null,
    awaySince: null,
    stars: Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.7, r: Math.random() * 1.4 + 0.4, tw: Math.random() * Math.PI * 2 })),
    sparks: [],
    time: 0,
  };
}

export function GamePage() {
  const p = usePilot();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const game = useRef<GameState>(newState(800, 500));
  const [phase, setPhase] = useState<Phase>('menu');
  const [score, setScore] = useState(0);
  const [best, setBest] = useState<number>(() => load<number>(BEST_KEY, 0));
  const [paused, setPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState<GamePause | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => load<Difficulty>('ipilot.game.difficulty', 'easy'));
  const diffRef = useRef(difficulty);
  diffRef.current = difficulty;

  const start = useCallback(() => {
    const g = game.current;
    const d = DIFF[diffRef.current];
    g.obstacles = [];
    g.score = 0;
    g.distance = 0;
    g.speed = d.speed;
    g.y = g.target;
    g.vy = 0;
    g.sparks = [];
    g.phase = 'countdown';
    g.countdownEnd = performance.now() + 3000;
    setScore(0);
    setPhase('countdown');
  }, []);

  // Gaze → target height. Raw gaze with light smoothing: lower lag than the
  // engine's selection filter, which matters for steering.
  useEffect(() => {
    const e = p.engine;
    if (!e) return;
    // The game reads every estimate, including ones just past the screen edge,
    // so it smooths them itself with the same One Euro filter the engine uses
    // (raw webcam estimates jitter by tens of pixels from frame to frame).
    const smooth = new OneEuroFilter(DEFAULT_SETTINGS.filterMinCutoff, DEFAULT_SETTINGS.filterBeta);
    let lastT = 0;
    const off = e.on('sample', (s) => {
      const c = canvasRef.current;
      if (!c || !Number.isFinite(s.y)) return;
      const r = c.getBoundingClientRect();
      const g = game.current;
      const now = performance.now();
      // Webcam estimates often overshoot the top/bottom edge when you look at
      // the edge of the play area. Treat that as "at the edge" (clamp) rather
      // than as looking away; only gaze far outside the screen counts as away.
      const farAway = s.y < r.top - r.height || s.y > r.bottom + r.height || s.x < r.left - r.width || s.x > r.right + r.width;
      if (farAway) {
        g.awaySince ??= now;
        return;
      }
      // Coming back after looking away or a long gap: start smoothing afresh.
      if (g.awaySince !== null || s.t - lastT > 600) smooth.reset();
      g.awaySince = null;
      lastT = s.t;
      const y = Math.min(Math.max(s.y - r.top, LANTERN_R), r.height - LANTERN_R);
      const fy = smooth.filter(y, s.t);
      g.target = g.lastGazeAt ? g.target + (fy - g.target) * 0.35 : fy;
      g.lastGazeAt = now;
    });
    return off;
  }, [p.engine]);

  // Gaze-only mode while the game runs; normal I-Pilot on the menus.
  useEffect(() => {
    const e = p.engine;
    if (!e) return;
    e.setPassive(phase === 'countdown' || phase === 'playing');
    return () => e.setPassive(false);
  }, [p.engine, phase]);

  // Canvas size follows its box.
  useEffect(() => {
    const box = boxRef.current!;
    const c = canvasRef.current!;
    const fit = () => {
      const r = box.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = game.current;
      g.W = r.width;
      g.H = r.height;
      g.y = Math.min(g.y, g.H - LANTERN_R);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Main loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const g = game.current;
      // The game pauses only for real interruptions: face lost, I-Pilot paused
      // from the toolbar, gaze far off-screen for a while, or no gaze at all.
      // (I-Pilot's own "looking away" pause is too eager for a full-height game.)
      const sm = p.engine?.sm;
      const reason: GamePause | null =
        sm?.state === 'PAUSED' && sm.pauseReason === 'face-lost'
          ? 'face'
          : sm?.state === 'PAUSED' && sm.pauseReason === 'user'
            ? 'user'
            : g.awaySince !== null && now - g.awaySince > 1500
              ? 'away'
              : g.lastGazeAt === 0 || now - g.lastGazeAt > 900
                ? 'nogaze'
                : null;
      const shouldPause = (g.phase === 'playing' || g.phase === 'countdown') && reason !== null;
      if (reason !== g.pauseReason) {
        g.pauseReason = reason;
        setPauseReason(reason);
      }
      if (shouldPause !== g.paused) {
        g.paused = shouldPause;
        setPaused(shouldPause);
        if (!shouldPause && g.phase === 'countdown') g.countdownEnd = now + 2000;
      }
      if (!g.paused) step(g, dt, now);
      draw(canvasRef.current!, g, now);
      raf = requestAnimationFrame(tick);
    };
    const step = (g: GameState, dt: number, now: number) => {
      g.time += dt;
      // Lantern eases toward the gazed height with a speed limit (feels floaty, never teleports).
      const maxV = 900;
      const desired = (g.target - g.y) * 7;
      g.vy += (Math.max(-maxV, Math.min(maxV, desired)) - g.vy) * Math.min(1, dt * 10);
      g.y = Math.min(Math.max(g.y + g.vy * dt, LANTERN_R), g.H - LANTERN_R);
      if (Math.random() < dt * 30) g.sparks.push({ x: g.W * 0.25 - 6, y: g.y + LANTERN_R * 0.6, vx: -40 - Math.random() * 60, vy: 20 + Math.random() * 30, life: 1 });
      for (const s of g.sparks) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt * 1.4;
      }
      g.sparks = g.sparks.filter((s) => s.life > 0);

      if (g.phase === 'countdown') {
        if (now >= g.countdownEnd) {
          g.phase = 'playing';
          setPhase('playing');
        }
        return;
      }
      if (g.phase !== 'playing') return;

      const d = DIFF[diffRef.current];
      g.speed = Math.min(d.maxSpeed, d.speed + g.score * 6);
      g.distance += g.speed * dt;
      for (const o of g.obstacles) o.x -= g.speed * dt;
      g.obstacles = g.obstacles.filter((o) => o.x + o.w > -10);
      const lastO = g.obstacles[g.obstacles.length - 1];
      if (!lastO || lastO.x < g.W - g.W * d.spacing) {
        const gapH = g.H * Math.max(d.minGap, d.gap - g.score * 0.006);
        // Next gap is reachable: limited vertical jump from the previous one.
        const prevY = lastO ? lastO.gapY : g.H / 2;
        const maxJump = g.H * 0.35;
        const lo = Math.max(gapH / 2 + 10, prevY - maxJump);
        const hi = Math.min(g.H - gapH / 2 - 10, prevY + maxJump);
        g.obstacles.push({ x: g.W + 10, gapY: lo + Math.random() * Math.max(0, hi - lo), gapH, w: Math.max(46, g.W * 0.05), passed: false });
      }
      const lx = g.W * 0.25;
      for (const o of g.obstacles) {
        if (!o.passed && o.x + o.w < lx - LANTERN_R) {
          o.passed = true;
          g.score++;
          setScore(g.score);
        }
        const inX = lx + LANTERN_R * 0.8 > o.x && lx - LANTERN_R * 0.8 < o.x + o.w;
        const inGap = g.y - LANTERN_R * 0.8 > o.gapY - o.gapH / 2 && g.y + LANTERN_R * 0.8 < o.gapY + o.gapH / 2;
        if (inX && !inGap) {
          g.phase = 'over';
          setPhase('over');
          setBest((b) => {
            const nb = Math.max(b, g.score);
            save(BEST_KEY, nb);
            return nb;
          });
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 60 + Math.random() * 180;
            g.sparks.push({ x: lx, y: g.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 });
          }
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p.engine]);

  // Test/debug handle.
  useEffect(() => {
    (window as unknown as { __game?: unknown }).__game = {
      get state() {
        const g = game.current;
        const c = canvasRef.current?.getBoundingClientRect();
        const next = g.obstacles.find((o) => o.x + o.w > g.W * 0.25 - LANTERN_R);
        return { phase: g.phase, score: g.score, paused: g.paused, lanternY: g.y + (c?.top ?? 0), nextGapY: next ? next.gapY + (c?.top ?? 0) : null, canvasTop: c?.top ?? 0, canvasHeight: g.H };
      },
    };
    return () => {
      delete (window as unknown as { __game?: unknown }).__game;
    };
  }, []);

  // Needs a calibrated camera (or the hidden ?sim mouse mode used for testing).
  const running = p.source === 'mouse' || (p.source === 'camera' && !!p.calibration);
  const canResumeCamera = p.source === 'none' && !!p.calibration;
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Lantern Drift</h1>
          <p className="text-slate-500">Look higher to rise, lower to sink. Guide the lantern through the gaps.</p>
        </div>
        <div className="flex items-center gap-4 font-mono text-lg">
          <span data-testid="game-score">Score {score}</span>
          <span className="text-slate-500">Best {best}</span>
        </div>
      </div>

      <div ref={boxRef} className="relative h-[calc(100vh-230px)] min-h-[360px] overflow-hidden rounded-3xl bg-slate-900 ring-1 ring-slate-800" data-ipilot-ignore={phase === 'playing' || phase === 'countdown' ? '' : undefined}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Lantern Drift game" />

        {phase === 'countdown' && !paused && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <CountdownText end={game.current.countdownEnd} />
          </div>
        )}

        {paused && (phase === 'playing' || phase === 'countdown') && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60" role="status" data-testid="game-paused">
            <div className="text-center text-white">
              <div className="text-3xl font-extrabold">Paused</div>
              <div className="mt-2 text-slate-300" data-testid="pause-reason">
                {pauseReason === 'face'
                  ? 'Your face isn’t visible to the camera. Face the screen, with light in front of you.'
                  : pauseReason === 'away'
                    ? 'Looking away. Look back at the game to continue.'
                    : pauseReason === 'user'
                      ? 'I-Pilot is paused. Select Resume on the right-hand toolbar.'
                      : 'Waiting for gaze from the camera… (keep your eyes open and face visible)'}
              </div>
            </div>
          </div>
        )}

        {(phase === 'menu' || phase === 'over') && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50 p-6">
            <div className="w-full max-w-lg rounded-3xl bg-white/95 p-8 text-center shadow-2xl">
              {phase === 'over' ? (
                <>
                  <div className="text-sm font-bold uppercase tracking-wider text-amber-600">The lantern bumped a stalk</div>
                  <div className="mt-1 text-5xl font-extrabold" data-testid="game-final">{score}</div>
                  <div className="text-slate-500">{score >= best && score > 0 ? 'New best!' : `Best ${best}`}</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-extrabold">Ready?</div>
                  <p className="mt-2 text-slate-600">The lantern follows the height you look at. Keep your head still and move only your eyes.</p>
                </>
              )}
              {!running ? (
                <div className="mt-6">
                  {canResumeCamera && (
                    <>
                      <p className="text-slate-600">You’re calibrated. Turn the camera on to play.</p>
                      <button className="btn-primary mt-3 w-full py-4 text-xl" onClick={() => p.startCamera()} disabled={p.status === 'starting'} data-testid="game-start-camera">
                        {p.status === 'starting' ? 'Starting camera…' : 'Start camera'}
                      </button>
                      <p className="mt-4 text-sm text-slate-500">Moved since last time? Recalibrate instead:</p>
                    </>
                  )}
                  {!canResumeCamera && <p className="text-slate-600">Calibrate first: it takes about 30 seconds.</p>}
                  <Link to="/" className="btn-primary mt-3" data-testid="go-calibrate">
                    Go to calibration
                  </Link>
                </div>
              ) : (
                <>
                  <div className="mt-5 flex justify-center gap-2" role="radiogroup" aria-label="Difficulty">
                    {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
                      <button
                        key={d}
                        role="radio"
                        aria-checked={difficulty === d}
                        onClick={() => {
                          setDifficulty(d);
                          save('ipilot.game.difficulty', d);
                        }}
                        className={`rounded-xl px-5 py-3 font-semibold capitalize ${difficulty === d ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <button className="btn-primary mt-5 w-full py-5 text-2xl" onClick={start} data-testid="game-start" data-ipilot-safe>
                    {phase === 'over' ? 'Play again' : 'Start'}
                  </button>
                  <p className="mt-3 text-sm text-slate-500">Look at the button and blink slowly (or dwell) to press it.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CountdownText({ end }: { end: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
  return (
    <div className="text-center text-white drop-shadow-lg">
      <div className="text-8xl font-extrabold">{left || 'Go!'}</div>
      <div className="mt-2 text-lg text-slate-200">Look where you want the lantern to be</div>
    </div>
  );
}

// ------------------------------------------------------------------ drawing

function draw(c: HTMLCanvasElement, g: GameState, now: number): void {
  const ctx = c.getContext('2d')!;
  const { W, H } = g;
  // Night sky
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0b1026');
  sky.addColorStop(0.6, '#1b1f4a');
  sky.addColorStop(1, '#2d2457');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // Stars (slow parallax)
  const drift = (g.distance * 0.02) % W;
  for (const s of g.stars) {
    const x = (((s.x * W - drift) % W) + W) % W;
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 700 + s.tw);
    ctx.fillStyle = '#e0e7ff';
    ctx.beginPath();
    ctx.arc(x, s.y * H, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Moon
  ctx.fillStyle = '#fef3c7';
  ctx.beginPath();
  ctx.arc(W * 0.82, H * 0.18, Math.min(W, H) * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1f4a';
  ctx.beginPath();
  ctx.arc(W * 0.82 + Math.min(W, H) * 0.025, H * 0.18 - Math.min(W, H) * 0.012, Math.min(W, H) * 0.055, 0, Math.PI * 2);
  ctx.fill();
  // Distant hills (parallax)
  const hillOff = (g.distance * 0.15) % W;
  ctx.fillStyle = '#16153a';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W + 40; x += 40) {
    const wx = x + hillOff;
    ctx.lineTo(x, H * 0.82 - Math.sin(wx / 160) * H * 0.05 - Math.sin(wx / 63) * H * 0.02);
  }
  ctx.lineTo(W, H);
  ctx.fill();

  // Bamboo stalks
  for (const o of g.obstacles) {
    drawBamboo(ctx, o.x, 0, o.w, o.gapY - o.gapH / 2, true);
    drawBamboo(ctx, o.x, o.gapY + o.gapH / 2, o.w, H - (o.gapY + o.gapH / 2), false);
  }

  // Sparks
  for (const s of g.sparks) {
    ctx.globalAlpha = Math.max(0, s.life);
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Lantern
  const lx = W * 0.25;
  const ly = g.y;
  const flick = 1 + Math.sin(now / 90) * 0.06 + Math.sin(now / 37) * 0.03;
  const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, LANTERN_R * 4 * flick);
  glow.addColorStop(0, 'rgba(251,191,36,0.55)');
  glow.addColorStop(1, 'rgba(251,191,36,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(lx, ly, LANTERN_R * 4 * flick, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(lx, ly);
  ctx.rotate(Math.max(-0.35, Math.min(0.35, g.vy / 1600)));
  const body = ctx.createLinearGradient(-LANTERN_R, 0, LANTERN_R, 0);
  body.addColorStop(0, '#c2410c');
  body.addColorStop(0.5, '#fb923c');
  body.addColorStop(1, '#c2410c');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, LANTERN_R * 0.95, LANTERN_R * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(124,45,18,0.6)';
  ctx.lineWidth = 1;
  for (const k of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.ellipse(0, 0, LANTERN_R * 0.95 * Math.abs(Math.cos(k)), LANTERN_R * 1.15, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#451a03';
  ctx.fillRect(-LANTERN_R * 0.55, -LANTERN_R * 1.3, LANTERN_R * 1.1, LANTERN_R * 0.3);
  ctx.fillRect(-LANTERN_R * 0.55, LANTERN_R * 1.0, LANTERN_R * 1.1, LANTERN_R * 0.3);
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.ellipse(0, 0, 4 * flick, 6 * flick, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Target marker (where the gaze is steering): a faint dashed line on the right.
  if (g.phase === 'playing' || g.phase === 'countdown') {
    ctx.strokeStyle = 'rgba(253,230,138,0.35)';
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(lx + LANTERN_R * 2, g.target);
    ctx.lineTo(lx + LANTERN_R * 6, g.target);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawBamboo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fromTop: boolean): void {
  if (h <= 0) return;
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, '#14532d');
  grad.addColorStop(0.35, '#4d7c0f');
  grad.addColorStop(0.7, '#3f6212');
  grad.addColorStop(1, '#14532d');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  // Nodes every ~70 px, anchored at the gap end so they don't swim.
  ctx.fillStyle = '#365314';
  const step = 70;
  if (fromTop) for (let ny = y + h - 18; ny > y; ny -= step) ctx.fillRect(x - 2, ny, w + 4, 5);
  else for (let ny = y + 18; ny < y + h; ny += step) ctx.fillRect(x - 2, ny, w + 4, 5);
  // Cut end at the gap
  ctx.fillStyle = '#a3e635';
  const ey = fromTop ? y + h - 6 : y;
  ctx.fillRect(x - 3, ey, w + 6, 6);
}
