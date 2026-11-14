import type { Candidate, Point, Rect, Resolution, TargetKind } from '../types';
import { TYPE_WEIGHT, distanceToRect, gaussianRectMass, rectContains, sizeWeight } from './scoring';

/** Elements that are interactive by semantics (HTML or ARIA). */
export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="treeitem"]',
  '[onclick]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
  '[data-ipilot-target]',
].join(',');

const DANGER_RE =
  /\b(delete|remove|erase|discard|pay|payment|purchase|buy|checkout|place order|submit|send|transfer|unsubscribe|deactivate|cancel subscription)\b/i;

/** A target supplied by the overlay itself (toolbar, chooser tiles, keyboard keys). */
export interface OverlayTarget {
  el: Element;
  key: string;
  label: string;
  rect: Rect;
}

export interface ResolverOptions {
  sigma: number;
  ambiguityRatio: number;
  hysteresis: number;
  /** Elements to ignore entirely (the overlay host). */
  exclude?: Element | null;
  /** Grid-fallback cell size for canvas content, px. */
  gridCellPx?: number;
}

const ids = new WeakMap<Element, number>();
let nextId = 1;
export function elementKey(el: Element): string {
  let id = ids.get(el);
  if (!id) {
    id = nextId++;
    ids.set(el, id);
  }
  return `e${id}`;
}

export function toRect(r: DOMRect | Rect): Rect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function offsetRect(r: Rect, dx: number, dy: number): Rect {
  return { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy };
}

export function kindOf(el: Element): TargetKind {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'select') return 'select';
  if (tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable) {
    const type = (el as HTMLInputElement).type;
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
    return 'input';
  }
  if (el.getAttribute('role')) return 'role';
  return 'generic';
}

export function accessibleLabel(el: Element): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (t) return t;
  }
  const h = el as HTMLInputElement;
  if (h.tagName === 'INPUT' && (h.type === 'submit' || h.type === 'button') && h.value) return h.value;
  const labels = (h as HTMLInputElement).labels;
  if (labels && labels.length) return labels[0].textContent?.trim() ?? '';
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text.length > 48 ? text.slice(0, 47) + '…' : text;
  const img = el.querySelector('img[alt]');
  if (img) return img.getAttribute('alt') ?? '';
  return el.getAttribute('title') ?? h.placeholder ?? el.tagName.toLowerCase();
}

export function isDangerous(el: Element): boolean {
  if (el.closest('[data-ipilot-safe]')) return false;
  if (el.closest('[data-ipilot-danger]')) return true;
  const label = accessibleLabel(el) + ' ' + (el.getAttribute('title') ?? '');
  return DANGER_RE.test(label);
}

function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return !!el.closest('fieldset[disabled]');
}

function isVisible(el: Element, r: DOMRect, vw: number, vh: number): boolean {
  if (r.width < 2 || r.height < 2) return false;
  if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) return false;
  const anyEl = el as Element & { checkVisibility?: (o?: object) => boolean };
  if (typeof anyEl.checkVisibility === 'function') {
    if (!anyEl.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
  } else {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) return false;
  }
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  return true;
}

/** True if something else (e.g. a modal backdrop) covers the element's visible centre. */
function isOccluded(el: Element, r: DOMRect, doc: Document, exclude: Element | null | undefined, vw: number, vh: number): boolean {
  const cx = Math.min(Math.max((r.left + r.right) / 2, 1), vw - 1);
  const cy = Math.min(Math.max((r.top + r.bottom) / 2, 1), vh - 1);
  const stack = doc.elementsFromPoint(cx, cy);
  for (const hit of stack) {
    if (exclude && (hit === exclude || exclude.contains(hit))) continue;
    if (hit === el || el.contains(hit) || hit.contains(el)) return false;
    if (el instanceof HTMLInputElement && el.labels && Array.from(el.labels).includes(hit as HTMLLabelElement)) return false;
    return true;
  }
  return false;
}

/** Outermost element of a cursor:pointer run (cursor is inherited by children). */
function pointerRoot(start: Element): Element | null {
  let el: Element | null = start;
  let found: Element | null = null;
  while (el && el !== el.ownerDocument.body) {
    if (getComputedStyle(el).cursor === 'pointer') found = el;
    else if (found) break;
    el = el.parentElement;
  }
  return found;
}

