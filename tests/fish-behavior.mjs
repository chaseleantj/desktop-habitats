import { register } from "node:module";
import assert from "node:assert/strict";

register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { BOUNDS, createFishSchool } = await import("../src/fish.js");
const school = createFishSchool(new THREE.Scene(), {
  obstacles: [{ center: new THREE.Vector3(1.35, 3.6, -0.65), radius: 0.6 }],
  landmarks: [
    { kind: "wood", point: new THREE.Vector3(1.35, 4.3, 0.1), obstacle: 0 },
  ],
  thickets: [
    { minX: -8.8, maxX: -1.9, minZ: -5.7, maxZ: -2, minY: 1.2, maxY: 6.5 },
  ],
});
let visits = 0;
const states = new Set();
let minimumSpacing = Infinity;
let mixedStates = 0;
for (let frame = 0; frame < 7200; frame++) {
  school.update(1 / 60, frame / 60, null);
  const currentStates = new Set();
  for (const fish of school.fish) {
    states.add(fish.mode);
    currentStates.add(fish.mode);
    if (fish.mode === "inspect") visits++;
    assert.ok(
      fish.position.toArray().every(Number.isFinite),
      "Fish positions must stay finite",
    );
    assert.ok(
      fish.position.x >= BOUNDS.minX &&
        fish.position.x <= BOUNDS.maxX &&
        fish.position.y >= BOUNDS.minY &&
        fish.position.y <= BOUNDS.maxY &&
        fish.position.z >= BOUNDS.minZ &&
        fish.position.z <= BOUNDS.maxZ,
      "Fish must remain inside the tank",
    );
    assert.ok(
      Math.abs(fish.quaternion.length() - 1) < 1e-6,
      "Turning must preserve a normalized orientation",
    );
  }
  if (currentStates.size > 1) mixedStates++;
  if (frame % 6 === 0)
    for (let i = 0; i < school.fish.length; i++)
      for (let j = i + 1; j < school.fish.length; j++) {
        minimumSpacing = Math.min(
          minimumSpacing,
          school.fish[i].position.distanceTo(school.fish[j].position),
        );
      }
}
assert.deepEqual(
  [...states].sort(),
  ["brake", "dart", "hover", "inspect", "relocate"],
);
assert.ok(
  mixedStates > 6500,
  "Individuals should not share one synchronized behavior cycle",
);
assert.ok(
  minimumSpacing > 0.42,
  "Neighbor avoidance must prevent sustained overlap",
);
assert.ok(visits > 600, "Fish should spend time investigating landmarks and grass");
school.dispose();

const disturbed = createFishSchool(new THREE.Scene());
for (let i = 0; i < 480; i++) disturbed.update(1 / 60, i / 60, null);
const before = disturbed.getTelemetry().pointerResponses;
const location = disturbed.fish[0].position.clone();
const nearby = disturbed.fish
  .filter((fish) => fish.position.distanceTo(location) < 1.9)
  .map((fish) => fish.id);
const responseStates = new Set();
for (let i = 0; i < 360; i++) {
  disturbed.update(
    1 / 60,
    8 + i / 60,
    i < 60 ? { position: location, strength: 1 } : null,
  );
  for (const id of nearby) responseStates.add(disturbed.fish[id].mode);
}
const responses = disturbed.getTelemetry().pointerResponses - before;
assert.ok(
  responses > 0 && responses < disturbed.fish.length,
  "A nearby pointer should disturb a local subset of fish",
);
for (const state of ["dart", "brake", "hover"])
  assert.ok(
    responseStates.has(state),
    `Disturbance should pass through ${state}`,
  );
assert.ok(
  disturbed.fish.some((fish) => fish.mode === "hover" && fish.effort < 0.14),
  "Some fish must settle back to quiet station keeping",
);
disturbed.dispose();
console.log(
  `PASS: 120 simulated seconds; all five behavior states; ${visits} inspection frames; minimum sampled spacing ${minimumSpacing.toFixed(3)}; ${responses} local pointer responses followed by braking and recovery.`,
);
