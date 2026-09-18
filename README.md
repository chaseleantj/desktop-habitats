# Freshwater aquarium

A planted freshwater aquascape that runs in a browser. A sand channel winds between stones and a piece of driftwood, moss and algae grow over the hardscape, rivergrass and ferns fill the sides, and a shoal of 24 bloodfin tetras (_Aphyocharax anisitsi_) swims through it. The scene is drawn in WebGL2 with custom GLSL through Three.js, and the fish keep swimming for as long as the page is open.

One water model drives the whole tank. A slow current bends the plants, carries debris and pushes the fish, and the light from above is focused by the rippled surface and absorbed with depth, so every material in the scene is lit through the same water. The current sweeps: it takes a little over three minutes to reverse, passing through slack on the way, so nothing settles permanently into one corner and the planting leans one way and then the other over a long sit.

Everything the scene needs is in this repository. There is nothing to install, and the page makes no request outside its own local server. On macOS it can also be installed as a live desktop wallpaper, which is the one thing here that changes a system setting.

## Run the preview

You need Node.js 20 or newer, verified on v24.19.0. The project has no dependencies, so there is no `npm install` step.

```sh
npm start
```

Then open **http://127.0.0.1:8080**. To use another port, run `PORT=8081 npm start`. Any static server will do just as well:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

The page has to be served over HTTP. Opening `index.html` straight from the filesystem fails, because browsers will not load ES modules from a `file://` page. Stop the server with Ctrl+C.

The aquarium has no text, buttons or panels. It fades in once it is ready.

- **Click the water** to drop a pinch of ten food pellets.
- **Space** pauses and resumes. A reduced-motion system preference starts the preview paused.
- **F** toggles fullscreen.
- Move the pointer through the water and the fish near it will react.

Feeding is worth watching for a while rather than a few seconds. The pellets float before they wet and sink, so the shoal gathers over five to fifteen seconds rather than arriving all at once; the fish come in fast, brake, and then stalk, because rushing a pellet blows it away; some strikes miss, some fish get nothing, and a few pellets are never eaten at all. The shoal comes apart into a scramble and re-forms over the next half minute, and the odd fish keeps picking at the sand long after. Pellets break up twenty to sixty seconds after they land, so the tank always clears itself.

Startup errors are reported in the browser console.

## How the scene works

The renderer uses physically based materials, a broad overhead reflection environment for the silver scales, shadow mapping, sampled depth occlusion, and multisample antialiasing on top of rendering at 1.5 times the size of the canvas. This is raster rendering; it does not calculate full path-traced light transport.

