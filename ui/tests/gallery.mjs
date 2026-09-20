import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../gallery.js', import.meta.url), 'utf8');
function setup() {
  let now = 0;
  const handlers = {};
  const classes = new Set();
  const portals = ['River', 'Reef'].map(name => ({
    offsetWidth: 1000,
    style: { setProperty() {} },
    classList: { toggle() {} },
    querySelector: selector => selector === 'h2' ? { firstChild: { textContent: name } } : { style: {} },
    contains: () => false, setAttribute() {}, removeAttribute() {},
  }));
  const gallery = {
    clientHeight: 700,
    querySelectorAll: selector => selector === '.portal' ? portals : [],
    classList: { add: (...items) => items.forEach(x => classes.add(x)), remove: (...items) => items.forEach(x => classes.delete(x)) },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    setPointerCapture() {}, hasPointerCapture: () => false,
  };
  const context = vm.createContext({
    document: { querySelector: selector => selector === '.gallery' ? gallery : {}, addEventListener() {} },
    matchMedia: () => ({ matches: false }), performance: { now: () => now },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(source, context);
  return { handlers, classes, advance: ms => { now += ms; }, read: code => vm.runInContext(code, context) };
}
const wheelEvent = (deltaX, deltaY) => ({ deltaX, deltaY, deltaMode: 0, preventDefault() {} });
{
  const app = setup();
  app.handlers.wheel(wheelEvent(8, -7));
  app.advance(20);
  app.handlers.wheel(wheelEvent(6, -9));
  assert(Math.abs(app.read('position') - 14 / 650) < 1e-12, 'diagonal noise must not switch axes or reverse motion');
  assert(app.classes.has('is-moving'), 'hover is suppressed throughout the gesture');
}
{
  const app = setup();
  app.read('pointer = gesture(0)');
  app.advance(100);
  app.read('position = 0.22; sample(pointer)');
  app.advance(150);
  assert.equal(app.read('releaseTarget(pointer)'), 1, 'deliberate short drag advances without crossing halfway');
  app.read('position = 0.03; pointer = gesture(0); sample(pointer)');
  assert.equal(app.read('releaseTarget(pointer)'), 0, 'tiny movements return to the current card');
}
{
  const app = setup();
  app.read('pointer = gesture(0)');
  app.advance(40);
  app.read('position = -0.09; sample(pointer)');
  assert.equal(app.read('releaseTarget(pointer)'), -1, 'quick flick advances in its direction');
  app.advance(200);
  assert.equal(app.read('releaseTarget(pointer)'), 0, 'holding after a flick discards stale velocity');
}
{
  const app = setup();
  app.handlers.pointerdown({ isPrimary: true, button: 0, pointerId: 1, clientX: 300, clientY: 100 });
  app.advance(30);
  app.handlers.pointermove({ pointerId: 1, clientX: 100, clientY: 100 });
  app.handlers.pointercancel({ pointerId: 1, type: 'pointercancel' });
  assert.equal(app.read('pointer'), undefined);
  assert.equal(app.classes.has('is-dragging'), false);
}
console.log('PASS: gallery axis lock, distance intent, flick velocity, stale velocity and cancellation');
