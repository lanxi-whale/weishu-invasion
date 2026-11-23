// Mouse dragging supplements native wheel, keyboard and touch scrolling without selecting a dragged button.
import { useEffect, useRef } from '../../vendor/hooks.module.js';
import { html } from './components.js';

/** @param {HTMLElement} el @param {Window|EventTarget} [target] */
export function bindVerticalDrag(el, target = window) {
  let press = null;
  let swallow = false;
  const down = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    swallow = false;
    if (el.scrollHeight <= el.clientHeight + 1) return;
    // Leave the native scrollbar to the browser.
    const rect = el.getBoundingClientRect();
    if (e.clientX >= rect.left + el.clientLeft + el.clientWidth) return;
    press = { id: e.pointerId, y: e.clientY, top: el.scrollTop, moved: false };
  };
  const move = (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dy = e.clientY - press.y;
    if (!press.moved) {
      if (Math.abs(dy) < 6) return;
      press.moved = true;
      el.classList.add('is-dragging');
      try { el.setPointerCapture(e.pointerId); } catch { /* Pointer already released. */ }
    }
    el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, press.top - dy));
    e.preventDefault();
  };
  const up = (e) => {
    if (!press || e.pointerId !== press.id) return;
    swallow = press.moved;
    press = null;
    el.classList.remove('is-dragging');
  };
  const click = (e) => {
    if (!swallow || e.detail === 0) return;
    swallow = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const drag = (e) => { e.preventDefault(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('click', click, true);
  el.addEventListener('dragstart', drag);
  target.addEventListener('pointermove', move, { passive: false });
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('click', click, true);
    el.removeEventListener('dragstart', drag);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    el.classList.remove('is-dragging');
  };
}

/** @param {any} props */
export function VerticalDragScroll({ children, ...props }) {
  const ref = useRef(null);
  useEffect(() => ref.current ? bindVerticalDrag(ref.current) : undefined, []);
  return html`<div ...${props} ref=${ref}>${children}</div>`;
}