/** Collect visible, enabled, interactive elements near point p in document doc. */
export function collectCandidates(doc: Document, p: Point, opts: ResolverOptions, offset: Point = { x: 0, y: 0 }): Candidate[] {
  const win = doc.defaultView!;
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const radius = 3 * opts.sigma;
  const local = { x: p.x - offset.x, y: p.y - offset.y };
  const seen = new Set<Element>();
  const out: Candidate[] = [];

  const consider = (el: Element) => {
    if (seen.has(el)) return;
    seen.add(el);
    if (opts.exclude && (el === opts.exclude || opts.exclude.contains(el))) return;
    if (el === doc.body || el === doc.documentElement) return;
    if (el.closest('[data-ipilot-ignore]')) return;
    if (isDisabled(el)) return;
    const r = el.getBoundingClientRect();
    if (distanceToRect(local, r) > radius) return;
    if (!isVisible(el, r, vw, vh)) return;
    if (isOccluded(el, r, doc, opts.exclude, vw, vh)) return;
    out.push({
      el,
      rect: offsetRect(toRect(r), offset.x, offset.y),
      kind: kindOf(el),
      label: accessibleLabel(el),
      key: elementKey(el),
      score: 0,
      dangerous: isDangerous(el),
    });
  };

  // 1. Semantic interactive elements in the neighbourhood.
  for (const el of Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR))) consider(el);

  // 2. Elements with click handlers we can't see, detected via cursor:pointer
  //    around the landing point (elementsFromPoint at a small ring of probes).
  const probes: Point[] = [local];
  for (let a = 0; a < 8; a++) {
    probes.push({ x: local.x + Math.cos((a * Math.PI) / 4) * opts.sigma, y: local.y + Math.sin((a * Math.PI) / 4) * opts.sigma });
  }
  let topHit: Element | null = null;
  for (const [i, q] of probes.entries()) {
    if (q.x < 0 || q.y < 0 || q.x > vw || q.y > vh) continue;
    for (const hit of doc.elementsFromPoint(q.x, q.y)) {
      if (opts.exclude && (hit === opts.exclude || opts.exclude.contains(hit))) continue;
      if (i === 0 && !topHit) topHit = hit;
      const root = pointerRoot(hit);
      if (root && !root.closest(INTERACTIVE_SELECTOR)) consider(root);
      break; // only the topmost real element at each probe
    }
  }

  // 3. Canvas / iframe content exposes no elements: same-origin frames are
  //    searched recursively, canvases get a coarse grid of virtual targets.
  if (topHit && topHit.tagName === 'IFRAME') {
    const frame = topHit as HTMLIFrameElement;
    let inner: Document | null = null;
    try {
      inner = frame.contentDocument;
    } catch {
      inner = null;
    }
    const fr = frame.getBoundingClientRect();
    if (inner && inner.body) {
      out.push(...collectCandidates(inner, p, opts, { x: offset.x + fr.left + frame.clientLeft, y: offset.y + fr.top + frame.clientTop }));
    } else {
      out.push(...gridCandidates(frame, fr, local, offset, opts));
    }
  } else if (topHit && topHit.tagName === 'CANVAS' && !out.some((c) => c.el === topHit)) {
    out.push(...gridCandidates(topHit, topHit.getBoundingClientRect(), local, offset, opts));
  }
  return out;
}

function gridCandidates(el: Element, r: DOMRect, local: Point, offset: Point, opts: ResolverOptions): Candidate[] {
  const cell = Math.max(opts.gridCellPx ?? 0, opts.sigma * 1.2, 48);
  const cols = Math.max(1, Math.round(r.width / cell));
  const rows = Math.max(1, Math.round(r.height / cell));
  const cw = r.width / cols;
  const ch = r.height / rows;
  const ci = Math.min(cols - 1, Math.max(0, Math.floor((local.x - r.left) / cw)));
  const cj = Math.min(rows - 1, Math.max(0, Math.floor((local.y - r.top) / ch)));
  const out: Candidate[] = [];
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const rect = { left: r.left + i * cw, top: r.top + j * ch, right: r.left + (i + 1) * cw, bottom: r.top + (j + 1) * ch };
      out.push({
        el,
        rect: offsetRect(rect, offset.x, offset.y),
        kind: 'grid',
        label: `Cell ${String.fromCharCode(65 + (j % 26))}${i + 1}`,
        point: { x: (rect.left + rect.right) / 2 + offset.x, y: (rect.top + rect.bottom) / 2 + offset.y },
        key: `${elementKey(el)}:${i},${j}`,
        score: 0,
        dangerous: false,
      });
    }
  }
  return out;
}

