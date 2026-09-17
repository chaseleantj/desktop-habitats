import { register } from "node:module";
import assert from "node:assert/strict";

register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { BOUNDS, COUNT, createFishSchool } = await import("../src/fish.js");
const { FLOW_DIRECTION } = await import("../src/water.js");

const STEP = 1 / 60;
const THICKETS = [
  { minX: -8.8, maxX: -1.9, minZ: -5.7, maxZ: -2, minY: 1.2, maxY: 6.5 },
  { minX: 3.0, maxX: 8.7, minZ: -5.7, maxZ: -2, minY: 1.2, maxY: 6.5 },
];
const upstream = FLOW_DIRECTION.clone().negate();
const behindGrass = (p) =>
  p.z < -2.2 && THICKETS.some((bed) => p.x > bed.minX && p.x < bed.maxX);
const insideTank = (p) =>
  p.x >= BOUNDS.minX &&
  p.x <= BOUNDS.maxX &&
  p.y >= BOUNDS.minY &&
  p.y <= BOUNDS.maxY &&
  p.z >= BOUNDS.minZ &&
  p.z <= BOUNDS.maxZ;

// Two undisturbed minutes: individuals cross the tank, alternate strokes with glides,
// stay apart, investigate the planting, and face into the current during short rests.
const scene = new THREE.Scene();
const school = createFishSchool(scene, {
  obstacles: [{ center: new THREE.Vector3(1.35, 3.6, -0.65), radius: 0.6 }],
  landmarks: [
    { kind: "wood", point: new THREE.Vector3(1.35, 4.3, 0.1), obstacle: 0 },
  ],
  thickets: THICKETS,
});
let visits = 0,
  behind = 0,
  mixedStates = 0,
  hovering = 0,
  facingUpstream = 0;
let travelling = 0,
  gliding = 0,
  beatingInPlace = 0,
  peakBeatFrequency = 0;
const swimAttribute = scene
  .getObjectByName("Silver-blue freshwater fish")
  .geometry.getAttribute("aSwim");
const tracks = school.fish.map((fish) => ({
  minimum: fish.position.clone(),
  maximum: fish.position.clone(),
  phase: fish.phase,
}));
const states = new Set();
let minimumSpacing = Infinity;
for (let frame = 0; frame < 7200; frame++) {
  school.update(STEP, frame * STEP, null);
  const currentStates = new Set();
  for (const fish of school.fish) {
    const track = tracks[fish.id];
    track.minimum.min(fish.position);
    track.maximum.max(fish.position);
    const tailAngle = swimAttribute.getY(fish.id);
    const phaseStep = (fish.phase - track.phase + Math.PI * 2) % (Math.PI * 2);
    peakBeatFrequency = Math.max(peakBeatFrequency, phaseStep / (Math.PI * 2 * STEP));
    track.phase = fish.phase;
    if (fish.mode === "travel") {
      travelling++;
      if (tailAngle < 0.03 && fish.swim.length() > 0.25) gliding++;
    }
    if (tailAngle > 0.15 && fish.velocity.length() < 0.12) beatingInPlace++;
    states.add(fish.mode);
    currentStates.add(fish.mode);
    if (fish.mode === "inspect") visits++;
    if (behindGrass(fish.position)) behind++;
    if (frame > 3600 && fish.mode === "hover") {
      hovering++;
      if (fish.heading.dot(upstream) > 0.5) facingUpstream++;
    }
    assert.ok(
      fish.position.toArray().every(Number.isFinite),
      "Fish positions must stay finite",
    );
    assert.ok(insideTank(fish.position), "Fish must remain inside the tank");
    assert.ok(
      Math.abs(fish.quaternion.length() - 1) < 1e-6,
      "Turning must preserve a normalized orientation",
    );
  }
  if (currentStates.size > 1) mixedStates++;
  if (frame % 6 === 0)
    for (let i = 0; i < school.fish.length; i++)
      for (let j = i + 1; j < school.fish.length; j++)
        minimumSpacing = Math.min(
          minimumSpacing,
          school.fish[i].position.distanceTo(school.fish[j].position),
        );
}
assert.deepEqual(
  [...states].sort(),
  ["hover", "inspect", "settle", "travel"],
  "An undisturbed shoal uses every calm state and never a C-start",
);
assert.ok(
  mixedStates > 6500,
  "Individuals should not share one synchronized behavior cycle",
);
assert.ok(
  minimumSpacing > 0.4,
  `Neighbor avoidance must prevent sustained overlap (got ${minimumSpacing.toFixed(3)})`,
);
assert.ok(visits > 600, "Fish should spend time investigating landmarks and grass");
assert.ok(
  behind > 7200 * COUNT * 0.02,
  `Fish should spend time behind the grass (got ${behind} fish-frames)`,
);
const rheotaxis = facingUpstream / hovering;
assert.ok(
  rheotaxis > 0.55 && rheotaxis < 0.97,
  `Most, not all, hovering fish face into the current (got ${(rheotaxis * 100).toFixed(0)}%)`,
);
const roaming = tracks.filter(({ minimum, maximum }) =>
  maximum.x - minimum.x > (BOUNDS.maxX - BOUNDS.minX) * 0.45 &&
  maximum.z - minimum.z > 3 &&
  maximum.y - minimum.y > 1.5,
).length;
assert.ok(
  roaming >= COUNT * 0.75,
  `Most individuals must explore across width, depth and height (got ${roaming})`,
);
assert.ok(
  travelling > 7200 * COUNT * 0.55,
  "Free swimming should dominate over holding a fixed station",
);
assert.ok(
  gliding / travelling > 0.25 && gliding / travelling < 0.75,
  `Swimming must alternate visible strokes with quiet-tail glides (got ${(gliding / travelling * 100).toFixed(0)}% gliding)`,
);
assert.ok(
  beatingInPlace < 7200 * COUNT * 0.04,
  "Fish should rarely beat their tails while barely moving",
);
assert.ok(
  peakBeatFrequency < 4.2,
  `Calm swimming should not vibrate rapidly (got ${peakBeatFrequency.toFixed(2)} Hz)`,
);
school.dispose();

