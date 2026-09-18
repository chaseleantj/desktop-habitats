// A demand-driven loop: a stopped scene has no rAF chain and no polling timer.
// Below the display refresh rate, sleep until shortly before the next presentation
// instead of waking JavaScript on every refresh just to discard the frame.
export function createFrameLoop(draw, {
  fps = 60,
  paused = false,
  hidden = false,
  clock = () => performance.now(),
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (id) => cancelAnimationFrame(id),
  delay = (fn, ms) => setTimeout(fn, ms),
  cancelDelay = (id) => clearTimeout(id),
} = {}) {
  let raf = null, timer = null, dirty = true, disposed = false;
  let last = null, deadline = clock();
  const validRate = (value) => Number.isFinite(value) && value > 0 ? Math.min(120, value) : 0;
  fps = validRate(fps);
  const running = () => fps > 0 && !paused && !hidden && !disposed;
  const cancel = () => {
    if (raf !== null) cancelFrame(raf);
    if (timer !== null) cancelDelay(timer);
    raf = timer = null;
  };
  function schedule() {
    if (disposed || hidden || (!dirty && !running()) || raf !== null || timer !== null) return;
    const wait = dirty ? 0 : deadline - clock() - 3;
    if (wait > 4) {
      timer = delay(() => { timer = null; raf = requestFrame(frame); }, wait);
    } else raf = requestFrame(frame);
  }
  function frame(now) {
    raf = null;
    if (disposed || hidden || (!dirty && !running())) return;
    if (!dirty && now + 0.5 < deadline) { schedule(); return; }
    const active = running();
    // Discard suspended time; cap a real stall, but not a normal 20/30 fps interval.
    const dt = active && last !== null ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 0;
    last = active ? now : null;
    dirty = false;
    draw(dt, now);
    if (active) {
      const period = 1000 / fps;
      deadline += period;
      // Skip missed deadlines, never catch up with a burst of unnecessary frames.
      if (deadline <= now + 0.5) deadline = now + period;
    }
    schedule();
  }
  function changed() {
    cancel();
    last = null;
    deadline = clock();
    schedule();
  }
  const api = {
    setRate(value) {
      const next = validRate(value);
      if (next !== fps) { fps = next; changed(); }
    },
    setPaused(value) {
      if (paused !== Boolean(value)) { paused = Boolean(value); changed(); }
    },
    setHidden(value) {
      if (hidden !== Boolean(value)) { hidden = Boolean(value); changed(); }
    },
    invalidate() { dirty = true; cancel(); schedule(); },
    dispose() { disposed = true; cancel(); },
    get state() { return { fps, paused, hidden, running: running(), pending: raf !== null || timer !== null }; },
  };
  schedule();
  return api;
}
