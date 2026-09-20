const paths = {
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  feed: '<path d="M3 15s3-4 7-4 7 4 7 4-3 4-7 4-7-4-7-4Zm14 0 4-3v6Z"/><path d="M7 15h.01"/><circle cx="9" cy="4" r=".7"/><circle cx="14" cy="7" r=".7"/>',
  fullscreen: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  'exit-fullscreen': '<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>',
};

export function setActionIcon(button, icon, label, shortcut) {
  if (!button) return;
  if (button.dataset.icon !== icon) {
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[icon]}</svg>`;
    button.dataset.icon = icon;
    button.classList.add('icon-button');
  }
  button.setAttribute('aria-label', label);
  button.title = shortcut ? `${label} (${shortcut})` : label;
}
