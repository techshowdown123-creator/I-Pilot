/// <reference types="chrome" />
import { getStored, type RuntimeMessage } from './protocol';

/**
 * Service worker: owns the offscreen camera document. The camera runs once
 * for the whole browser (not per tab); content scripts connect to it directly.
 */
const OFFSCREEN_URL = 'offscreen.html';
let lastStatus: RuntimeMessage | null = null;

async function hasOffscreen(): Promise<boolean> {
  const ctx = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return ctx.length > 0;
}

let creating: Promise<void> | null = null;
async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Reads the webcam to estimate eye gaze and blinks on the device.',
    })
    .finally(() => (creating = null));
  await creating;
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  lastStatus = null;
}

async function sync(): Promise<void> {
  const { enabled } = await getStored();
  if (enabled) await ensureOffscreen();
  else await closeOffscreen();
  await chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
}

chrome.runtime.onStartup.addListener(() => void sync());
chrome.runtime.onInstalled.addListener(() => void sync());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'enabled' in changes) void sync();
});

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg.type === 'camera-status') {
    lastStatus = msg;
    if (msg.status === 'error' && /NotAllowed|Permission/i.test(msg.error ?? '')) {
      void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
      void chrome.storage.local.set({ enabled: false });
    }
  } else if (msg.type === 'get-camera-status') {
    void hasOffscreen().then((open) => sendResponse(open ? lastStatus : null));
    return true;
  } else if (msg.type === 'open-permission') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  }
  return false;
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-pause') return;
  const tab = await activeTab();
  if (tab?.id !== undefined) chrome.tabs.sendMessage(tab.id, { type: 'toggle-pause' } satisfies RuntimeMessage).catch(() => {});
});