Leaves bend and flutter in the shared current according to their length and stiffness, transmit light through thin tissue per shadowed light, and let part of the scene through by multisample coverage. Fish swim in short bouts and then coast with quiet tails. A travelling bend runs down each body into a flexible tail fin, and the same swimming effort produces the forward thrust. Individuals take long routes through the tank, including behind the grass, with brief rests and visits to the hardscape. They anticipate crossing neighbours and turn smoothly. Their burst-and-coast pattern is informed by [experiments on small tetras](https://pmc.ncbi.nlm.nih.gov/articles/PMC7809443/) and [observations of freely swimming tetra pairs](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1005933). The timing is tuned for a calm aquarium, not calibrated against a species' hydrodynamics.

The water itself carries fine suspended debris, a faint green-blue tint that strengthens with viewing depth, and slow lighting changes on cycles of roughly 43 and 86 seconds. These run through the same depth fog and shared water-light shader as everything else, so plants, fish and particles stay under one light. All of it stops when the scene is paused.

## Desktop wallpaper on macOS

The scene can run behind your desktop icons. This needs macOS 13 or newer and the Xcode command line tools for `swiftc`, which you can install with `xcode-select --install`.

```sh
npm run wallpaper
```

This builds a small agent, installs it as `~/Applications/Aquarium Wallpaper.app` with its own copy of the scene, starts it, and sets it to start again at every login. It also sets the desktop picture to a frame of the scene, which is what login and Mission Control show. Installing takes about twenty seconds, most of it waiting for the first frame to draw.

macOS asks for permission once during the install, when the still picture is set: **"Terminal wants to control System Events"**. Declining is handled: your desktop picture stays as it is, and the live layer covers it anyway. The app is signed ad hoc as part of the build, so there is no Gatekeeper prompt.

Files and folders stay on top of the water and behave normally. The window sits at the desktop window level, below the icons, and never takes a mouse event. The fish still see the cursor, because the agent reads its position and hands it to the page rather than capturing it.

A fish in the menu bar is the agent's only visible part. Its menu says what the wallpaper is doing, and why it is holding still when it is, since most of the reasons are deliberate. **Feed** drops a pinch of pellets on every screen — the desktop never takes a click, so this is how you feed the fish here. **Pause** stops the water on its last frame and is remembered at the next login. **Quit** leaves the still picture behind and stays quit until you log in again. Items that would not do anything grey themselves out rather than promising something they cannot deliver.

If **Reduce motion** is on in System Settings, the wallpaper starts still and the menu says so. Pause stays available, so you can start it anyway and that choice is what gets remembered from then on.

The frame rate follows what is worth drawing. A scene this size costs the graphics processor ten to twenty watts at full rate, so it stops entirely in Low Power Mode, behind a full screen of work, on a locked screen or a sleeping display. It slows to 20 frames a second when windows leave only part of the desktop showing, and runs at 60 on mains power or 30 on battery with the desktop in plain sight. It renders at the display's own scale factor, but never below 1.5 pixels per screen pixel and never above 2, so a non-Retina display still gets a supersampled image.

To check on it, `kill -USR1` on the agent writes the frame it is drawing to `/tmp/aquarium-wallpaper.png`. Page errors and frame-rate changes go to `/tmp/aquarium-wallpaper.log`.

```sh
npm run unwallpaper
```

This stops the agent, removes the login item and deletes the app. Two things are left behind on purpose: the still frame at `~/Pictures/Aquarium Wallpaper.png`, and the desktop picture setting, which keeps pointing at that frame if the installer was allowed to change it. So the desktop falls back to a photograph of the tank rather than going blank. To get your old wallpaper back, choose it again in System Settings.

If you fork this, the bundle id `com.chaselean.aquarium-wallpaper` appears in `wallpaper/install.sh`, `wallpaper/uninstall.sh` and `wallpaper/Info.plist`. Change all three together, or the install and uninstall scripts will stop agreeing with the app they manage.

## Files

```
index.html         the preview page
wallpaper.html     the same scene, framed to fill a screen instead of keeping the
                   preview's fixed widescreen shape
serve.mjs          the local static server behind npm start
style.css          the page layout, which is all the CSS there is
src/               the scene (below)
tests/             the behaviour simulation and a resolve hook that points the bare
                   `three` import at the vendored copy, so it runs with no bundler
                   and no node_modules
vendor/            Three.js 0.180.0 and its license
assets/            six texture files: a diffuse and a normal map for rock, wood and sand
wallpaper/         the macOS agent: Wallpaper.swift, its Info.plist, install.sh and
                   uninstall.sh
```

Inside `src/`:

- `main.js`: camera, lighting, water-depth postprocessing, input, resize and the animation loop.
- `water.js`: the current field, surface-refraction light focusing and depth absorption, and the shader hook that lights every material through them.
- `environment.js`: terrain and the sand channel, the stone and driftwood layout, sediment, moss and algae with instanced fronds, bubbles and drifting debris, and the landmarks the fish investigate.
- `plants.js`: the rivergrass beds, fern tufts, fallen leaves, and the thickets fish swim into.
- `foliage.js`: the strand model that bends leaves in the current, the submerged-leaf material with thin-leaf transmission, and the blade and stem generators every species is built from.
- `broadleaf.js`: the foreground broad-leaf species and their placement on the rocks and wood.
- `stemplants.js`: the fine-leaved background stem plants.
- `fish-anatomy.js`: fish geometry, part ids, fin ray fans, and the skin and membrane shaders.
- `fish.js`: spine bending, swimming deformation, and individual behaviour, including how the shoal finds and competes for food.
- `food.js`: the pellets — how they float, sink, settle, get shoved about and break up.
- `math.js`: the seeded random generator, value noise, the riverbed height field, and the geometry batch accumulator.

## Checks

```sh
npm run check
npm test
```

`npm run check` syntax-checks `serve.mjs` and every file in `src/`. `npm test` runs the fish simulation headless for two minutes of tank time and asserts what the shoal does: that individuals cover the width, depth and height of the tank, that they coast with quiet tails between strokes, that the tail-beat frequency stays calm, that they stay inside the tank and out of each other's space, and that an undisturbed shoal uses all four of its calm states, including visits to landmarks, without falling into one synchronised cycle. It then checks the fifth state: a lunge at the glass startles the fish in front of it, the alarm spreads to their neighbours, and they all coast and settle again. Finally it feeds the tank and checks the feeding reads as animals rather than as a script: that the shoal arrives strung out over seconds instead of all at once, that some strikes miss, that the shoal's spacing collapses at the food and opens back out, that no fish gets stuck on a single pellet, and that food never triggers the escape reflex. None of this proves anatomical or photographic realism.

## Credits

Three.js 0.180.0 is included under the MIT license. The full text is in `vendor/THREE-LICENSE.txt`, and the library is documented at https://threejs.org/docs/.

The 1K diffuse and OpenGL normal maps in `assets/` are bundled from Poly Haven under [CC0](https://polyhaven.com/license):

- [Rock Boulder Dry](https://polyhaven.com/a/rock_boulder_dry)
- [Rough Wood](https://polyhaven.com/a/rough_wood)
- [Sand 01](https://polyhaven.com/a/sand_01)

The aquarium's scene geometry, GLSL modifications and simulation were created for this project.

## License

MIT. See [LICENSE](LICENSE).
