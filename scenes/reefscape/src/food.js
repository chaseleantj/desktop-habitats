import * as THREE from "three";
import { groundHeight, randomGenerator } from "./math.js";
import { shelteredVelocity, waterLitShader } from "./water.js";

// A pinch of dry micro-pellets, about a millimetre across, dropped on the water. Their
// behaviour is almost entirely surface tension and drag, and both are worth getting right
// because they set the pace of the whole feeding event.
//
// A dry 1 mm pellet does not sink when it lands, whatever its density: its Bond number is
// 0.034, so the meniscus holds about forty times its dry weight (Vella, Lee & Kim 2006,
// doi:10.1021/la060606m). It sinks only once water has soaked into the pores and the
// contact line lets go, which takes seconds to a minute and varies enormously from pellet
// to pellet -- measured float times have a standard deviation as large as their mean
// (Vassallo et al. 2006, doi:10.1111/j.1365-2109.2005.01403.x). That spread is the point:
// it is what gives a shoal time to gather before the food reaches the sand.
//
// Once wetted it falls at terminal velocity immediately -- a millimetre particle has no
// inertia worth integrating -- at 2 to 3 cm a second for this size and density. Measured
// against the fish rather than the tank, that is 0.5 to 0.75 body lengths a second, and
// the ratio is what matters: the fish cruises at nearly twice that and rushes at five
// times it, so it can always beat a pellet to the sand, and the long slow descent is what
// gives a whole shoal time to arrive (Chen, Beveridge & Telfer 1999,
// doi:10.1023/A:1009249721787, extrapolated to 1 mm with the Ferguson & Church 2004
// settling law, doi:10.1306/051204740933). It does not flutter or tumble on the way down:
// at Galileo number 36 the wake stays axisymmetric and the fall stays straight (Jenny,
// Dusek & Bouchet 2004, doi:10.1017/S0022112004009164). An irregular grain has no
// preferred axis, so it turns slowly about a fixed one and glides a few degrees off
// vertical, and that is all.
const PELLET = {
  radius: [0.0105, 0.014],
  sink: [0.33, 0.47],
  float: [2.2, 4.5],
  lingerChance: 0.15,
  linger: [22, 55],
  bob: 0.016,
  bobRate: 3.8,
  glide: 0.14,
  spin: [0.3, 1.2],
  stagger: [0.03, 0.12],
  perPinch: 10,
  capacity: 100,
  life: [20, 40],
  swallow: 0.12,
  shoveLimit: 0.36,
};
// Food is dropped at the top of the water column the camera actually shows. The modelled
// surface at water.js's SURFACE_Y sits above the frame, so a pellet released there would
// spend its whole float phase out of sight; the fish's own ceiling is the visible film.
const FILM = 8.15;
const PINCH = { x: 0.26, minZ: -0.6, maxZ: 2.2 };
// The water the food may occupy: glass on three sides, sand below. A pellet carried into
// the glass by the current stops against it and sinks there instead of leaving the tank.
const TANK = { minX: -8.2, maxX: 8.2, minZ: -4.5, maxZ: 3.0 };
// Settled pellets do not creep. Lifting one off the sand takes a free-stream flow of
// 15 to 19 cm/s (critical shear 0.06 Pa smooth, 0.32 Pa rough: Carvajalino-Fernandez et
// al. 2020, doi:10.3354/aei00350) and the tank's current is an order of magnitude below
// that -- but a fish's tail stroke or a missed strike easily exceeds it, which is why a
// pellet can be blown off the sand only by a fish.
const RESUSPENSION = { drag: 5.5, settleTime: 0.9, recovery: 8 };

