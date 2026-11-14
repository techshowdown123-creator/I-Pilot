/// <reference types="chrome" />
import { CONDITIONS, DEFAULT_SETTINGS, conditionOf, pxToDegrees, type Condition, type PilotSettings } from '@core/settings';
import { getStored, type RuntimeMessage } from './protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function render(): Promise<void> {
  const st = await getStored();
  const s: PilotSettings = { ...DEFAULT_SETTINGS, ...st.settings };
  $<HTMLInputElement>('enabled').checked = st.enabled;
  $('calib').textContent = st.calibration
    ? `Calibrated ${new Date(st.calibration.at).toLocaleString()} · ${Math.round(st.calibration.errorPx)} px (${pxToDegrees(st.calibration.errorPx, s).toFixed(1)}°)`
    : 'Not calibrated yet.';
  const cond = conditionOf(s);
  for (const el of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-cond]'))) el.classList.toggle('on', el.dataset.cond === cond);
  $<HTMLInputElement>('blinkMs').value = String(s.blinkMinMs);
  $('blinkMsOut').textContent = `${s.blinkMinMs} ms`;
  $<HTMLInputElement>('dwellMs').value = String(s.dwellMs);
  $('dwellMsOut').textContent = `${s.dwellMs} ms`;
  $<HTMLSelectElement>('action').value = s.clickAction;
  $<HTMLInputElement>('confirm').checked = s.confirmDangerous;

  const status: RuntimeMessage | null = await chrome.runtime.sendMessage({ type: 'get-camera-status' } satisfies RuntimeMessage).catch(() => null);
  const cam = $('camera');
  if (!st.enabled) cam.textContent = 'Camera off';
  else if (status && status.type === 'camera-status') {
    cam.textContent = status.status === 'error' ? `Camera error: ${status.error}` : status.status === 'running' ? `Camera running${status.fps ? ` · ${status.fps} fps` : ''}` : 'Camera starting…';
    cam.className = status.status === 'error' ? 'err' : '';
  } else cam.textContent = 'Camera starting…';
}

async function patchSettings(p: Partial<PilotSettings>): Promise<void> {
  const st = await getStored();
  await chrome.storage.local.set({ settings: { ...st.settings, ...p } });
  await render();
}

async function sendToTab(msg: RuntimeMessage): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return false;
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
    return true;
  } catch {
    return false;
  }
}

$<HTMLInputElement>('enabled').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ enabled: (e.target as HTMLInputElement).checked });
  setTimeout(render, 400);
});
$('calibrate').addEventListener('click', async () => {
  await chrome.storage.local.set({ enabled: true });
  const ok = await sendToTab({ type: 'calibrate' });
  if (ok) window.close();
  else $('camera').textContent = 'Open a normal web page (not a chrome:// page) and try again.';
});
$('pause').addEventListener('click', async () => {
  await sendToTab({ type: 'toggle-pause' });
  window.close();
});
$('permission').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-permission' } satisfies RuntimeMessage));
for (const el of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-cond]'))) {
  el.title = CONDITIONS[el.dataset.cond as Condition].description;
  el.addEventListener('click', () => patchSettings(CONDITIONS[el.dataset.cond as Condition].patch));
}
$<HTMLInputElement>('blinkMs').addEventListener('change', (e) => patchSettings({ blinkMinMs: Number((e.target as HTMLInputElement).value) }));
$<HTMLInputElement>('dwellMs').addEventListener('change', (e) => patchSettings({ dwellMs: Number((e.target as HTMLInputElement).value) }));
$<HTMLSelectElement>('action').addEventListener('change', (e) => patchSettings({ clickAction: (e.target as HTMLSelectElement).value as PilotSettings['clickAction'] }));
$<HTMLInputElement>('confirm').addEventListener('change', (e) => patchSettings({ confirmDangerous: (e.target as HTMLInputElement).checked }));
$<HTMLInputElement>('blinkMs').addEventListener('input', (e) => ($('blinkMsOut').textContent = `${(e.target as HTMLInputElement).value} ms`));
$<HTMLInputElement>('dwellMs').addEventListener('input', (e) => ($('dwellMsOut').textContent = `${(e.target as HTMLInputElement).value} ms`));

void render();
