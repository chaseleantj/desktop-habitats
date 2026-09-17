# Freshwater aquarium

A separate interactive 3D aquarium preview, inspired by the supplied aquascape. The scene uses WebGL2, GLSL materials, and a persistent fish simulation. One water model drives the whole tank: a slow current that bends the plants and carries debris, and overhead light that is focused by the rippled surface and absorbed with depth. All rendering code, textures, and dependencies are included. It makes no network requests outside its local server. It can also be installed as a live desktop wallpaper on macOS, which is the one thing here that changes a system setting.

## Open the preview

Unzip the package, open a terminal in the resulting folder, and run either:

```sh
npm start
```

This requires Node.js 20 or newer. No `npm install` is needed. Alternatively, with Python 3:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open **http://localhost:8080** in a current browser with WebGL2 support. The entry point is `index.html`. Serve the folder over HTTP; directly double-clicking the HTML file will not load its JavaScript modules in browsers that restrict local files. Stop the server with Ctrl+C.

To use another port with Node:

```sh
PORT=8081 npm start
```

## Experience

The aquarium has no visible text, buttons, or panels. A quiet fade reveals the scene once it is ready. Move the pointer through the water to interact with nearby fish.

- **Space** pauses and resumes. A reduced-motion system preference starts the scene paused.
- **F** toggles fullscreen.

The composition retains the reference aspect ratio and renders at 1.5 times the canvas dimensions, unless a host page asks for a different number of pixels, as the wallpaper does. There is no sound or camera orbit. Startup errors are reported in the browser console.

## Desktop wallpaper

On macOS the scene can run behind the desktop icons:

```sh
npm run wallpaper
```

This builds a small agent, installs it as `~/Applications/Aquarium Wallpaper.app` with its own copy of the scene, starts it, and sets it to start again at login. The desktop picture is set to a frame of the scene, which is what login and Mission Control show. To remove all of it:

```sh
npm run unwallpaper
```

Files and folders stay on top of the water and behave normally: the window sits at the desktop window level, below the icons, and never takes a mouse event. The fish still see the cursor, because the agent reads its position and passes it to the page rather than capturing it.

A fish in the menu bar is the only visible part of the agent. Its menu says what the wallpaper is doing, and why it is holding still when it is, since most of the reasons are deliberate. **Pause** stops the water on its last frame and is remembered at the next login. **Quit** leaves the still picture behind and stays quit until you log in again.

The frame rate follows what is worth drawing. A scene this size costs the graphics processor ten to twenty watts at full rate, so it stops entirely in Low Power Mode, behind a full screen of work, a locked screen or a sleeping display, slows to 20 frames a second when windows leave only part of it showing, and runs at 60 on mains power or 30 on battery when the desktop is in plain sight. It renders one pixel per screen pixel. `kill -USR1` on the agent writes what it is drawing to `/tmp/aquarium-wallpaper.png`; page errors and rate changes go to `/tmp/aquarium-wallpaper.log`.

## Files

- `wallpaper.html`: the page the wallpaper runs, which fills the screen instead of keeping the reference aspect ratio.
- `wallpaper/Wallpaper.swift`: the macOS agent, its desktop-level window, cursor forwarding and frame-rate policy.
- `wallpaper/install.sh`, `wallpaper/uninstall.sh`: build, install and removal.
- `src/main.js`: camera, lighting, water-depth postprocessing, input, and animation.
- `src/water.js`: the current field, surface-refraction light focusing and depth absorption, and the hook that lights every material through them.
- `src/environment.js`: terrain and the sand channel, the stone and driftwood layout, sediment, moss and algae growth with instanced fronds, bubbles and drifting debris, and the landmarks fish investigate.
- `src/foliage.js`: the strand model that bends leaves in the current, the submerged leaf material with thin-leaf transmission, and the blade and stem generators.
- `src/plants.js`: the planting layout: rivergrass beds in clumps that step down toward the channel, ferns, fallen leaves, and the grass beds fish can enter.
- `src/broadleaf.js`: the foreground broad-leaf species.
- `src/stemplants.js`: the fine-leaved background stem plants.
- `src/fish-anatomy.js`: fish geometry, part ids, and the skin shader.
- `src/fish.js`: spine bending and swimming deformation, and individual behavior.
- `vendor/`: pinned Three.js 0.180.0 runtime and its license.
- `assets/`: bundled surface maps and the supplied visual reference.
- `review/atmosphere-round-1/`: atmosphere captures, timing samples and the focused independent review.
- `review/composition-round-1/`: composition report, generated references, and final captures included in the package. Earlier requests, reviews and intermediate captures remain in the local checkout.

The renderer uses PBR materials, a broad overhead reflection environment, shadow mapping, sampled depth occlusion, and supersampling with multisample antialiasing. Leaves bend and flutter in the shared current according to their compliance and length, transmit light through thin tissue per shadowed light, and let part of the scene through by multisample coverage. Fish swim in short bouts, then coast with quiet tails. A travelling bend runs down each body into a flexible tail fin; the same swimming effort produces the forward thrust. Individuals take long routes through the tank, including behind the grass, with brief rests and visits to the hardscape. They anticipate crossing neighbours and turn smoothly. Particles are lit by the same shadow map as the scene. This is raster rendering; it does not calculate full path-traced light transport.

The fish's burst-and-coast pattern is informed by [experiments on small tetras](https://pmc.ncbi.nlm.nih.gov/articles/PMC7809443/) and [observations of freely swimming tetra pairs](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1005933). Animation timing is tuned for a calm aquarium; this is not a species-calibrated hydrodynamic simulation.

The atmosphere adds fine suspended debris, a faint green-blue tint that strengthens with viewing depth, and broad lighting variations over roughly 43- and 86-second cycles. These use the existing depth fog and shared water-light shader, so plants, fish and particles stay under the same lighting. All motion, including the light drift, stops when paused.

## Checks

```sh
npm run check
npm test
```

The behavior check simulates two minutes of tank motion, checks individual coverage of width, depth and height, quiet-tail coasting, calm tail-beat frequency, bounds and spacing, and exercises local disturbance and recovery. It also verifies all five states, including visits to landmarks, without synchronization. It does not prove anatomical or photographic realism. In the development checkout, `review/swimming-round-1/` holds the independent motion review and `review/` holds earlier scene reviews.

Material and library attribution is in `CREDITS.md`.
