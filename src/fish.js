import * as THREE from "three";
import { groundHeight, randomGenerator } from "./math.js";
import {
  applySkin,
  createFishMaterials,
  makeAnatomy,
} from "./fish-anatomy.js";

export const COUNT = 24;
// The whole water column the fish may use. The floor is the sand, tracked separately.
export const BOUNDS = {
  minX: -8.3,
  maxX: 8.3,
  minY: 0.7,
  maxY: 8.4,
  minZ: -4.7,
  maxZ: 3.2,
};
// Where the school prefers to hold station: the lit open water in front of the wood.
const OPEN = { minX: -6.4, maxX: 6.4, minY: 2.2, maxY: 6.4, minZ: 0.1, maxZ: 3.0 };
const GROUND_CLEARANCE = 0.55;
const MAX_EXPLORERS = 7;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(1, 0, 0);
const TAU = Math.PI * 2;

// The body is a flexible beam behind a nearly rigid head. Its spine follows a planar
// curve whose curvature is the sum of a turning bend, set by how sharply the fish is
// turning for its speed, and a propulsive wave that travels toward the tail and grows
// there. Positions are found by integrating the curve; cross-sections stay rigid and
// rotate with it, so the tail fin swings with the body instead of sliding sideways.
const SWIM_GLSL = /* glsl */ `
  // Part ids come from fish-anatomy.js: 4 and 5 are the pectorals, 1-3, 6 and 12 the other fins.
  attribute vec4 aSwim; // x: wave phase, y: wave curvature, z: turning curvature, w: pectoral brake
  attribute float aPart;
  attribute float aFinProgress;
  varying vec3 vSkinPoint;
  varying vec2 vFishUV;
  varying float vFishPart;
  const float PIVOT = 0.12;
  vec3 gSwimPosition;
  float spineCurvature(float s) {
    if (s < 0.0) return 0.25 * aSwim.z;
    float along = clamp(s / 0.57, 0.0, 1.0);
    return aSwim.z + aSwim.y * pow(along, 1.5) * sin(aSwim.x - s * 7.5);
  }
  vec3 finMotion(vec3 p) {
    if (aPart > 3.5 && aPart < 5.5) {
      float side = aPart < 4.5 ? 1.0 : -1.0;
      float beat = sin(aSwim.x * 1.53 + side * 0.9);
      p.z += side * aFinProgress * (0.013 * beat + 0.018 * aSwim.w);
      p.x += aFinProgress * (0.008 * beat - 0.033 * aSwim.w);
      p.y += aFinProgress * 0.008 * cos(aSwim.x * 1.53 + side * 0.9);
    } else if ((aPart > 1.5 && aPart < 6.5) || aPart > 11.5) {
      p.z += sin(aSwim.x - p.x * 10.0) * aFinProgress * 0.006;
    }
    return p;
  }
  vec3 bendSpine(vec3 p, inout vec3 n) {
    float s = PIVOT - p.x;
    // The head swings a little against the tail so momentum balances.
    float theta = -0.1 * aSwim.y * sin(aSwim.x + 0.6);
    vec2 spine = vec2(PIVOT, 0.0);
    float kappa = spineCurvature(s);
    if (s < 0.0) {
      float mid = theta + 0.5 * kappa * s;
      spine += vec2(-cos(mid), sin(mid)) * s;
      theta += kappa * s;
    } else {
      float ds = s / 6.0;
      for (int i = 0; i < 6; i++) {
        float k = spineCurvature((float(i) + 0.5) * ds);
        float mid = theta + 0.5 * k * ds;
        spine += vec2(-cos(mid), sin(mid)) * ds;
        theta += k * ds;
      }
    }
    float c = cos(theta), sn = sin(theta);
    vec3 local = vec3(n.x / max(0.3, 1.0 - p.z * kappa), n.y, n.z);
    n = normalize(vec3(local.x * c + local.z * sn, local.y, -local.x * sn + local.z * c));
    return vec3(spine.x + p.z * sn, p.y, spine.y + p.z * c);
  }
`;

