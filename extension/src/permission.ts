/// <reference types="chrome" />
// Offscreen documents cannot show a permission prompt, so camera access is
// granted once here, on a visible extension page with the same origin.
const msg = document.getElementById('msg')!;
document.getElementById('grant')!.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    msg.textContent = 'Camera allowed. Starting I-Pilot… you can close this tab.';
    await chrome.storage.local.set({ enabled: false });
    await chrome.storage.local.set({ enabled: true });
  } catch (e) {
    msg.textContent = 'Camera access was not granted: ' + (e instanceof Error ? e.message : String(e));
  }
});
