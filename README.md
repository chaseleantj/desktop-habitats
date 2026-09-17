# Freshwater aquarium

A separate interactive 3D aquarium preview, inspired by the supplied aquascape. The scene uses WebGL2, GLSL materials, and a persistent fish simulation. One water model drives the whole tank: a slow current that bends the plants and carries debris, and overhead light that is focused by the rippled surface and absorbed with depth. All rendering code, textures, and dependencies are included. It makes no network requests outside its local server and does not change desktop backgrounds or wallpaper settings.

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

## Controls

- Move the pointer through the open water. Nearby fish can dart away, brake, and settle.
- **Space** pauses and resumes. A reduced-motion system preference starts the scene paused.
- **I** opens inspection controls; **F** toggles fullscreen.
- **Inspect → View** offers three closer views from the front of the tank.
- **Resolution** changes the number of rendered pixels. The default is 1.5 times the preview's CSS dimensions.
- **Measure 15 seconds** reports frame rate, frame-time tail, GPU time per frame where the browser exposes timer queries, resolution, browser, and GPU.
- The behavior readout counts fish holding station, relocating, darting, braking, and investigating the rocks, wood, or grass.
- **Save image** downloads the current rendered frame.

The composition retains the reference aspect ratio. Controls fade when the pointer leaves the preview. There is no sound or camera orbit.

## Files

- `src/main.js`: camera, lighting, water-depth postprocessing, input, and preview controls.
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
- `review/composition-round-1/`: composition report, generated references, and final captures included in the package. Earlier requests, reviews and intermediate captures remain in the local checkout.

The renderer uses PBR materials, a broad overhead reflection environment, shadow mapping, sampled depth occlusion, and supersampling with multisample antialiasing. Leaves bend and flutter in the shared current according to their compliance and length, transmit light through thin tissue per shadowed light, and let part of the scene through by multisample coverage. Fish swim in short bouts, then coast with quiet tails. A travelling bend runs down each body into a flexible tail fin; the same swimming effort produces the forward thrust. Individuals take long routes through the tank, including behind the grass, with brief rests and visits to the hardscape. They anticipate crossing neighbours and turn smoothly. Particles are lit by the same shadow map as the scene. This is raster rendering; it does not calculate full path-traced light transport.

The fish's burst-and-coast pattern is informed by [experiments on small tetras](https://pmc.ncbi.nlm.nih.gov/articles/PMC7809443/) and [observations of freely swimming tetra pairs](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1005933). Animation timing is tuned for a calm aquarium; this is not a species-calibrated hydrodynamic simulation.

## Checks

```sh
npm run check
npm test
```

The behavior check simulates two minutes of tank motion, checks individual coverage of width, depth and height, quiet-tail coasting, calm tail-beat frequency, bounds and spacing, and exercises local disturbance and recovery. It also verifies all five states, including visits to landmarks, without synchronization. It does not prove anatomical or photographic realism. In the development checkout, `review/swimming-round-1/` holds the independent motion review and `review/` holds earlier scene reviews.

Material and library attribution is in `CREDITS.md`.
