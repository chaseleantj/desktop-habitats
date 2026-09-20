import { qualityName } from './render-policy.js';

export function preferredQuality(params) {
  let saved;
  try { saved = localStorage.getItem('habitat-quality'); } catch {}
  return qualityName(params.get('quality') || saved || (navigator.connection?.saveData ? 'eco' : 'balanced'));
}

export function installControls({ habitat, isPaused, isRunning, pause, feed, quality, setQuality }) {
  document.querySelectorAll('.chrome button, .chrome select, #show-controls').forEach(element => { element.disabled = false; });
  const pauseButton = document.querySelector('#pause');
  const feedButton = document.querySelector('#feed');
  const select = document.querySelector('#quality');
  function refresh() {
    if (pauseButton) {
      pauseButton.textContent = isPaused() ? 'Resume' : 'Pause';
      pauseButton.setAttribute('aria-pressed', String(isPaused()));
    }
    if (feedButton) feedButton.disabled = !isRunning();
    if (select) select.value = quality();
  }
  function clean(value) {
    document.body.classList.toggle('clean', value);
    document.querySelectorAll('.chrome').forEach(element => { element.inert = value; });
    document.querySelector(value ? '#show-controls' : '#hide')?.focus();
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await habitat.requestFullscreen();
    } catch (error) { console.warn(error.message); }
  }
  pauseButton?.addEventListener('click', () => pause(!isPaused()));
  feedButton?.addEventListener('click', feed);
  document.querySelector('#fullscreen')?.addEventListener('click', fullscreen);
  document.querySelector('#hide')?.addEventListener('click', () => clean(true));
  document.querySelector('#show-controls')?.addEventListener('click', () => clean(false));
  select?.addEventListener('change', () => {
    setQuality(select.value);
    try { localStorage.setItem('habitat-quality', select.value); } catch {}
    refresh();
  });
  document.addEventListener('keydown', event => {
    if (event.repeat || event.target.closest('button,select,input,textarea,a,[contenteditable]')) return;
    if (event.code === 'Space') { event.preventDefault(); pause(!isPaused()); }
    else if (event.key.toLowerCase() === 'f') fullscreen();
    else if (event.key.toLowerCase() === 'h') clean(!document.body.classList.contains('clean'));
  });
  document.querySelectorAll('.chrome').forEach(element => { element.inert = document.body.classList.contains('clean'); });
  refresh();
  return refresh;
}

export function reportSceneError(error) {
  console.error(error);
  const loading = document.querySelector('#loading');
  if (loading) loading.hidden = true;
  const box = document.querySelector('#error');
  if (!box) return;
  box.hidden = false;
  box.replaceChildren(document.createTextNode('The aquarium could not start. '));
  const reload = document.createElement('a');
  reload.href = location.href;
  reload.textContent = 'Reload aquarium';
  box.append(reload);
}
