import { reportSceneError } from './controls.js';

// WebKit can finish document navigation before the dynamic scene import resolves.
// Keep the host's latest power/rate commands until the scene installs its callbacks.
const pendingHostCommands = new Map();
if (document.documentElement.dataset.motion === 'host') {
  for (const name of ['habitatPower', 'habitatRate']) {
    window[name] = value => pendingHostCommands.set(name, value);
  }
}

const entry = document.querySelector('script[data-entry]').dataset.entry;
import(new URL(entry, document.baseURI).href)
  .then(() => {
    for (const [name, value] of pendingHostCommands) window[name](value);
    pendingHostCommands.clear();
  })
  .catch(reportSceneError);
