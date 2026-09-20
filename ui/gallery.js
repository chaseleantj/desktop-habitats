const gallery = document.querySelector('.gallery');
const portals = [...gallery.querySelectorAll('.portal')];
const status = document.querySelector('#gallery-status');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const names = portals.map(portal => portal.querySelector('h2').firstChild.textContent);
const DRAG_THRESHOLD = 10;
const WHEEL_IDLE_MS = 160;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = value => ((value % portals.length) + portals.length) % portals.length;
const nearest = value => Math.sign(value) * Math.round(Math.abs(value));
const stepWidth = () => portals[0].offsetWidth * 0.65;
let position = 0;
let animation;
let wheel;
let pointer;
let suppressClick = false;

function render() {
  for (const [index, portal] of portals.entries()) {
    const angle = (index - position) * Math.PI;
    const depth = (1 - Math.cos(angle)) / 2;
    // Opposite arcs keep the two opaque images apart as they exchange depth.
    const x = 48 * depth + 50 * Math.sin(angle);
    portal.style.transform = `translate3d(${x}%, ${-4 * depth}%, ${-520 * depth}px) rotateY(${-18 * depth}deg)`;
    portal.style.zIndex = Math.round(1000 * (1 - depth));
    portal.style.setProperty('--brightness', 1 - 0.55 * depth);
    portal.querySelector('.portal-caption').style.visibility = depth < 0.65 ? 'visible' : 'hidden';
  }
}
function announce() {
  const selected = wrap(nearest(position));
  const restoreFocus = portals.some(portal => portal.contains(document.activeElement));
  for (const [index, portal] of portals.entries()) {
    const active = index === selected;
    portal.classList.toggle('is-active', active);
    portal.setAttribute('aria-label', `${active ? 'Open' : 'Preview'} ${names[index]}`);
    if (active) portal.removeAttribute('role');
    else portal.setAttribute('role', 'button');
  }
  status.textContent = names[selected];
  if (restoreFocus) portals[selected].focus({ preventScroll: true });
}
function stopAnimation() {
  cancelAnimationFrame(animation);
  animation = undefined;
}
function stopWheel() {
  clearTimeout(wheel?.idle);
  wheel = undefined;
}
function snap(target) {
  stopAnimation();
  stopWheel();
  const start = position;
  const distance = target - start;
  const duration = parseFloat(getComputedStyle(gallery).getPropertyValue('--motion-duration')) * Math.max(0.5, Math.min(1, Math.abs(distance)));
  if (reducedMotion.matches || Math.abs(distance) < 0.0001) {
    position = target;
    render();
    announce();
    return;
  }
  const started = performance.now();
  function frame(now) {
    const progress = clamp((now - started) / duration, 0, 1);
    position = start + distance * (1 - (1 - progress) ** 3);
    render();
    if (progress < 1) animation = requestAnimationFrame(frame);
    else {
      animation = undefined;
      announce();
    }
  }
  animation = requestAnimationFrame(frame);
}
function select(index) {
  const front = nearest(position);
  snap(wrap(front) === index ? front : front + 1);
}

document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || pointer) return;
  if (event.code === 'Space' && event.target.matches('.portal[role=button]')) {
    event.preventDefault();
    select(portals.indexOf(event.target));
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    snap(nearest(position) + (event.key === 'ArrowRight' ? 1 : -1));
  }
});
gallery.addEventListener('wheel', event => {
  if (event.ctrlKey || pointer) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return;
  event.preventDefault();
  if (!wheel) {
    stopAnimation();
    wheel = { origin: position, idle: undefined };
  }
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? gallery.clientHeight : 1;
  position = clamp(position + delta * unit / stepWidth(), wheel.origin - 1, wheel.origin + 1);
  render();
  clearTimeout(wheel.idle);
  wheel.idle = setTimeout(() => snap(nearest(position)), WHEEL_IDLE_MS);
}, { passive: false });

gallery.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  stopAnimation();
  stopWheel();
  suppressClick = false;
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: position, dragged: false };
});
gallery.addEventListener('pointermove', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  if (!pointer.dragged && (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) <= Math.abs(dy))) return;
  pointer.dragged = true;
  gallery.setPointerCapture(event.pointerId);
  gallery.classList.add('is-dragging');
  position = pointer.origin + clamp(-dx / stepWidth(), -1, 1);
  render();
});
function endDrag(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  const target = nearest(event.type === 'pointercancel' ? pointer.origin : position);
  suppressClick = pointer.dragged;
  pointer = undefined;
  gallery.classList.remove('is-dragging');
  if (gallery.hasPointerCapture(event.pointerId)) gallery.releasePointerCapture(event.pointerId);
  snap(target);
}
gallery.addEventListener('pointerup', endDrag);
gallery.addEventListener('pointercancel', endDrag);
gallery.addEventListener('dragstart', event => event.preventDefault());
gallery.addEventListener('click', event => {
  const portal = event.target.closest('.portal');
  if (!portal) return;
  if ((suppressClick && event.detail !== 0) || animation || wheel) {
    event.preventDefault();
    event.stopPropagation();
  } else if (portals.indexOf(portal) !== wrap(nearest(position))) {
    event.preventDefault();
    select(portals.indexOf(portal));
  }
  suppressClick = false;
}, true);

render();
for (const image of gallery.querySelectorAll('.portal-image img')) {
  const showUnavailable = () => {
    image.hidden = true;
    image.previousElementSibling.hidden = false;
  };
  image.addEventListener('error', showUnavailable);
  if (image.complete && image.naturalWidth === 0) showUnavailable();
}
