import * as THREE from "three";
import { groundHeight, randomGenerator, smoothstep } from "./math.js";
import { currentVelocity } from "./water.js";
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
// The lit open water in front of the wood, where the shoal spends most of its time.
const OPEN = { minX: -6.4, maxX: 6.4, minY: 2.2, maxY: 6.4, minZ: 0.1, maxZ: 3.0 };
const GROUND_CLEARANCE = 0.55;
const MAX_EXPLORERS = 7;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(1, 0, 0);
const TAU = Math.PI * 2;

// Swimming is thrust against drag, with the mass taken as one so thrust reads as
// acceleration. The viscous term brings a drifting fish to rest; the pressure term caps a
// burst, so a C-start's peak thrust saturates near seven body lengths a second, as measured
// in small fish. Cruise is a relaxed three quarters of a body length a second. Pectoral
// sculling moves a fish slowly in any direction; anything faster comes from the tail and
// only drives along the heading.
const SWIM = {
  linearDrag: 0.6,
  quadraticDrag: 2.5,
  cruise: 0.8,
  scull: 0.35,
  brake: 0.8,
  response: 0.5,
  thrustLimit: { hover: 1.4, settle: 1.4, inspect: 1.8, travel: 3.0, escape: 0 },
};
// A cruising fish turns on about half a body length of radius; a hovering one pivots
// slowly on its fins with a modest sweep of the tail, so the body's curvature is read
// against a floor speed. Pitch stays shallow: tetras climb and dive at a slant.
const TURN = { curvature: 3.5, floorRate: 0.9, hoverRate: 0.5, floorSpeed: 0.5, pitch: 0.35 };
// Neighbours are seen out to three body lengths except in the cone behind, and fast
// movement close by is felt through the lateral line from any side.
const SENSES = { visual: 2.6, blindCosine: -0.6, lateralLine: 0.9 };
// Loose shoaling: about a body length from the nearest neighbour, and a flick away from
// one that comes within half of that; matching the swimming of visible neighbours that
// are on the move; closing up only once the group is left behind. A hovering fish that
// feels this much pull leaves with the others, and a fresh departure nearby recruits it
// at this rate per second.
const SHOAL = {
  spacing: 0.75,
  crowded: 0.55,
  separation: 2.0,
  alignment: 0.5,
  cohesion: 0.3,
  cohesionRange: 1.8,
  follow: 0.28,
  recruitRange: 1.4,
  recruitWindow: 1.2,
  recruitRate: 0.15,
};
// Station keeping: a hovering fish trims toward its station, which slowly becomes wherever
// it has drifted to, and flicks its tail on a Poisson clock, turning a few tens of degrees
// each time and mostly the same way as last time, so it slaloms rather than jitters. Every
// forty seconds or so it leaves for somewhere else.
const HOVER = {
  trim: 0.6,
  trimSpeed: 0.3,
  drift: 10,
  twitchInterval: 3.0,
  excursionInterval: 40,
  flip: 0.3,
  turn: [0.17, 1.3],
  settle: 0.9,
};
// A twitch and a C-start are one movement at two sizes: the body bends into a C toward the
// new heading while the head swings, then the tail sweeps back and drives the fish forward.
// Stage one of a C-start lasts a few frames; stage two and the burst that follows carry a
// startled fish several body lengths before it coasts to a stop and will not fire again.
const TWITCH = { curvature: 2.4, thrust: 7, stage1: 0.07, stage2: 0.09 };
const CSTART = {
  curvature: 4.2,
  thrust: 110,
  stage1: 0.06,
  stage2: 0.1,
  burst: [0.25, 0.45],
  burstThrust: 55,
  refractory: 1.6,
};
// An approaching object is read by how fast it looms: closing speed over distance. A slow
// approach is met by moving the station away to keep a distance; a fast one, in view, fires
// a C-start with a chance per second that climbs with the looming rate. Each startle raises
// the threshold for a while, so a harmless stimulus repeated soon stops working.
const THREAT = {
  range: 3.8,
  looming: 1.0,
  rate: 7,
  flightZone: 2.0,
  giveWay: 0.8,
  familiarity: 0.04,
  habituation: 25,
};
// A startled neighbour startles the fish beside it a few hundredths of a second later, in
// nearly the same direction, which is how alarm crosses a shoal faster than any fish could
// see the threat itself.
const CONTAGION = { range: 2.2, chance: 0.9, latency: [0.04, 0.13], spread: 0.5 };

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