function applySwimming(material, withColor = true) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>\n${SWIM_GLSL}`,
    );
    if (withColor) {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <beginnormal_vertex>",
          /* glsl */ `
          vec3 objectNormal = vec3(normal);
          gSwimPosition = bendSpine(finMotion(position), objectNormal);
        `,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          vec3 transformed = gSwimPosition;
          vSkinPoint = position;
          vFishUV = uv;
          vFishPart = aPart;
        `,
        );
      applySkin(shader);
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `
        vec3 swimNormal = vec3(0.0, 1.0, 0.0);
        vec3 transformed = bendSpine(finMotion(position), swimNormal);
      `,
      );
    }
  };
  material.customProgramCacheKey = () =>
    `aquarium-fish-${withColor ? "skin" : "depth"}-3`;
}

function clampToBox(position, box, margin = 0) {
  position.x = THREE.MathUtils.clamp(position.x, box.minX + margin, box.maxX - margin);
  position.y = THREE.MathUtils.clamp(position.y, box.minY + margin, box.maxY - margin);
  position.z = THREE.MathUtils.clamp(position.z, box.minZ + margin, box.maxZ - margin);
  position.y = Math.max(
    position.y,
    groundHeight(position.x, position.z) + GROUND_CLEARANCE + margin,
  );
  return position;
}