/** Score candidates with the Gaussian error model, discounting containers. */
export function scoreCandidates(cands: Candidate[], p: Point, sigma: number, viewportArea: number): Candidate[] {
  const mass = cands.map((c) => gaussianRectMass(p, c.rect, sigma));
  const scored = cands.map((c, i) => {
    // A clickable container's own area excludes clickable descendants, so a
    // link inside a clickable card wins when the gaze is on the link.
    let m = mass[i];
    if (c.kind !== 'grid') {
      let childUnderGaze = false;
      for (let j = 0; j < cands.length; j++) {
        if (j !== i && cands[j].el !== c.el && c.el.contains(cands[j].el)) {
          m -= mass[j];
          if (rectContains(cands[j].rect, p)) childUnderGaze = true;
        }
      }
      // "Select the element containing the point": when the landing is inside a
      // nested control, the surrounding clickable container steps back.
      if (childUnderGaze) m *= 0.25;
    }
    m = Math.max(0, m);
    return { ...c, score: m * (TYPE_WEIGHT[c.kind] ?? 0.8) * sizeWeight(c.rect, viewportArea) };
  });
  return scored.filter((c) => c.score > 0.005).sort((a, b) => b.score - a.score);
}

/**
 * Stage 6: resolve a landing to a target. Returns the best candidate, applying
 * hysteresis against the currently locked target, and flags ambiguity when
 * the runner-up scores close to the winner.
 */
export function resolveTarget(
  doc: Document,
  p: Point,
  opts: ResolverOptions,
  current: Candidate | null,
  overlayTargets: OverlayTarget[] = [],
  overlayOnly = false,
): Resolution {
  const win = doc.defaultView!;
  const vpArea = win.innerWidth * win.innerHeight;
  const cands: Candidate[] = overlayOnly ? [] : collectCandidates(doc, p, opts);
  for (const o of overlayTargets) {
    if (distanceToRect(p, o.rect) > 3 * opts.sigma) continue;
    cands.push({ el: o.el, rect: o.rect, kind: 'overlay', label: o.label, key: o.key, score: 0, dangerous: false });
  }
  const ranked = scoreCandidates(cands, p, opts.sigma, vpArea);
  if (!ranked.length) return { best: null, ranked, ambiguous: false };

  let best = ranked[0];
  // A point inside an overlay control always picks it (they're large and spaced).
  const insideOverlay = ranked.find((c) => c.kind === 'overlay' && rectContains(c.rect, p));
  if (insideOverlay) best = insideOverlay;

  if (current && !insideOverlay) {
    const prev = ranked.find((c) => c.key === current.key);
    // Gaze clearly inside a different element ("the element containing the
    // point") switches immediately; otherwise hysteresis stops flip-flopping.
    const inside = (r: Rect) => p.x >= r.left + 3 && p.x <= r.right - 3 && p.y >= r.top + 3 && p.y <= r.bottom - 3;
    const containing = ranked.find((c) => c.kind !== 'grid' && inside(c.rect));
    if (containing && prev && containing.key !== prev.key && !inside(prev.rect)) best = containing;
    else if (prev && best.key !== prev.key && best.score < prev.score * opts.hysteresis) best = prev;
  }
  const others = ranked.filter((c) => c.key !== best.key);
  const runnerUp = others[0];
  const ambiguous = best.kind !== 'overlay' && !!runnerUp && runnerUp.kind !== 'overlay' && runnerUp.score / best.score > opts.ambiguityRatio;
  return { best, ranked: [best, ...others].slice(0, 4), ambiguous };
}

/** For the raw-cursor baseline: the interactive element directly under a point (no snapping). */
export function elementAtPoint(doc: Document, p: Point, exclude: Element | null | undefined): Candidate | null {
  for (const hit of doc.elementsFromPoint(p.x, p.y)) {
    if (exclude && (hit === exclude || exclude.contains(hit))) continue;
    if (hit.closest('[data-ipilot-ignore]')) return null;
    const el = hit.closest(INTERACTIVE_SELECTOR) ?? pointerRoot(hit);
    if (!el && hit.tagName === 'CANVAS') {
      return { el: hit, rect: { left: p.x - 4, top: p.y - 4, right: p.x + 4, bottom: p.y + 4 }, kind: 'grid', label: 'canvas point', point: p, key: `${elementKey(hit)}:pt`, score: 1, dangerous: false };
    }
    if (!el) return null;
    if (isDisabled(el)) return null;
    return { el, rect: toRect(el.getBoundingClientRect()), kind: kindOf(el), label: accessibleLabel(el), key: elementKey(el), score: 1, dangerous: isDangerous(el) };
  }
  return null;
}
