import { load, save } from './storage';

const KEY = 'ipilot.logServer';

/** Optional log collector URL (see server/index.js). Empty = logs stay in this browser. */
export function getLogServer(): string {
  return load<string>(KEY, '');
}

export function setLogServer(url: string): void {
  save(KEY, url.trim() || null);
}

/** Send an anonymised study session to the optional collector. */
export async function postLogs(payload: unknown): Promise<boolean> {
  const url = getLogServer();
  if (!url) return false;
  const res = await fetch(url.replace(/\/$/, '') + '/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}
