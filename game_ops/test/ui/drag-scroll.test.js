import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindVerticalDrag } from '../../public/js/ui/dragScroll.js';

function fixture() {
  const el = Object.assign(new EventTarget(), {
    scrollHeight: 1000, clientHeight: 200, clientWidth: 180, clientLeft: 0, scrollTop: 100,
    getBoundingClientRect: () => ({ left: 10 }),
    setPointerCapture() {},
    classList: { add() {}, remove() {} },
  });
  const target = new EventTarget();
  const dispose = bindVerticalDrag(el, target);
  const emit = (type, values = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 100, detail: 1, ...values,
    });
    (['pointerdown', 'click', 'dragstart'].includes(type) ? el : target).dispatchEvent(e);
    return e;
  };
  return { el, emit, dispose };
}

test('mouse dragging scrolls the list and does not activate the difficulty under the release', () => {
  const { el, emit, dispose } = fixture();
  emit('pointerdown');
  assert.equal(emit('pointermove', { clientY: 97 }).defaultPrevented, false);
  assert.equal(el.scrollTop, 100, 'small movement remains a normal click');
  assert.equal(emit('pointermove', { clientY: 50 }).defaultPrevented, true);
  assert.equal(el.scrollTop, 150);
  emit('pointerup', { clientY: 50 });
  assert.equal(emit('click').defaultPrevented, true);
  emit('pointerdown');
  emit('pointerup');
  assert.equal(emit('click').defaultPrevented, false, 'the next ordinary selection works');
  dispose();
});

test('drag bounds, release outside the list, cancellation and cleanup', () => {
  const { el, emit, dispose } = fixture();
  emit('pointerdown');
  emit('pointermove', { clientY: -2000 });
  assert.equal(el.scrollTop, 800);
  emit('pointermove', { pointerId: 2, clientY: 2000 });
  assert.equal(el.scrollTop, 800, 'a second pointer cannot move the drag');
  emit('pointermove', { clientY: 2000 });
  assert.equal(el.scrollTop, 0);
  emit('pointercancel');
  emit('pointermove', { clientY: 0 });
  assert.equal(el.scrollTop, 0);
  assert.equal(emit('click', { detail: 0 }).defaultPrevented, false, 'keyboard selection is not swallowed');
  dispose();
  emit('pointerdown');
  emit('pointermove', { clientY: -100 });
  assert.equal(el.scrollTop, 0, 'unmounted lists have no remaining listeners');
});

test('native touch scrolling, scrollbar dragging and a list without overflow stay native', () => {
  for (const props of [{ pointerType: 'touch' }, { button: 2 }, { clientX: 192 }]) {
    const { el, emit, dispose } = fixture();
    emit('pointerdown', props);
    emit('pointermove', { clientY: 0 });
    assert.equal(el.scrollTop, 100);
    assert.equal(emit('click').defaultPrevented, false);
    dispose();
  }
  const { el, emit, dispose } = fixture();
  el.scrollHeight = el.clientHeight;
  emit('pointerdown');
  emit('pointermove', { clientY: 0 });
  assert.equal(el.scrollTop, 100);
  dispose();
});
