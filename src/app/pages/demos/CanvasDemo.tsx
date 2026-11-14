import { useEffect, useRef, useState } from 'react';

const COLS = 10;
const ROWS = 6;
const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed'];

/** A canvas exposes no DOM elements, so I-Pilot falls back to a coarse grid of virtual targets. */
export function CanvasDemo() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [cells, setCells] = useState<number[]>(() => new Array(COLS * ROWS).fill(-1));
  const [color, setColor] = useState(0);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const cw = w / COLS;
    const ch = h / ROWS;
    g.fillStyle = '#f8fafc';
    g.fillRect(0, 0, w, h);
    cells.forEach((v, i) => {
      const x = (i % COLS) * cw;
      const y = Math.floor(i / COLS) * ch;
      if (v >= 0) {
        g.fillStyle = PALETTE[v];
        g.fillRect(x + 3, y + 3, cw - 6, ch - 6);
      }
      g.strokeStyle = '#e2e8f0';
      g.strokeRect(x, y, cw, ch);
    });
  }, [cells]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / r.width) * COLS);
    const j = Math.floor(((e.clientY - r.top) / r.height) * ROWS);
    if (i < 0 || j < 0 || i >= COLS || j >= ROWS) return;
    setCells((cs) => cs.map((v, k) => (k === j * COLS + i ? (v === color ? -1 : color) : v)));
    setLast(`${String.fromCharCode(65 + j)}${i + 1}`);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-extrabold">Pixel board (canvas)</h1>
      <p className="text-slate-500">Content drawn on a canvas has no readable elements. I-Pilot divides it into a grid of virtual cells and clicks the cell centre.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {PALETTE.map((p, i) => (
          <button
            key={p}
            aria-label={`Colour ${i + 1}`}
            onClick={() => setColor(i)}
            className={`h-14 w-14 rounded-xl ring-4 ${color === i ? 'ring-slate-900' : 'ring-transparent'}`}
            style={{ background: p }}
          />
        ))}
        <button className="btn-secondary" onClick={() => setCells(new Array(COLS * ROWS).fill(-1))}>
          Clear board
        </button>
        {last && <span className="font-semibold text-slate-700" data-testid="canvas-last">Last cell: {last}</span>}
      </div>
      <canvas ref={ref} onClick={onClick} className="mt-4 aspect-[10/6] w-full rounded-2xl ring-1 ring-slate-300" />
    </div>
  );
}