export function createFood(scene, { thickets = [] } = {}) {
  const random = randomGenerator(902311);
  const range = (min, max) => min + random() * (max - min);
  const exponential = (mean) => -mean * Math.log(1 - random());

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
  });
  material.onBeforeCompile = (shader) => waterLitShader(shader);
  material.customProgramCacheKey = () => "food-pellet-v1";
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    material,
    PELLET.capacity,
  );
  mesh.name = "Sinking food pellets";
  // A pellet is far too small to cast a shadow the 4096-map can resolve -- it would smear
  // a soft blob several times its own size onto the sand -- but it must visibly dim as it
  // drifts under the driftwood, so it receives.
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  scene.add(mesh);
  // Dry food is a pale tan-orange, light enough to read against dark water as well as
  // against the pale sand, and nothing else in the tank is that colour. Each pellet keeps its own tint, written to whichever
  // instance slot it currently occupies, so a pellet does not change colour when another
  // one ahead of it is eaten.
  const tint = new THREE.Color();
  for (let i = 0; i < PELLET.capacity; i++) mesh.setColorAt(i, tint.setRGB(0, 0, 0));

  const pellets = [];
  const pending = [];
  const stats = { dropped: 0, eaten: 0, dissolved: 0 };
  let elapsed = 0;
  let serial = 0;
  const flow = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const instance = new THREE.Matrix4();

  // A pinch scatters: a few pellets land within a body length of each other, each entering
  // the water a few tens of milliseconds after the last, which desynchronises every timer
  // downstream of them for free. Depth is chosen here rather than taken from the pointer,
  // which can only give two dimensions, and is kept in the open water so a fish can reach
  // every pellet without fighting the glass.
  function drop(point, count = PELLET.perPinch) {
    let at = elapsed;
    for (let i = 0; i < count; i++) {
      if (pellets.length + pending.length >= PELLET.capacity) break;
      at += range(PELLET.stagger[0], PELLET.stagger[1]);
      pending.push({
        at,
        x: THREE.MathUtils.clamp(
          point.x + range(-PINCH.x, PINCH.x),
          TANK.minX + 0.5,
          TANK.maxX - 0.5,
        ),
        z: range(PINCH.minZ, PINCH.maxZ),
      });
    }
  }

  function spawn({ x, z }) {
    const lingering = random() < PELLET.lingerChance;
    const pellet = {
      serial: serial++,
      position: new THREE.Vector3(x, FILM, z),
      velocity: new THREE.Vector3(),
      // How much a fish has already pushed this pellet about. One pass, or one missed
      // strike, can only move it so far; the allowance comes back over several seconds,
      // so a pellet the shoal keeps working at does travel, but nothing can shove it
      // across the tank in one go.
      shoved: 0,
      kick: new THREE.Vector3(),
      radius: range(PELLET.radius[0], PELLET.radius[1]),
      shape: new THREE.Vector3(range(0.9, 1.15), range(0.85, 1.1), range(0.9, 1.15)),
      axis: new THREE.Vector3(range(-1, 1), range(-1, 1), range(-1, 1)).normalize(),
      angle: range(0, Math.PI * 2),
      spin: range(PELLET.spin[0], PELLET.spin[1]),
      tint: new THREE.Color().setHSL(range(0.05, 0.09), range(0.5, 0.68), range(0.36, 0.52)),
      // A fixed few degrees of tilt on the fall path: an irregular grain glides, it does
      // not flutter.
      glide: new THREE.Vector3(range(-1, 1), 0, range(-1, 1))
        .normalize()
        .multiplyScalar(range(0, PELLET.glide)),
      sink: range(PELLET.sink[0], PELLET.sink[1]),
      // How long this pellet lasts from the moment it touches the water, whatever it is
      // doing when the time comes. A pellet that draws a long float can reach the end of
      // its life still on the surface and break up there without ever having sunk, which
      // is what a dry pellet that never properly wets actually does.
      bornAt: elapsed,
      life: range(PELLET.life[0], PELLET.life[1]),
      wetAt: lingering
        ? elapsed + range(PELLET.linger[0], PELLET.linger[1])
        : elapsed + PELLET.float[0] + exponential(PELLET.float[1]),
      bob: range(0, Math.PI * 2),
      settledAt: 0,
      gone: false,
      eatenAt: 0,
    };
    pellets.push(pellet);
    stats.dropped++;
    return pellet;
  }

  const floating = (pellet) => elapsed < pellet.wetAt;
  const settled = (pellet) => pellet.settledAt > 0;

  // Taken into a fish's mouth. The pellet closes over about an eighth of a second rather
  // than popping, so the frame in which it disappears is the frame the jaws shut.
  function take(pellet) {
    if (pellet.gone || pellet.eatenAt) return false;
    pellet.eatenAt = elapsed;
    pellet.gone = true;
    stats.eaten++;
    return true;
  }

  // A passing bow wave, a missed strike, or the water a fish moves picking at the sand.
  // Only a fish can do this; the tank's own current is far too slow.
  function nudge(pellet, direction, amount) {
    if (pellet.gone) return;
    const room = Math.max(0, PELLET.shoveLimit - pellet.shoved);
    const shove = Math.min(amount, room);
    if (shove <= 0) return;
    pellet.shoved += shove;
    pellet.kick.addScaledVector(direction, shove * RESUSPENSION.drag);
    pellet.settledAt = 0;
  }

  function remove(index) {
    const last = pellets.pop();
    if (index < pellets.length) pellets[index] = last;
  }

  function update(dt, time) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    elapsed += dt;
    while (pending.length && pending[0].at <= elapsed) spawn(pending.shift());
    for (let i = pellets.length - 1; i >= 0; i--) {
      const pellet = pellets[i];
      const { position, velocity } = pellet;
      if (pellet.eatenAt) {
        if (elapsed - pellet.eatenAt > PELLET.swallow) remove(i);
        continue;
      }
      const floor = groundHeight(position.x, position.z) + pellet.radius * 0.7;
      const held = floating(pellet);
      shelteredVelocity(position, time, flow, thickets);
      velocity.copy(flow).add(pellet.kick);
      if (held) velocity.y = 0;
      else if (settled(pellet)) velocity.set(0, 0, 0);
      else {
        // Terminal velocity from the first millimetre of the fall, down a path tilted a
        // few degrees off vertical.
        velocity.y -= pellet.sink;
        velocity.addScaledVector(pellet.glide, pellet.sink);
      }
      pellet.kick.multiplyScalar(Math.exp(-dt * RESUSPENSION.drag));
      pellet.shoved *= Math.exp(-dt / RESUSPENSION.recovery);
      position.addScaledVector(velocity, dt);
      position.x = THREE.MathUtils.clamp(position.x, TANK.minX, TANK.maxX);
      position.z = THREE.MathUtils.clamp(position.z, TANK.minZ, TANK.maxZ);
      if (held) {
        pellet.bob += dt * PELLET.bobRate;
        position.y = FILM + Math.sin(pellet.bob) * PELLET.bob;
      } else if (position.y <= floor) {
        position.y = floor;
        if (!settled(pellet)) pellet.settledAt = elapsed;
      }
      // Rotation carries on while the pellet falls and damps out once it is lying on the
      // sand.
      const turning = settled(pellet)
        ? Math.max(0, 1 - (elapsed - pellet.settledAt) / RESUSPENSION.settleTime)
        : 1;
      pellet.angle += dt * pellet.spin * turning;
      // Softening and breaking apart. Real extruded food lasts minutes to hours and is
      // mostly broken down by being mouthed; this is far quicker, so that a long session
      // does not silt the sand up with litter and the tank always comes back to clean
      // water on its own.
      if (elapsed - pellet.bornAt > pellet.life) {
        pellet.gone = true;
        stats.dissolved++;
        remove(i);
      }
    }
    for (let i = 0; i < pellets.length; i++) {
      const pellet = pellets[i];
      const swallow = pellet.eatenAt
        ? Math.max(0, 1 - (elapsed - pellet.eatenAt) / PELLET.swallow)
        : 1;
      // Thinning away over the whole of its life, so a pellet is visibly going before it
      // goes and none of them wink out at full size.
      const fading =
        1 - 0.5 * Math.min(1, (elapsed - pellet.bornAt) / pellet.life);
      spin.setFromAxisAngle(pellet.axis, pellet.angle);
      size.copy(pellet.shape).multiplyScalar(pellet.radius * swallow * fading);
      instance.compose(pellet.position, spin, size);
      mesh.setMatrixAt(i, instance);
      mesh.setColorAt(i, pellet.tint);
    }
    mesh.count = pellets.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (pellets.length) mesh.instanceColor.needsUpdate = true;
  }

  return {
    drop,
    update,
    pellets,
    take,
    nudge,
    floating,
    settled,
    stats,
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
