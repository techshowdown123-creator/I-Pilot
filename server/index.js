// Optional log collector for the evaluation study (synopsis §7 "Backend").
// Stores anonymised study sessions as JSON lines. It never receives video.
//
//   npm run server            → http://localhost:8787
//   PORT=9000 npm run server
import express from 'express';
import cors from 'cors';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), 'data');
const file = join(dataDir, 'sessions.jsonl');
await mkdir(dataDir, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

/** Keep only the fields the study produces; drop anything unexpected. */
function sanitize(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.conditions)) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    id: String(s.id ?? '').slice(0, 64),
    participant: String(s.participant ?? '').slice(0, 32),
    order: Array.isArray(s.order) ? s.order.map(String).slice(0, 3) : [],
    startedAt: num(s.startedAt),
    receivedAt: Date.now(),
    conditions: s.conditions.slice(0, 3).map((c) => ({
      condition: String(c.condition),
      source: String(c.source),
      calibrationErrorPx: num(c.calibrationErrorPx),
      sigmaPx: num(c.sigmaPx),
      trials: (Array.isArray(c.trials) ? c.trials : []).slice(0, 500).map((t) => ({
        task: String(t.task),
        trial: num(t.trial),
        target: String(t.target).slice(0, 80),
        size: t.size ? String(t.size) : undefined,
        timeMs: num(t.timeMs),
        wrong: num(t.wrong),
        cancels: num(t.cancels),
        completed: !!t.completed,
      })),
      latenciesMs: (Array.isArray(c.latenciesMs) ? c.latenciesMs : []).slice(0, 2000).map(num),
      reading: c.reading
        ? { durationS: num(c.reading.durationS), falseActivations: num(c.reading.falseActivations), deliberateBlinks: num(c.reading.deliberateBlinks), naturalBlinks: num(c.reading.naturalBlinks) }
        : null,
      sus: Array.isArray(c.sus) ? c.sus.slice(0, 10).map(num) : null,
    })),
  };
}

app.post('/api/sessions', async (req, res) => {
  const s = sanitize(req.body);
  if (!s) return res.status(400).json({ error: 'invalid session' });
  await appendFile(file, JSON.stringify(s) + '\n');
  res.status(201).json({ ok: true, id: s.id });
});

app.get('/api/sessions', async (_req, res) => {
  const text = await readFile(file, 'utf8').catch(() => '');
  res.json(text.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`I-Pilot log server on http://localhost:${port}`));