export function createFishSchool(
  scene,
  { obstacles = [], landmarks = [], thickets = [] } = {},
) {
  const random = randomGenerator(583137);
  const range = (min, max) => min + random() * (max - min);
  const geometry = makeAnatomy();
  const swim = new THREE.InstancedBufferAttribute(
    new Float32Array(COUNT * 4),
    4,
  );
  swim.setUsage(THREE.DynamicDrawUsage);
  geometry.body.setAttribute("aSwim", swim);
  geometry.fins.setAttribute("aSwim", swim);
  const { skin: skinMaterial, fins: finMaterial } = createFishMaterials();
  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  applySwimming(skinMaterial);
  applySwimming(finMaterial);
  applySwimming(depthMaterial, false);
  const bodies = new THREE.InstancedMesh(geometry.body, skinMaterial, COUNT);
  const membranes = new THREE.InstancedMesh(geometry.fins, finMaterial, COUNT);
  bodies.name = "Silver-blue freshwater fish";
  membranes.name = "Attached translucent fish fins";
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  bodies.customDepthMaterial = depthMaterial;
  bodies.frustumCulled = false;
  membranes.frustumCulled = false;
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  membranes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bodies, membranes);

  // Places a fish may go and look at: the hardscape landmarks and spots inside the grass.
  const interests = landmarks.map((landmark) => ({ ...landmark }));
  for (const bed of thickets)
    for (let i = 0; i < 5; i++)
      interests.push({
        kind: "grass",
        point: new THREE.Vector3(
          range(bed.minX + 0.4, bed.maxX - 0.4),
          range(1.6, Math.min(bed.maxY, 4.8)),
          range(bed.minZ + 0.4, bed.maxZ - 0.3),
        ),
        obstacle: -1,
      });

  let elapsed = 0;
  let startled = 0;
  const initialPositions = [];
  const fish = Array.from({ length: COUNT }, (_, id) => {
    const band = id % 6;
    const position = new THREE.Vector3();
    do {
      position.set(
        -5.7 + band * 2.18 + range(-0.45, 0.45),
        range(2.55, 5.75),
        range(0.42, 2.7),
      );
    } while (
      initialPositions.some((other) => other.distanceToSquared(position) < 0.55)
    );
    initialPositions.push(position);
    const heading = new THREE.Vector3(
      random() < 0.72 ? 1 : -1,
      range(-0.045, 0.045),
      range(-0.16, 0.16),
    ).normalize();
    return {
      id,
      position,
      heading,
      velocity: heading.clone().multiplyScalar(range(0.008, 0.055)),
      anchor: position.clone(),
      goal: position.clone(),
      quaternion: new THREE.Quaternion(),
      scale: range(0.83, 1.08),
      phase: range(0, TAU),
      character: range(0.8, 1.2),
      mode: "hover",
      until: range(0.6, 8.4),
      cooldown: range(0, 2),
      effort: range(0.02, 0.07),
      bend: 0,
      finBrake: 0,
      seed: range(0, 100),
      // Curiosity builds while a fish holds station and is spent on a visit somewhere.
      curiosity: range(0, 0.7),
      interest: null,
      peck: 0,
    };
  });
  const delta = new THREE.Vector3();
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const acceleration = new THREE.Vector3();
  const avoidance = new THREE.Vector3();
  const separation = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const alignment = new THREE.Vector3();
  const previousHeading = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const targetQuaternion = new THREE.Quaternion();
  const bankQuaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  const explorers = () =>
    fish.filter((f) => f.interest || f.mode === "inspect").length;

  function brake(individual) {
    individual.mode = "brake";
    individual.until = elapsed + range(0.65, 1.35);
    individual.anchor
      .copy(individual.position)
      .addScaledVector(individual.velocity, 0.22);
    clampToBox(individual.anchor, BOUNDS, 0.12);
  }

  function dart(individual, direction, frightened = false) {
    individual.mode = "dart";
    individual.until = elapsed + range(0.26, frightened ? 0.55 : 0.43);
    individual.goal
      .copy(individual.position)
      .addScaledVector(direction, range(0.82, 1.38));
    clampToBox(individual.goal, BOUNDS, 0.2);
    individual.cooldown = elapsed + range(6.5, 12.0);
  }

  function relocate(individual, goal, duration) {
    individual.mode = "relocate";
    individual.until = elapsed + duration;
    individual.goal.copy(goal);
  }

  // A relaxed move within the open water, biased toward company.
  function wander(individual, neighborsCentroid) {
    target
      .copy(individual.position)
      .add(
        new THREE.Vector3(range(-2.6, 2.6), range(-0.65, 0.65), range(-0.85, 0.85)),
      );
    if (neighborsCentroid) target.lerp(neighborsCentroid, 0.25);
    clampToBox(target, OPEN, 0.3);
    relocate(individual, target, range(3.2, 6.5));
    // Nearby fish at rest sometimes leave with it.
    for (const other of fish) {
      if (
        other !== individual &&
        other.mode === "hover" &&
        !other.interest &&
        other.position.distanceToSquared(individual.position) < 2.0 &&
        random() < 0.18
      ) {
        delta.copy(target).add(
          new THREE.Vector3(range(-0.8, 0.8), range(-0.3, 0.3), range(-0.5, 0.5)),
        );
        clampToBox(delta, OPEN, 0.3);
        relocate(other, delta, range(3.2, 6.5));
      }
    }
  }

  function visit(individual) {
    const interest = interests[Math.floor(random() * interests.length)];
    individual.interest = interest;
    individual.curiosity = 0;
    relocate(individual, interest.point, 14);
  }

  function decide(individual) {
    const { mode } = individual;
    if (mode === "dart") {
      brake(individual);
    } else if (mode === "relocate") {
      if (individual.interest) {
        // Arrived: hang in front of it, nose toward it, and pick at it.
        individual.mode = "inspect";
        individual.until = elapsed + range(3, 8) * individual.character;
        individual.anchor.copy(individual.position);
        individual.peck = elapsed + range(0.4, 1.2);
      } else brake(individual);
    } else if (mode === "inspect") {
      individual.interest = null;
      wander(individual, null);
    } else if (mode === "brake") {
      individual.mode = "hover";
      individual.until = elapsed + range(4, 14) / individual.character;
      individual.anchor.copy(individual.position);
    } else if (
      interests.length &&
      individual.curiosity > 0.55 &&
      random() < individual.curiosity * 0.9 &&
      explorers() < MAX_EXPLORERS
    ) {
      visit(individual);
    } else if (random() < 0.3) {
      target.copy(individual.heading).multiplyScalar(range(0.1, 0.7));
      target
        .add(
          new THREE.Vector3(range(-1, 1), range(-0.2, 0.2), range(-0.6, 0.6)),
        )
        .normalize();
      dart(individual, target);
    } else {
      wander(individual, null);
    }
  }

  function update(dt, time, pointer) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    elapsed += dt;
    for (const individual of fish) {
      const { position, velocity } = individual;
      if (elapsed >= individual.until) decide(individual);
      if (individual.mode !== "inspect")
        individual.curiosity = Math.min(
          1,
          individual.curiosity + dt * 0.012 * individual.character,
        );
      if (
        pointer &&
        pointer.strength > 0.09 &&
        elapsed >= individual.cooldown
      ) {
        delta.subVectors(position, pointer.position);
        const radius = 1.48 + Math.min(pointer.strength, 1) * 0.42;
        if (
          delta.lengthSq() < radius * radius &&
          random() < dt * (1.5 + 4 * pointer.strength)
        ) {
          delta.y *= 0.42;
          if (delta.lengthSq() < 0.01) delta.set(range(-1, 1), 0.1, -0.5);
          individual.interest = null;
          dart(individual, delta.normalize(), true);
          startled++;
        }
      }

      centroid.set(0, 0, 0);
      alignment.set(0, 0, 0);
      separation.set(0, 0, 0);
      let neighbors = 0;
      for (const other of fish) {
        if (other === individual) continue;
        delta.subVectors(position, other.position);
        const distanceSquared = delta.lengthSq();
        if (distanceSquared < 5.8) {
          centroid.add(other.position);
          alignment.add(other.heading);
          neighbors++;
          if (distanceSquared < 0.81) {
            separation.addScaledVector(
              delta,
              (0.81 - distanceSquared) / Math.max(distanceSquared, 0.04),
            );
          }
        }
      }

      const { mode } = individual;
      if (mode === "hover") {
        target.copy(individual.anchor);
        target.x += Math.sin(elapsed * 0.31 + individual.seed) * 0.045;
        target.y += Math.sin(elapsed * 0.69 + individual.seed * 1.4) * 0.028;
        target.z += Math.sin(elapsed * 0.27 + individual.seed * 0.7) * 0.032;
        desired
          .subVectors(target, position)
          .multiplyScalar(0.65)
          .clampLength(0, 0.12);
      } else if (mode === "brake") {
        desired
          .subVectors(individual.anchor, position)
          .multiplyScalar(0.24)
          .clampLength(0, 0.065);
      } else if (mode === "inspect") {
        // Hold just off the object, drifting slightly, with short pecks toward it.
        target.copy(individual.interest.point);
        delta.subVectors(target, position);
        const standoff = individual.interest.kind === "grass" ? 0.1 : 0.32;
        desired
          .copy(delta)
          .setLength(Math.max(0, delta.length() - standoff))
          .multiplyScalar(0.5)
          .clampLength(0, 0.1);
        desired.x += Math.sin(elapsed * 0.9 + individual.seed) * 0.02;
        desired.y += Math.sin(elapsed * 1.3 + individual.seed * 2.0) * 0.015;
        if (elapsed > individual.peck) {
          individual.peck = elapsed + range(0.6, 1.8);
          velocity.addScaledVector(delta.normalize(), range(0.08, 0.16));
        }
      } else {
        desired.subVectors(individual.goal, position);
        const remaining = desired.length();
        if (mode === "relocate" && remaining < (individual.interest ? 0.4 : 0.24))
          decide(individual);
        desired.normalize();
        if (neighbors && mode === "relocate" && !individual.interest) {
          centroid
            .multiplyScalar(1 / neighbors)
            .sub(position)
            .clampLength(0, 1);
          alignment.normalize();
          desired
            .addScaledVector(centroid, 0.12)
            .addScaledVector(alignment, 0.15)
            .normalize();
        }
        const cruise = individual.interest ? 0.2 : 0.23;
        const speed =
          mode === "dart"
            ? 1.26
            : (cruise + individual.character * 0.13) *
              Math.min(1, remaining / 0.55);
        desired.multiplyScalar(speed);
      }

      avoidance
        .copy(separation)
        .multiplyScalar(mode === "hover" || mode === "inspect" ? 0.4 : 0.66);
      obstacles.forEach((obstacle, index) => {
        delta.subVectors(position, obstacle.center);
        const distance = delta.length();
        const surface = distance - obstacle.radius - individual.scale * 0.23;
        // A fish may come close to the thing it is looking at.
        const buffer =
          individual.interest && individual.interest.obstacle === index
            ? 0.12
            : 0.7;
        if (surface < buffer && distance > 0.001)
          avoidance.addScaledVector(
            delta,
            ((buffer - surface) * 1.25) / distance,
          );
      });
      const wallDistance = 0.6;
      for (const [axis, minimum, maximum] of [
        ["x", BOUNDS.minX, BOUNDS.maxX],
        ["y", BOUNDS.minY, BOUNDS.maxY],
        ["z", BOUNDS.minZ, BOUNDS.maxZ],
      ]) {
        if (position[axis] < minimum + wallDistance)
          avoidance[axis] += (minimum + wallDistance - position[axis]) * 0.45;
        if (position[axis] > maximum - wallDistance)
          avoidance[axis] -= (position[axis] - maximum + wallDistance) * 0.45;
      }
      const floor = groundHeight(position.x, position.z) + GROUND_CLEARANCE;
      if (position.y < floor + wallDistance)
        avoidance.y += (floor + wallDistance - position.y) * 0.6;
      desired.add(avoidance);
      previousHeading.copy(individual.heading);
      const wantedSpeed = desired.length();
      const steering =
        mode === "dart" ||
        mode === "relocate" ||
        mode === "inspect" ||
        (mode === "hover" && wantedSpeed > 0.14);
      if (steering && (wantedSpeed > 0.02 || mode === "inspect")) {
        if (mode === "inspect")
          target.subVectors(individual.interest.point, position).normalize();
        else target.copy(desired).multiplyScalar(1 / wantedSpeed);
        const yaw = Math.atan2(individual.heading.z, individual.heading.x);
        const wantedYaw = Math.atan2(target.z, target.x);
        const difference = Math.atan2(
          Math.sin(wantedYaw - yaw),
          Math.cos(wantedYaw - yaw),
        );
        const turnLimit =
          dt * (mode === "dart" ? 4.8 : mode === "inspect" ? 1.4 : 2.4);
        const nextYaw =
          yaw + THREE.MathUtils.clamp(difference, -turnLimit, turnLimit);
        const pitchLimit =
          mode === "dart" ? 0.24 : mode === "inspect" ? 0.5 : 0.17;
        const pitch = THREE.MathUtils.lerp(
          Math.asin(individual.heading.y),
          Math.asin(THREE.MathUtils.clamp(target.y, -pitchLimit, pitchLimit)),
          1 - Math.exp(-dt * 4),
        );
        individual.heading.set(
          Math.cos(nextYaw) * Math.cos(pitch),
          Math.sin(pitch),
          Math.sin(nextYaw) * Math.cos(pitch),
        );
        if (mode === "dart" || mode === "relocate") {
          const aligned = Math.max(0, individual.heading.dot(target));
          desired
            .copy(individual.heading)
            .multiplyScalar(wantedSpeed * (0.08 + 0.92 * aligned * aligned));
        }
      }
      const response =
        mode === "dart" ? 0.15 : mode === "brake" ? 0.27 : 0.72;
      acceleration.subVectors(desired, velocity).multiplyScalar(1 / response);
      acceleration.clampLength(
        0,
        mode === "dart" ? 2.8 : mode === "brake" ? 1.7 : 0.7,
      );
      velocity.addScaledVector(acceleration, dt);
      velocity.multiplyScalar(Math.exp(-dt * 0.08));
      position.addScaledVector(velocity, dt);
      clampToBox(position, BOUNDS);

      const speed = velocity.length();
      // Yaw rate over speed is the curvature of the path; the body conforms to it,
      // up to the C-bend a small fish can make, with the lag of its muscles.
      const yawRate =
        (previousHeading.x * individual.heading.z -
          previousHeading.z * individual.heading.x) /
        Math.max(dt, 0.001);
      const curvature = THREE.MathUtils.clamp(
        yawRate / Math.max(speed, 0.35),
        -1.8,
        1.8,
      );
      individual.bend = THREE.MathUtils.lerp(
        individual.bend,
        curvature,
        1 - Math.exp(-dt * 5),
      );
      const braking =
        mode === "brake" ? 1 : mode === "inspect" ? 0.5 : mode === "hover" ? 0.18 : 0;
      individual.finBrake = THREE.MathUtils.lerp(
        individual.finBrake,
        braking,
        1 - Math.exp(-dt * 6),
      );
      const effort =
        mode === "dart"
          ? 1
          : mode === "brake"
            ? 0.18
            : Math.min(0.65, speed * 1.1 + acceleration.length() * 0.28);
      individual.effort = THREE.MathUtils.lerp(
        individual.effort,
        effort,
        1 - Math.exp(-dt * 4.5),
      );
      const frequency = 0.9 + individual.effort * 7;
      individual.phase = (individual.phase + dt * TAU * frequency) % TAU;
      swim.setXYZW(
        individual.id,
        individual.phase,
        0.5 + individual.effort * 1.7,
        -individual.bend,
        individual.finBrake,
      );

      axisZ.crossVectors(individual.heading, UP).normalize();
      axisY.crossVectors(axisZ, individual.heading).normalize();
      basis.makeBasis(individual.heading, axisY, axisZ);
      targetQuaternion.setFromRotationMatrix(basis);
      bankQuaternion.setFromAxisAngle(FORWARD, -individual.bend * 0.16);
      targetQuaternion.multiply(bankQuaternion);
      individual.quaternion.copy(targetQuaternion);
      scale.setScalar(individual.scale);
      instance.compose(position, individual.quaternion, scale);
      bodies.setMatrixAt(individual.id, instance);
      membranes.setMatrixAt(individual.id, instance);
    }
    bodies.instanceMatrix.needsUpdate = true;
    membranes.instanceMatrix.needsUpdate = true;
    swim.needsUpdate = true;
  }

  update(0, 0, null);
  return {
    update,
    fish,
    getTelemetry() {
      const states = { hover: 0, relocate: 0, dart: 0, brake: 0, inspect: 0 };
      let totalSpeed = 0,
        maximumSpeed = 0;
      for (const individual of fish) {
        states[individual.mode]++;
        const speed = individual.velocity.length();
        totalSpeed += speed;
        maximumSpeed = Math.max(maximumSpeed, speed);
      }
      return {
        count: COUNT,
        states,
        averageSpeed: totalSpeed / COUNT,
        maximumSpeed,
        pointerResponses: startled,
        simulationTime: elapsed,
      };
    },
    dispose() {
      scene.remove(bodies, membranes);
      geometry.body.dispose();
      geometry.fins.dispose();
      skinMaterial.dispose();
      finMaterial.dispose();
      depthMaterial.dispose();
    },
  };
}