const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const yawOf = (v) => Math.atan2(v.z, v.x);
const dragOf = (speed) =>
  SWIM.linearDrag * speed + SWIM.quadraticDrag * speed * speed;
function setHeading(heading, yaw, pitch) {
  heading.set(
    Math.cos(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.sin(yaw) * Math.cos(pitch),
  );
}
function rotateAboutY(v, angle) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const x = v.x * c - v.z * s;
  v.z = v.x * s + v.z * c;
  v.x = x;
  return v;
}

export function createFishSchool(
  scene,
  { obstacles = [], landmarks = [], thickets = [] } = {},
) {
  const random = randomGenerator(583137);
  const range = (min, max) => min + random() * (max - min);
  const exponential = (mean) => -mean * Math.log(1 - random());
  const geometry = makeAnatomy();
  const swimAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(COUNT * 4),
    4,
  );
  swimAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.body.setAttribute("aSwim", swimAttribute);
  geometry.fins.setAttribute("aSwim", swimAttribute);
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
    for (let i = 0; i < 2; i++)
      interests.push({
        kind: "grass",
        point: new THREE.Vector3(
          range(bed.minX + 0.4, bed.maxX - 0.4),
          range(1.6, Math.min(bed.maxY, 4.8)),
          range(Math.max(bed.minZ, BOUNDS.minZ) + 0.4, bed.maxZ - 0.3),
        ),
        obstacle: -1,
      });

  let elapsed = 0;
  let startled = 0;
  let escapes = 0;
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
    // Most of the shoal already faces into the filter return.
    const heading = new THREE.Vector3(
      random() < 0.72 ? -1 : 1,
      range(-0.045, 0.045),
      range(-0.16, 0.16),
    ).normalize();
    return {
      id,
      position,
      heading,
      swim: heading.clone().multiplyScalar(range(0.02, 0.08)),
      velocity: new THREE.Vector3(),
      anchor: position.clone(),
      goal: position.clone(),
      escapeDirection: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: range(0.83, 1.08),
      phase: range(0, TAU),
      character: range(0.8, 1.2),
      seed: range(0, 100),
      mode: "hover",
      until: Infinity,
      nextTwitch: range(0.5, 4),
      nextExcursion: range(2, 30),
      departed: -Infinity,
      turnSign: random() < 0.5 ? -1 : 1,
      effort: 0.15,
      bend: 0,
      finBrake: 0.25,
      urge: 0,
      // Curiosity builds while a fish holds station and is spent on a visit somewhere.
      curiosity: range(0, 0.7),
      interest: null,
      peck: 0,
      flick: null,
      lastFlick: -Infinity,
      pendingEscape: null,
      alarm: 0,
      refractoryUntil: 0,
    };
  });
  const delta = new THREE.Vector3();
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const acceleration = new THREE.Vector3();
  const lateral = new THREE.Vector3();
  const avoid = new THREE.Vector3();
  const separation = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const alignment = new THREE.Vector3();
  const urge = new THREE.Vector3();
  const water = new THREE.Vector3();
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
  const thicketAt = (p) =>
    thickets.find(
      (bed) =>
        p.x > bed.minX &&
        p.x < bed.maxX &&
        p.z > bed.minZ &&
        p.z < bed.maxZ &&
        p.y < bed.maxY,
    );

  // The current the fish feel: the field the plants and debris ride, slowed near the sand
  // and inside the grass beds, where the foliage takes the flow.
  function waterAt(p, time, out) {
    currentVelocity(p, time, out);
    const height = p.y - groundHeight(p.x, p.z);
    let shelter = 0.3 + 0.7 * smoothstep(0, 1.4, height);
    if (thicketAt(p)) shelter *= 0.35;
    return out.multiplyScalar(shelter);
  }

  function startFlick(f, angle, profile, pitch = Math.asin(f.heading.y)) {
    f.flick = { start: elapsed, yaw0: yawOf(f.heading), angle, pitch, ...profile };
    f.lastFlick = elapsed;
  }
  const twitchProfile = (angle) => ({
    curvature: TWITCH.curvature * Math.min(1, 0.3 + Math.abs(angle) / 1.05),
    thrust: TWITCH.thrust,
    stage1: TWITCH.stage1,
    stage2: TWITCH.stage2,
    burst: 0,
    burstThrust: 0,
  });

  function settle(f) {
    f.mode = "settle";
    f.until = elapsed + HOVER.settle * range(0.8, 1.3);
  }

  function hover(f) {
    f.mode = "hover";
    f.until = Infinity;
    f.urge = 0;
    f.anchor.copy(f.position);
    f.nextTwitch = elapsed + exponential(HOVER.twitchInterval);
    f.nextExcursion = elapsed + exponential(HOVER.excursionInterval / f.character);
  }

  function inspect(f) {
    // Arrived: hang in front of it, nose toward it, and pick at it.
    f.mode = "inspect";
    f.until = elapsed + range(3, 8) * f.character;
    f.peck = elapsed + range(0.4, 1.2);
  }

  function travel(f, goal, recruited = false) {
    f.mode = "travel";
    f.goal.copy(goal);
    // Only a fish leaving of its own accord draws others after it; a follower does not
    // start a chain of followers.
    f.departed = recruited ? -Infinity : elapsed;
    f.until = elapsed + f.position.distanceTo(goal) / (SWIM.cruise * 0.6) + 2;
    // A large change of heading starts with a flick, as a fish turns before it goes.
    delta.subVectors(goal, f.position);
    const angle = wrap(yawOf(delta) - yawOf(f.heading));
    if (!f.flick && Math.abs(angle) > 0.9)
      startFlick(f, angle * range(0.7, 1.0), twitchProfile(angle));
  }

  function visit(f) {
    const interest = interests[Math.floor(random() * interests.length)];
    f.interest = interest;
    f.curiosity = 0;
    travel(f, interest.point);
  }

  // Where a fish goes when it leaves its station: mostly a hop of a few body lengths within
  // the open water, now and then into or behind a grass bed, sometimes anywhere in the tank.
  function destination(f, out) {
    const r = random();
    if (r < 0.74 || (r < 0.82 && !thickets.length)) {
      for (let attempt = 0; attempt < 6; attempt++) {
        out.set(
          range(OPEN.minX, OPEN.maxX),
          range(OPEN.minY, OPEN.maxY),
          range(OPEN.minZ, OPEN.maxZ),
        );
        if (out.distanceToSquared(f.position) < 16) break;
      }
    } else if (r < 0.82) {
      const bed = thickets[Math.floor(random() * thickets.length)];
      out.set(
        range(bed.minX + 0.5, bed.maxX - 0.5),
        range(1.6, Math.min(bed.maxY, 5.2)),
        range(bed.minZ, bed.maxZ + 0.4),
      );
    } else
      out.set(
        range(BOUNDS.minX, BOUNDS.maxX),
        range(1.4, BOUNDS.maxY),
        range(BOUNDS.minZ, BOUNDS.maxZ),
      );
    return out;
  }

  // Leaving station: on a visit if curiosity has built up, after a departing neighbour,
  // along whatever is pulling, or off to a fresh destination.
  function leave(f, leader = null) {
    if (
      interests.length &&
      f.curiosity > 0.55 &&
      random() < f.curiosity * 0.9 &&
      explorers() < MAX_EXPLORERS
    ) {
      visit(f);
      return;
    }
    if (leader)
      target
        .copy(leader.goal)
        .add(
          new THREE.Vector3(range(-0.9, 0.9), range(-0.3, 0.3), range(-0.6, 0.6)),
        );
    else if (urge.lengthSq() > SHOAL.follow * SHOAL.follow)
      target
        .copy(f.position)
        .addScaledVector(urge, range(2, 3.5) / urge.length());
    else destination(f, target);
    clampToBox(target, BOUNDS, 0.45);
    travel(f, target, Boolean(leader));
  }

  // A tail flick from station: away from a neighbour that has come too close, toward
  // upstream when the fish has swung off the flow, back toward the station when it has
  // drifted off it, otherwise a chained wandering turn.
  function twitch(f, away = null) {
    f.nextTwitch = elapsed + exponential(HOVER.twitchInterval);
    const yaw = yawOf(f.heading);
    let angle;
    if (away) angle = wrap(yawOf(away) - yaw) * range(0.5, 0.9);
    else if (water.lengthSq() > 0.0025 && f.heading.dot(water) > -0.5 * water.length())
      angle = wrap(yawOf(water) + Math.PI - yaw) * range(0.6, 1.0);
    else if (f.anchor.distanceToSquared(f.position) > 0.36) {
      delta.subVectors(f.anchor, f.position);
      angle = wrap(yawOf(delta) - yaw) * range(0.6, 1.0);
    } else {
      if (random() < HOVER.flip) f.turnSign = -f.turnSign;
      angle = f.turnSign * range(HOVER.turn[0], HOVER.turn[1]);
    }
    startFlick(f, angle, twitchProfile(angle));
  }

  // Away from the threat, nearly level, scattered to one side or the other as real escapes
  // are, and turned along the glass when the way out is a wall.
  function escapeDirection(f, from, out) {
    out.subVectors(f.position, from);
    out.y *= 0.3;
    if (out.lengthSq() < 1e-4) out.copy(f.heading).negate();
    rotateAboutY(out.normalize(), range(-0.7, 0.7));
    for (const [axis, minimum, maximum] of [
      ["x", BOUNDS.minX, BOUNDS.maxX],
      ["z", BOUNDS.minZ, BOUNDS.maxZ],
    ]) {
      const ahead = f.position[axis] + out[axis] * 2.2;
      if (ahead < minimum + 0.5 || ahead > maximum - 0.5) out[axis] *= -0.25;
    }
    return out.normalize();
  }

  function startEscape(f, direction) {
    const angle = wrap(yawOf(direction) - yawOf(f.heading));
    f.escapeDirection.copy(direction);
    f.interest = null;
    f.mode = "escape";
    f.alarm += 1;
    f.refractoryUntil = elapsed + CSTART.refractory;
    const burst = range(CSTART.burst[0], CSTART.burst[1]);
    startFlick(
      f,
      angle,
      {
        curvature: CSTART.curvature * Math.min(1, 0.45 + Math.abs(angle) / 2),
        thrust: CSTART.thrust,
        stage1: CSTART.stage1,
        stage2: CSTART.stage2,
        burst,
        burstThrust: CSTART.burstThrust,
      },
      Math.asin(THREE.MathUtils.clamp(direction.y, -0.4, 0.4)),
    );
    f.until = elapsed + CSTART.stage1 + CSTART.stage2 + burst;
    escapes++;
    for (const other of fish) {
      if (
        other === f ||
        other.mode === "escape" ||
        other.pendingEscape ||
        elapsed < other.refractoryUntil
      )
        continue;
      delta.subVectors(f.position, other.position);
      const d = delta.length();
      if (d > CONTAGION.range || d < 1e-3) continue;
      if (other.heading.dot(delta) < SENSES.blindCosine * d && d > SENSES.lateralLine)
        continue;
      if (random() > CONTAGION.chance * (1 - (0.6 * d) / CONTAGION.range)) continue;
      target
        .copy(direction)
        .addScaledVector(delta, -CONTAGION.spread / d)
        .normalize();
      rotateAboutY(target, range(-0.4, 0.4));
      other.pendingEscape = {
        at: elapsed + range(CONTAGION.latency[0], CONTAGION.latency[1]),
        direction: target.clone(),
      };
    }
  }

  function threat(f, pointer, dt) {
    target.subVectors(pointer.position, f.position);
    const d = target.length();
    if (d > THREAT.range || d < 1e-3) return;
    target.multiplyScalar(1 / d);
    const seen = f.heading.dot(target) > SENSES.blindCosine;
    // Closing speed over distance: the rate the object grows in the fish's eye.
    const looming = -pointer.velocity.dot(target) / Math.max(d, 0.4);
    const threshold = THREAT.looming * (1 + f.alarm);
    if (
      seen &&
      looming > threshold &&
      f.mode !== "escape" &&
      !f.pendingEscape &&
      elapsed >= f.refractoryUntil &&
      random() < 1 - Math.exp(-dt * THREAT.rate * (looming / threshold - 1))
    ) {
      startEscape(f, escapeDirection(f, pointer.position, delta));
      startled++;
      return;
    }
    // Something merely close is given room, less and less as it becomes familiar.
    const zone = THREAT.flightZone / (1 + f.alarm);
    if (d < zone) {
      f.alarm += dt * THREAT.familiarity;
      target.y *= 0.4;
      urge.addScaledVector(target, (-(zone - d) / zone) * SWIM.cruise * 0.9);
      if (f.mode === "hover") {
        f.anchor.addScaledVector(target, -(zone - d) * THREAT.giveWay * dt);
        clampToBox(f.anchor, BOUNDS, 0.5);
      }
    }
  }

  function decide(f) {
    if (f.mode === "escape") settle(f);
    else if (f.mode === "travel") f.interest ? inspect(f) : settle(f);
    else if (f.mode === "settle") hover(f);
    else if (f.mode === "inspect") {
      f.interest = null;
      leave(f);
    }
  }

  function update(dt, time, pointer) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    elapsed += dt;
    for (const f of fish) {
      const { position, swim, heading } = f;
      waterAt(position, time, water);
      const bed = thicketAt(position);
      if (f.pendingEscape && elapsed >= f.pendingEscape.at) {
        const { direction } = f.pendingEscape;
        f.pendingEscape = null;
        startEscape(f, direction);
      }
      f.alarm *= Math.exp(-dt / THREAT.habituation);

      separation.set(0, 0, 0);
      alignment.set(0, 0, 0);
      centroid.set(0, 0, 0);
      let seen = 0;
      let crowded = false;
      let leader = null;
      let leaderDistance = Infinity;
      for (const other of fish) {
        if (other === f) continue;
        delta.subVectors(other.position, position);
        const distanceSquared = delta.lengthSq();
        if (distanceSquared > SENSES.visual * SENSES.visual) continue;
        const d = Math.sqrt(distanceSquared);
        if (heading.dot(delta) < SENSES.blindCosine * d && d > SENSES.lateralLine)
          continue;
        seen++;
        centroid.add(other.position);
        if (other.mode === "travel" || other.mode === "escape")
          alignment.add(other.swim).sub(swim);
        if (d < SHOAL.spacing) {
          separation.addScaledVector(
            delta,
            -(SHOAL.spacing - d) / (SHOAL.spacing * Math.max(d, 0.05)),
          );
          if (d < SHOAL.crowded) crowded = true;
        }
        if (
          other.mode === "travel" &&
          !other.interest &&
          d < SHOAL.recruitRange &&
          d < leaderDistance
        ) {
          leader = other;
          leaderDistance = d;
        }
      }
      // What pulls the fish somewhere else: neighbours moving off, the group left behind,
      // something come too close.
      urge.set(0, 0, 0);
      if (seen) {
        urge.addScaledVector(alignment, SHOAL.alignment / seen);
        centroid.multiplyScalar(1 / seen).sub(position);
        const away = centroid.length();
        if (away > SHOAL.cohesionRange)
          urge.addScaledVector(
            centroid,
            (SHOAL.cohesion * Math.min(1, away - SHOAL.cohesionRange)) / away,
          );
      }
      if (pointer) threat(f, pointer, dt);

      if (elapsed >= f.until) decide(f);
      if (f.mode !== "inspect")
        f.curiosity = Math.min(1, f.curiosity + dt * 0.012 * f.character);
      const mayFlick = !f.flick && elapsed > f.lastFlick + 0.6;
      if (f.mode === "hover" && !f.flick) {
        f.urge = THREE.MathUtils.lerp(f.urge, urge.length(), 1 - Math.exp(-dt / 0.5));
        const recruited =
          leader &&
          elapsed - leader.departed < SHOAL.recruitWindow &&
          random() < dt * SHOAL.recruitRate;
        if (elapsed >= f.nextExcursion) leave(f);
        else if (f.urge > SHOAL.follow || recruited) leave(f, leader);
        else if (crowded && mayFlick) twitch(f, separation);
        else if (elapsed >= f.nextTwitch) twitch(f);
      } else if (crowded && mayFlick && (f.mode === "travel" || f.mode === "inspect"))
        twitch(f, separation);

      // Rocks, wood, glass and sand push back before contact.
      avoid.set(0, 0, 0);
      obstacles.forEach((obstacle, index) => {
        delta.subVectors(position, obstacle.center);
        const distance = delta.length();
        const surface = distance - obstacle.radius - f.scale * 0.23;
        // A fish may come close to the thing it is looking at.
        const buffer =
          f.interest && f.interest.obstacle === index ? 0.12 : 0.7;
        if (surface < buffer && distance > 0.001)
          avoid.addScaledVector(delta, ((buffer - surface) * 1.25) / distance);
      });
      const wallDistance = 0.6;
      for (const [axis, minimum, maximum] of [
        ["x", BOUNDS.minX, BOUNDS.maxX],
        ["y", BOUNDS.minY, BOUNDS.maxY],
        ["z", BOUNDS.minZ, BOUNDS.maxZ],
      ]) {
        if (position[axis] < minimum + wallDistance)
          avoid[axis] += (minimum + wallDistance - position[axis]) * 0.45;
        if (position[axis] > maximum - wallDistance)
          avoid[axis] -= (position[axis] - maximum + wallDistance) * 0.45;
      }
      const floor = groundHeight(position.x, position.z) + GROUND_CLEARANCE;
      if (position.y < floor + wallDistance)
        avoid.y += (floor + wallDistance - position.y) * 0.6;

      // The ground velocity each mode asks for, then what the fish itself must swim once
      // the water's own motion is taken off.
      const { mode } = f;
      if (mode === "hover") {
        f.anchor.lerp(position, 1 - Math.exp(-dt / HOVER.drift));
        desired
          .subVectors(f.anchor, position)
          .multiplyScalar(HOVER.trim)
          .clampLength(0, HOVER.trimSpeed);
      } else if (mode === "inspect") {
        // Hold just off the object, drifting slightly, with short pecks toward it.
        delta.subVectors(f.interest.point, position);
        const standoff = f.interest.kind === "grass" ? 0.1 : 0.32;
        desired
          .copy(delta)
          .setLength(Math.max(0, delta.length() - standoff))
          .multiplyScalar(0.5)
          .clampLength(0, 0.1);
        desired.x += Math.sin(elapsed * 0.9 + f.seed) * 0.02;
        desired.y += Math.sin(elapsed * 1.3 + f.seed * 2.0) * 0.015;
        if (elapsed > f.peck) {
          f.peck = elapsed + range(0.6, 1.8);
          swim.addScaledVector(delta.normalize(), range(0.08, 0.16));
        }
      } else if (mode === "travel") {
        desired.subVectors(f.goal, position);
        const remaining = desired.length();
        if (remaining < (f.interest ? 0.45 : 0.35)) {
          f.interest ? inspect(f) : settle(f);
          desired.set(0, 0, 0);
        } else {
          // Slower through the grass, and easing off on the approach.
          const speed =
            SWIM.cruise * (bed ? 0.6 : 1) * Math.min(1, 0.25 + remaining / 0.9);
          desired.multiplyScalar(speed / remaining);
        }
      } else desired.set(0, 0, 0);
      desired.add(avoid).sub(water);
      desired.addScaledVector(separation, SHOAL.separation);
      if (f.mode === "travel") desired.add(urge);
      else if (f.mode === "hover") desired.addScaledVector(urge, 0.5);

      // A flick in progress: the head swings while the body takes the C, then the tail
      // drives. The burst that follows a C-start still steers around the hardscape.
      const { flick } = f;
      let along = 0;
      let bendTarget = null;
      let flickWave = 1;
      let bending = false;
      if (flick) {
        const t = elapsed - flick.start;
        const c = Math.sign(flick.angle || 1) * flick.curvature;
        if (t < flick.stage1) {
          const k = t / flick.stage1;
          setHeading(heading, flick.yaw0 + flick.angle * k * k * (3 - 2 * k), flick.pitch);
          bendTarget = c * Math.sin(k * Math.PI * 0.5);
          flickWave = 0.3;
          bending = true;
        } else if (t < flick.stage1 + flick.stage2) {
          const k = (t - flick.stage1) / flick.stage2;
          setHeading(heading, flick.yaw0 + flick.angle, flick.pitch);
          bendTarget = c * (1 - 1.5 * k);
          along = flick.thrust * Math.sin(k * Math.PI);
          flickWave = 0.3;
          bending = true;
        } else if (t < flick.stage1 + flick.stage2 + flick.burst) {
          const k = (t - flick.stage1 - flick.stage2) / flick.burst;
          along = flick.burstThrust * (1 - k);
        } else f.flick = null;
      }

      previousHeading.copy(heading);
      const wanted = desired.length();
      if (!bending) {
        let steer = false;
        if (f.mode === "inspect") {
          target.subVectors(f.interest.point, position).normalize();
          steer = true;
        } else if (f.mode === "settle") {
          target.copy(heading).setY(0).normalize();
          steer = true;
        } else if (f.mode === "escape") {
          target.copy(heading).addScaledVector(avoid, 2).normalize();
          steer = avoid.lengthSq() > 1e-6;
        } else if (wanted > 0.08) {
          target.copy(desired).multiplyScalar(1 / wanted);
          steer = true;
        }
        if (steer) {
          const yaw = yawOf(heading);
          const rate =
            f.mode === "hover"
              ? TURN.hoverRate
              : f.mode === "escape"
                ? 5
                : Math.max(TURN.floorRate, TURN.curvature * swim.length());
          const nextYaw =
            yaw + THREE.MathUtils.clamp(wrap(yawOf(target) - yaw), -rate * dt, rate * dt);
          const pitch = THREE.MathUtils.lerp(
            Math.asin(heading.y),
            Math.asin(THREE.MathUtils.clamp(target.y, -TURN.pitch, TURN.pitch)),
            1 - Math.exp(-dt * 4),
          );
          setHeading(heading, nextYaw, pitch);
        }
      }

      // Thrust reaches the wanted swimming velocity and pays its drag, with the tail along
      // the heading and the pectorals for the little that is across it.
      let propulsion = along;
      if (flick) acceleration.copy(heading).multiplyScalar(along);
      else {
        acceleration.subVectors(desired, swim).multiplyScalar(1 / SWIM.response);
        if (wanted > 1e-4)
          acceleration.addScaledVector(desired, dragOf(wanted) / wanted);
        const forward = acceleration.dot(heading);
        lateral.copy(acceleration).addScaledVector(heading, -forward);
        lateral.clampLength(0, SWIM.scull);
        const tail = THREE.MathUtils.clamp(forward, -SWIM.brake, SWIM.thrustLimit[f.mode]);
        acceleration.copy(lateral).addScaledVector(heading, tail);
        propulsion = Math.max(0, tail) + 0.5 * lateral.length();
      }
      swim.addScaledVector(acceleration, dt);
      const speed = swim.length();
      swim.multiplyScalar(
        1 / (1 + dt * (SWIM.linearDrag + SWIM.quadraticDrag * speed)),
      );
      f.velocity.copy(swim).add(water);
      position.addScaledVector(f.velocity, dt);
      clampToBox(position, BOUNDS);

      // Yaw rate over speed is the curvature of the path; the body conforms to it, up to
      // the C-bend a small fish can make, with the lag of its muscles. A flick prescribes
      // the bend directly.
      if (bendTarget === null) {
        const yawRate =
          (previousHeading.x * heading.z - previousHeading.z * heading.x) /
          Math.max(dt, 0.001);
        const curvature = THREE.MathUtils.clamp(
          yawRate / Math.max(speed, TURN.floorSpeed),
          -TURN.curvature,
          TURN.curvature,
        );
        f.bend = THREE.MathUtils.lerp(f.bend, curvature, 1 - Math.exp(-dt * 6));
      } else f.bend = THREE.MathUtils.lerp(f.bend, bendTarget, 1 - Math.exp(-dt * 45));
      // Tail beat follows thrust, not speed: a fish carried by the current or coasting
      // after a burst does not thrash.
      const effort = Math.min(1, Math.sqrt(propulsion * 0.17));
      f.effort = THREE.MathUtils.lerp(
        f.effort,
        effort,
        1 - Math.exp(-dt * (effort > f.effort ? 14 : 4)),
      );
      const braking =
        f.mode === "settle"
          ? 1
          : f.mode === "inspect"
            ? 0.5
            : f.mode === "hover" && !flick
              ? 0.25
              : 0;
      f.finBrake = THREE.MathUtils.lerp(f.finBrake, braking, 1 - Math.exp(-dt * 6));
      const frequency = 1.2 + f.effort * 9;
      f.phase = (f.phase + dt * TAU * frequency) % TAU;
      swimAttribute.setXYZW(
        f.id,
        f.phase,
        (0.3 + f.effort * 2.2) * flickWave,
        -f.bend,
        f.finBrake,
      );

      axisZ.crossVectors(heading, UP).normalize();
      axisY.crossVectors(axisZ, heading).normalize();
      basis.makeBasis(heading, axisY, axisZ);
      targetQuaternion.setFromRotationMatrix(basis);
      bankQuaternion.setFromAxisAngle(
        FORWARD,
        -THREE.MathUtils.clamp(f.bend, -1.8, 1.8) * 0.16,
      );
      targetQuaternion.multiply(bankQuaternion);
      f.quaternion.copy(targetQuaternion);
      scale.setScalar(f.scale);
      instance.compose(position, f.quaternion, scale);
      bodies.setMatrixAt(f.id, instance);
      membranes.setMatrixAt(f.id, instance);
    }
    bodies.instanceMatrix.needsUpdate = true;
    membranes.instanceMatrix.needsUpdate = true;
    swimAttribute.needsUpdate = true;
  }

  update(0, 0, null);
  return {
    update,
    fish,
    getTelemetry() {
      const states = { hover: 0, travel: 0, settle: 0, inspect: 0, escape: 0 };
      let twitching = 0,
        totalSpeed = 0,
        maximumSpeed = 0;
      for (const f of fish) {
        states[f.mode]++;
        if (f.flick && f.mode !== "escape") twitching++;
        const speed = f.velocity.length();
        totalSpeed += speed;
        maximumSpeed = Math.max(maximumSpeed, speed);
      }
      return {
        count: COUNT,
        states,
        twitching,
        averageSpeed: totalSpeed / COUNT,
        maximumSpeed,
        pointerResponses: startled,
        escapes,
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
