/**
 * Wall-clock milliseconds with sub-ms resolution. Using the time origin makes
 * timestamps comparable between documents (e.g. the extension's offscreen
 * camera document and a page's content script).
 */
export function nowMs(): number {
  return performance.timeOrigin + performance.now();
}