// A slow approach is read as something to keep a distance from, never as an attack.
const calm = createFishSchool(new THREE.Scene());
for (let i = 0; i < 480; i++) calm.update(STEP, i * STEP, null);
const subject = calm.fish[0].position.clone();
const slowPointer = {
  position: subject.clone().add(new THREE.Vector3(0.7, 0, 1.0)),
  velocity: new THREE.Vector3(-0.12, 0, -0.16),
};
const watched = calm.fish
  .filter((fish) => fish.position.distanceTo(slowPointer.position) < 1.8)
  .map((fish) => fish.id);
const distanceTo = (school, ids, point) =>
  ids.reduce((sum, id) => sum + school.fish[id].position.distanceTo(point), 0) /
  ids.length;
const before = distanceTo(calm, watched, slowPointer.position);
for (let i = 0; i < 360; i++) {
  if (i < 180) slowPointer.position.addScaledVector(slowPointer.velocity, STEP);
  else slowPointer.velocity.set(0, 0, 0);
  calm.update(STEP, 8 + i * STEP, slowPointer);
}
assert.equal(calm.getTelemetry().escapes, 0, "A slow approach must not fire a C-start");
const after = distanceTo(calm, watched, slowPointer.position);
assert.ok(
  after > before + 0.3,
  `Fish give a slowly approaching object room (${before.toFixed(2)} to ${after.toFixed(2)})`,
);
calm.dispose();

// A lunge at the glass fires C-starts in the fish in front of it, the alarm spreads to
// their neighbours, and everyone coasts and settles again.
const startledSchool = createFishSchool(new THREE.Scene());
for (let i = 0; i < 480; i++) startledSchool.update(STEP, i * STEP, null);
const location = startledSchool.fish[0].position.clone();
const nearby = startledSchool.fish
  .filter((fish) => fish.position.distanceTo(location) < 1.9)
  .map((fish) => fish.id);
const lunge = {
  position: location.clone().add(new THREE.Vector3(0, 0, 2.4)),
  velocity: new THREE.Vector3(0, 0, -9),
};
const passedThrough = new Set();
let peakSpeed = 0;
for (let i = 0; i < 360; i++) {
  if (i < 15) lunge.position.addScaledVector(lunge.velocity, STEP);
  else lunge.velocity.set(0, 0, 0);
  startledSchool.update(STEP, 8 + i * STEP, i < 90 ? lunge : null);
  for (const id of nearby) {
    passedThrough.add(startledSchool.fish[id].mode);
    peakSpeed = Math.max(peakSpeed, startledSchool.fish[id].velocity.length());
  }
}
const telemetry = startledSchool.getTelemetry();
assert.ok(
  telemetry.pointerResponses > 0 && telemetry.pointerResponses < COUNT,
  `A lunge startles the fish in front of it, not the whole tank (got ${telemetry.pointerResponses})`,
);
assert.ok(
  telemetry.escapes > telemetry.pointerResponses,
  "Alarm should spread from startled fish to their neighbours",
);
for (const state of ["escape", "settle", "hover"])
  assert.ok(passedThrough.has(state), `An escape should pass through ${state}`);
assert.ok(
  peakSpeed > 4,
  `A C-start should reach several body lengths a second (got ${peakSpeed.toFixed(2)})`,
);
assert.ok(
  startledSchool.fish.some((fish) => fish.mode === "hover" && fish.effort < 0.35),
  "Some fish must settle back to quiet station keeping",
);
startledSchool.dispose();

console.log(
  `PASS: 120 simulated seconds; ${roaming}/${COUNT} fish explored all three dimensions; ${(gliding / travelling * 100).toFixed(0)}% of travel was quiet-tail gliding; calm tail beats at most ${peakBeatFrequency.toFixed(2)} Hz; ${visits} inspection frames; ${behind} fish-frames behind the grass; ${(rheotaxis * 100).toFixed(0)}% of hovering fish facing upstream; minimum sampled spacing ${minimumSpacing.toFixed(3)}; slow approach gave room (${before.toFixed(2)} to ${after.toFixed(2)}) without a startle; a lunge startled ${telemetry.pointerResponses} fish directly and ${telemetry.escapes} in all, peaking at ${peakSpeed.toFixed(2)} units per second.`,
);
