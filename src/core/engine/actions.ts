import type { Candidate, ClickAction, Point } from '../types';

function centre(c: Candidate): Point {
  if (c.point) return c.point;
  // Visible part of the rect, so we never click off-screen.
  const w = c.el.ownerDocument.defaultView!;
  const left = Math.max(c.rect.left, 0);
  const right = Math.min(c.rect.right, w.innerWidth);
  const top = Math.max(c.rect.top, 0);
  const bottom = Math.min(c.rect.bottom, w.innerHeight);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/** Rect coordinates are top-document viewport coords; convert into the element's own frame. */
function localPoint(el: Element, p: Point): Point {
  let x = p.x;
  let y = p.y;
  let w: Window | null = el.ownerDocument.defaultView;
  while (w && w.frameElement) {
    const fr = w.frameElement.getBoundingClientRect();
    x -= fr.left + (w.frameElement as HTMLElement).clientLeft;
    y -= fr.top + (w.frameElement as HTMLElement).clientTop;
    w = w.parent;
  }
  return { x, y };
}

function fire(el: Element, type: string, p: Point, detail = 1): void {
  const w = el.ownerDocument.defaultView!;
  const init: MouseEventInit & PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: w,
    clientX: p.x,
    clientY: p.y,
    screenX: p.x + w.screenX,
    screenY: p.y + w.screenY,
    button: 0,
    buttons: type.endsWith('down') ? 1 : 0,
    detail,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
  const Ctor = type.startsWith('pointer') && typeof w.PointerEvent === 'function' ? w.PointerEvent : w.MouseEvent;
  el.dispatchEvent(new Ctor(type, init));
}

/** Stage 8: dispatch a full pointer/mouse event sequence on the target. */
export function activate(c: Candidate, action: ClickAction): void {
  const el = c.el as HTMLElement;
  const p = localPoint(el, centre(c));
  fire(el, 'pointerover', p);
  fire(el, 'mouseover', p);
  const sequence = (detail: number) => {
    fire(el, 'pointerdown', p, detail);
    fire(el, 'mousedown', p, detail);
    if (typeof el.focus === 'function' && c.kind !== 'grid') el.focus({ preventScroll: true });
    fire(el, 'pointerup', p, detail);
    fire(el, 'mouseup', p, detail);
    // A dispatched click also runs native activation behaviour (links, checkboxes, submit).
    fire(el, 'click', p, detail);
  };
  sequence(1);
  if (action === 'dblclick') {
    sequence(2);
    fire(el, 'dblclick', p, 2);
  }
}

export function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && ['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''].includes(el.type);
  }
  return false;
}

/** Set a value so that React/Vue-controlled inputs notice the change. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Insert text at the caret of a text-entry element (used by the gaze keyboard). */
export function typeInto(el: Element, text: string | { backspace: true }): void {
  if ((el as HTMLElement).isContentEditable && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    const he = el as HTMLElement;
    he.textContent = typeof text === 'string' ? (he.textContent ?? '') + text : (he.textContent ?? '').slice(0, -1);
    he.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return;
  }
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const v = input.value ?? '';
  setNativeValue(input, typeof text === 'string' ? v + text : v.slice(0, -1));
}
