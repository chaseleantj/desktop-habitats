import * as THREE from "three";
import { groundHeight, randomGenerator, smoothstep } from "./math.js";
import { flowDirectionAt, shelteredVelocity, thicketAt } from "./water.js";
import {
  applySkin,
  createFishMaterials,
  makeAnatomy,
  SNOUT_X,
  STANDARD_LENGTH,
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
// Open-water routes include the space above and alongside the planting.
const OPEN = { minX: -7.5, maxX: 7.5, minY: 1.8, maxY: 7.4, minZ: -1.4, maxZ: 2.8 };
const GROUND_CLEARANCE = 0.55;
const MAX_EXPLORERS = 7;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(1, 0, 0);
const TAU = Math.PI * 2;

// Acceleration is relative to the water. Low axial drag preserves momentum between
// strokes; stronger cross-flow drag keeps the body following its swimming direction.
const SWIM = {
  linearDrag: 0.38,
  quadraticDrag: 0.85,
  lateralDrag: 3.2,
  cruise: 1.2,
  scull: 0.35,
  avoidanceScull: 0.9,
  brake: 0.8,
  feedBrake: 2.2,
  response: 0.5,
  thrustLimit: {
    hover: 1.2,
    settle: 0,
    inspect: 1.2,
    travel: 6.0,
    feed: 9.0,
    escape: 0,
  },
};
// Tetras alternate a few propulsive strokes with a straight-bodied coast. The same
// envelope drives both thrust and body motion. Timing is tuned for this calm tank;
// the behavioural reference is Li et al. 2021, doi:10.1038/s42003-020-01521-z.
const GAIT = {
  frequency: 3.2,
  coast: [0.32, 0.65],
  // A fish swimming hard at food does not beat faster, it stops gliding: the cycle
  // period is held nearly constant and speed is set by the burst-to-coast ratio.
  feedCoast: [0.05, 0.2],
  restartSpeed: 0.86,
  minimumThrust: 0.2,
  strokeGain: 2.6,
  waveAngle: 0.78,
};
// Turn rate eases into a curve; the curvature floor prevents a resting fish folding
// in half when it reorients on its fins. Climbs and dives stay shallow, except on food:
// a pellet falls vertically, and a fish held to a shallow climb cannot follow one down.
// It orbits underneath instead, which is the posture a viewer reads as broken.
const TURN = {
  curvature: 2.4,
  floorRate: 0.65,
  maximumRate: 1.8,
  speedRate: 0.8,
  steeringGain: 2.2,
  hoverRate: 0.45,
  floorSpeed: 0.65,
  pitch: 0.45,
  feedRate: 2.6,
  feedPitch: 1.05,
  response: 4,
};
// Neighbours are seen out to three body lengths except in the cone behind, and fast
// movement close by is felt through the lateral line from any side.
const SENSES = { visual: 2.6, blindCosine: -0.6, lateralLine: 0.9 };
// Loose shoaling: about a body length from the nearest neighbour, and a flick away from
// one that comes within half of that; matching the swimming of visible neighbours that
// are on the move; closing up only once the group is left behind. A hovering fish that
// feels this much pull leaves with the others, and a fresh departure nearby recruits it
// at this rate per second.
const SHOAL = {
  spacing: 1.05,
  crowded: 0.55,
  separation: 2.0,
  alignment: 0.5,
  cohesion: 0.3,
  cohesionRange: 1.8,
  follow: 0.28,
  recruitRange: 1.4,
  recruitWindow: 1.2,
  recruitRate: 0.15,
  lookAhead: 1.1,
};
// Station keeping is a brief pause between excursions, with occasional fin-assisted turns.
const HOVER = {
  trim: 0.6,
  trimSpeed: 0.3,
  drift: 10,
  twitchInterval: 7.0,
  excursionInterval: 4.5,
  flip: 0.3,
  turn: [0.17, 0.65],
  settle: 1.2,
};
// A twitch and a C-start are one movement at two sizes: the body bends into a C toward the
// new heading while the head swings, then the tail sweeps back and drives the fish forward.
// Stage one of a C-start lasts a few frames; stage two and the burst that follows carry a
// startled fish several body lengths before it coasts to a stop and will not fire again.
const TWITCH = { curvature: 1.5, thrust: 4, stage1: 0.18, stage2: 0.24 };
const CSTART = {
  curvature: 4.2,
  thrust: 85,
  stage1: 0.06,
  stage2: 0.1,
  burst: [0.25, 0.45],
  burstThrust: 30,
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

// Everything a fish does about food is measured against its own body rather than the
// tank, because that is what the eye compares it to: a strike is a fifth of a body
// length, not a number of centimetres. A bloodfin is a 40 mm adult drawn STANDARD_LENGTH
// units long, so a body length is that many units before the fish's individual scale.
//
// Three senses find the food, with three ranges and three latencies, and the stagger
// between them is what makes an arrival read as animals rather than as a particle system.
// The lateral line feels the pellets hit the film from most of the tank away and answers
// first: the behavioural reaction of a surface-feeding fish to a wave is 128 ms at large
// amplitude and 242 ms at threshold (Bleckmann 1980, doi:10.1007/BF00606308). What it
// gives is coarse -- these characins have none of the cephalic neuromast array of the
// surface specialists that was measured on, so the splash is a direction to look in and
// nothing more, and how wrong that direction is has never been measured. Sight gives a
// particular pellet: a planktivore of this size reacts to 1 to 3 mm prey from 13 to 19 cm
// away in clear water (Utne 1997, doi:10.1111/j.1095-8649.1997.tb01619.x), and FEED.sight
// is 16 cm of that band. It is a chance per second that climbs as a pellet nears, never a
// radius every fish crosses on the same frame. Smell is last and worst: the plume only
// goes where the water goes, so a fish downstream meets it ten or twenty seconds late
// with nothing to aim at, and searches by nosing upstream into the flow, which is how
// fish actually use odour (Gardiner & Atema 2007, doi:10.1242/jeb.000075).
const FEED = {
  sight: 2.6,
  near: 0.8,
  rate: 4.0,
  splash: 4.6,
  splashLatency: [0.13, 0.24],
  splashError: 0.61,
  splashChance: 0.7,
  rise: [4.8, 3.6],
  scan: [0.3, 0.5],
  plumeWidth: 1.6,
  plumeLife: 50,
  sniff: 9,
  splashDrive: 0.4,
  sightDrive: 0.6,
  odourDrive: 0.5,
  recruitDrive: 0.5,
  eatDrive: 0.3,
};
// Hunger has two clocks. The fast one is the scramble: while it is up the fish stops
// shoaling, swims faster and chases. The slow one only keeps it looking -- lower
// excursions, upstream casts, a willingness to take a pellet it happens to pass -- and it
// outlasts the fast one by minutes. Keeping both is what stops the tank reading as a
// switch being flipped. Real appetitive hunting stays strongly elevated for a quarter of
// an hour and is back to baseline by about thirty minutes (Wee et al. 2019,
// doi:10.7554/eLife.43775); that envelope would make feeding the tank's default rather
// than an event, so the intense phase is compressed hard and the tail is kept long. The
// compression is deliberate and is the one number here knowingly taken away from the
// measurement. Satiation itself never ends a feeding bout -- a hungry tetra could eat
// thirty of these pellets -- so appetite is here only to keep repeated clicking from
// producing a permanent frenzy, and it never falls to nothing.
const APPETITE = {
  keen: 25,
  residual: 200,
  searching: 0.25,
  cost: 0.1,
  floor: 0.15,
  recovery: 0.02,
};
// A fish that has found food is a far louder signal than a 1 mm pellet: it accelerates,
// straightens, turns sharply and lunges, which is exactly what the shoaling sense is
// already tuned to. So news of food crosses the shoal faster than any fish could find it,
// and grouped fish feed sooner than lone ones -- measured in neon tetra across groups of
// one to ten (Saxby et al. 2010, doi:10.1016/j.applanim.2010.04.008). This is the alarm
// contagion again, at a longer range, an order of magnitude slower, and graded rather
// than all-or-nothing, because it is appetite and not reflex. A recruit aims at the fish
// that is feeding, never at a pellet it cannot possibly see, and only finds the food with
// its own eyes once it gets there; that is the difference between a shoal gathering and a
// swarm of missiles.
const FOOD_CONTAGION = {
  range: 2.5,
  chance: 0.55,
  latency: [0.25, 1.1],
  spread: 0.6,
};
// The approach is two phases, and getting it wrong is what makes feeding look fake.
// Zebrafish chase evasive prey at 13 cm/s, nearly four body lengths a second (Nair et al.
// 2017, doi:10.1098/rspb.2017.0359), but carp and tilapia approach a stationary item at
// 3.3 to 3.9 cm/s, about one (Provini et al. 2022, doi:10.7554/eLife.73621). A pellet is
// stationary. So the fish rushes to the neighbourhood, brakes hard on its pectorals, and
// closes the last body length slowly and deliberately -- and the slow part is not
// timidity. A 1 mm pellet has no inertia worth the name and is pushed by the water the
// fish itself is shoving ahead of it, a field that is self-similar in approach speed and
// gone by about a body length ahead (Stewart et al. 2014, doi:10.1242/jeb.111773), so a
// fish that comes in fast blows its own dinner away and a fish that stalks does not. How
// many millimetres of shove that is worth has never been published; FORAGE.bowWave is
// tuned by eye until a full-speed pass usually loses the pellet. Pursuit is proportional
// and lagging, never a lead: the fish aims where it saw the pellet a fraction of a second
// ago and corrects continuously, which is what puts the curve into an approach from below.
const FORAGE = {
  transit: 2.2,
  stalk: 0.62,
  brakeRange: 1.2,
  stalkRange: 0.55,
  ease: 4,
  standoff: 0.75,
  lag: 0.16,
  bowWave: 0.55,
  bowReach: 1.0,
  pursuit: 6,
  hurry: 0.3,
};
// Suction has almost no reach. The flow a suction feeder generates is confined to about
// one gape ahead of its mouth and is under 5% of the mouth speed at that distance (Day et
// al. 2005, doi:10.1242/jeb.01708; Yaniv, Elad & Holzman 2014, doi:10.1242/jeb.104331),
// which for a 3 mm gape is a tenth of a body length. The fish cannot draw a pellet in
// from a distance: it must lunge until its jaws nearly touch, and that constraint is what
// produces the short sharp stab a viewer reads as eating. The distances come from adult
// zebrafish of 3.4 cm, this fish's size class exactly: strikes launched from a median
// 6.9 mm with a spread of 4.4 to 10.7 mm, and no capture ever succeeding from beyond
// 10.4 mm (Nair et al. 2017). A real strike lasts 42 ms, which is two and a half frames
// and invisible, so it is rendered over about 110 ms instead -- a declared concession, and
// the only place here where legibility is put above the measurement. Misses are not
// rolled for. They come out of the geometry: a hurried fish's aim is worse, its bow wave
// has moved the pellet, it over-lunges or falls short, or a neighbour's jaws get there
// first. Mouthing and spitting an item out is not a glitch either -- adult zebrafish spit
// pellets routinely, even edible ones, and orient the spit away from their neighbours
// (Sekulovski et al. 2025, doi:10.3758/s13420-025-00691-2).
const STRIKE = {
  launch: [0.13, 0.31],
  suction: 0.1,
  aim: 0.26,
  curvature: 2.6,
  thrust: 62,
  stage1: 0.045,
  stage2: 0.062,
  follow: 0.055,
  attempts: 3,
  retry: 0.78,
  spit: 0.25,
  spitShove: 0.1,
  wash: 0.2,
  puff: 0.32,
  handling: [0.4, 0.9],
};

// Integrate the spine's tangent, preserving body length. A travelling angular wave
// builds along the trunk and peduncle; the head counter-moves only slightly.
const SWIM_GLSL = /* glsl */ `
  // Part ids come from fish-anatomy.js: 4 and 5 are the pectorals, 1-3, 6 and 12 the other fins.
  attribute vec4 aSwim; // x: wave phase, y: wave angle, z: turning curvature, w: pectoral brake
  attribute float aFinPhase;
  attribute float aPart;
  attribute float aFinProgress;
  varying vec3 vSkinPoint;
  varying vec2 vFishUV;
  varying float vFishPart;
  const float PIVOT = 0.12;
  vec3 gSwimPosition;
  float spineAngle(float s) {
    float along = clamp(s / 0.57, 0.0, 1.0);
    return aSwim.z * s * (s < 0.0 ? 0.18 : 1.0)
      - 0.025 * aSwim.y * sin(aSwim.x)
      + aSwim.y * pow(along, 1.35) * sin(aSwim.x - s * 7.5);
  }
  vec3 finMotion(vec3 p) {
    if (aPart > 3.5 && aPart < 5.5) {
      float side = aPart < 4.5 ? 1.0 : -1.0;
      float beat = sin(aFinPhase + side * 0.9);
      p.z += side * aFinProgress * (0.013 * beat + 0.018 * aSwim.w);
      p.x += aFinProgress * (0.008 * beat - 0.033 * aSwim.w);
      p.y += aFinProgress * 0.008 * cos(aFinPhase + side * 0.9);
    } else if (aPart > 0.5 && aPart < 1.5) {
      // The trailing membrane lags behind the peduncle instead of acting as a paddle.
      p.z += aSwim.y * 0.045 * aFinProgress * aFinProgress
        * sin(aSwim.x - (PIVOT - p.x) * 7.5 - 0.65);
    } else if ((aPart > 1.5 && aPart < 6.5) || aPart > 11.5) {
      p.z += sin(aFinPhase - p.x * 10.0) * aFinProgress * 0.004;
    }
    return p;
  }
  vec3 bendSpine(vec3 p, inout vec3 n) {
    float s = PIVOT - p.x;
    float theta = spineAngle(s);
    vec2 spine = vec2(PIVOT, 0.0);
    float kappa = (spineAngle(s + 0.001) - spineAngle(s - 0.001)) / 0.002;
    if (s < 0.0) {
      float mid = spineAngle(s * 0.5);
      spine += vec2(-cos(mid), sin(mid)) * s;
    } else {
      float ds = s / 8.0;
      for (int i = 0; i < 8; i++) {
        float mid = spineAngle((float(i) + 0.5) * ds);
        spine += vec2(-cos(mid), sin(mid)) * ds;
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
    `riverscape-fish-${withColor ? "skin" : "depth"}-4`;
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
  { obstacles = [], landmarks = [], thickets = [], food = null } = {},
) {
  const random = randomGenerator(583137);
  const range = (min, max) => min + random() * (max - min);
  const exponential = (mean) => -mean * Math.log(1 - random());
  const geometry = makeAnatomy();
  const swimAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(COUNT * 4),
    4,
  );
  const finPhaseAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(COUNT), 1,
  );
  swimAttribute.setUsage(THREE.DynamicDrawUsage);
  finPhaseAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.body.setAttribute("aSwim", swimAttribute);
  geometry.fins.setAttribute("aSwim", swimAttribute);
  geometry.body.setAttribute("aFinPhase", finPhaseAttribute);
  geometry.fins.setAttribute("aFinPhase", finPhaseAttribute);
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
  // The scene clock the water model runs on, kept so behaviours that need to know which
  // way the current is going can sample the same field the swimming code does.
  let waterClock = 0;
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
      quaternion: new THREE.Quaternion(),
      scale: range(0.83, 1.08),
      phase: range(0, TAU),
      character: range(0.8, 1.2),
      seed: range(0, 100),
      mode: "hover",
      until: Infinity,
      nextTwitch: range(0.5, 4),
      nextExcursion: range(0.5, 5),
      departed: -Infinity,
      turnSign: random() < 0.5 ? -1 : 1,
      effort: 0,
      stroke: null,
      nextStroke: range(0, 0.5),
      finPhase: range(0, TAU),
      yawRate: 0,
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
      // Feeding. `keen` and `searching` are the two clocks of APPETITE and `foraging` is
      // whichever of them is higher; `food` is the pellet this fish is going for, held
      // with the serial it was found under so a dead pellet can never be chased.
      keen: 0,
      searching: 0,
      foraging: 0,
      appetite: 1,
      food: null,
      foodSerial: -1,
      strikeUntil: 0,
      launch: 0,
      attempts: 0,
      handling: 0,
      nextScan: 0,
      nextSniff: 0,
      splashAt: 0,
      splashSlot: 0,
      recruiter: null,
      recruitAt: 0,
    };
  });
  const delta = new THREE.Vector3();
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const acceleration = new THREE.Vector3();
  const lateral = new THREE.Vector3();
  const avoid = new THREE.Vector3();
  const separation = new THREE.Vector3();
  const relativeVelocity = new THREE.Vector3();
  const closestApproach = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const alignment = new THREE.Vector3();
  const urge = new THREE.Vector3();
  const water = new THREE.Vector3();
  const flight = new THREE.Vector3();
  const previousHeading = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const targetQuaternion = new THREE.Quaternion();
  const bankQuaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const mouth = new THREE.Vector3();
  const morsel = new THREE.Vector3();
  const bite = new THREE.Vector3();
  const wash = new THREE.Vector3();
  const scan = new THREE.Vector3();
  // Which way the water is running right now. The sweep reverses the flow, so anything
  // that wants to point upstream has to ask rather than assume. Kept apart from `water`,
  // which holds a velocity the swimming code subtracts off.
  const downstream = new THREE.Vector3();

  // Where the last few pinches of food hit the film, and how fast the water was moving
  // there. Every fish that felt one points at the same record rather than carrying its
  // own copy of it, and the odour plume is tracked from the same place: it is the drop
  // point, drifting downstream at the speed of the water that carried it away.
  const splashes = Array.from({ length: 4 }, () => ({
    point: new THREE.Vector3(),
    at: -Infinity,
    speed: 0,
  }));
  let splashSlot = 0;
  let newestPellet = -1;
  let strikes = 0;
  let bites = 0;

  const explorers = () =>
    fish.filter((f) => f.interest || f.mode === "inspect").length;

  function startFlick(f, angle, profile, pitch = Math.asin(f.heading.y)) {
    f.stroke = null;
    f.yawRate = 0;
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
    f.stroke = null;
    f.until = elapsed + HOVER.settle * range(0.8, 1.3);
  }

  function hover(f) {
    f.mode = "hover";
    f.until = Infinity;
    f.urge = 0;
    f.anchor.copy(f.position);
    f.nextTwitch = elapsed + exponential(HOVER.twitchInterval);
    // A fish that has been in food recently will not hold station for long.
    f.nextExcursion =
      elapsed +
      exponential(HOVER.excursionInterval / (f.character * (1 + f.foraging)));
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
  }

  function visit(f) {
    const interest = interests[Math.floor(random() * interests.length)];
    f.interest = interest;
    f.curiosity = 0;
    travel(f, interest.point);
  }

  // Destinations span the tank, including behind the grass. Reject nearby open-water
  // targets so an excursion actually carries a fish out of its previous patch.
  function destination(f, out) {
    // A fish still keyed up from a feeding searches instead of travelling: upstream, into
    // the water the food came down on, and low, over the sand where whatever the shoal
    // missed is lying. This is the long tail of a feeding event, and it is most of what
    // keeps the tank from looking as though a switch was thrown when the pellets run out.
    if (f.foraging > APPETITE.searching && random() < 0.6 * f.foraging) {
      flowDirectionAt(f.position, waterClock, downstream);
      out.copy(f.position).addScaledVector(downstream, -range(1.5, 4));
      out.x += range(-1.2, 1.2);
      out.z += range(-1.5, 1.5);
      out.y = groundHeight(out.x, out.z) + range(0.7, 2.2);
      return out;
    }
    const r = random();
    if (r < 0.55 || (r < 0.75 && !thickets.length)) {
      for (let attempt = 0; attempt < 12; attempt++) {
        out.set(
          range(OPEN.minX, OPEN.maxX),
          range(OPEN.minY, OPEN.maxY),
          range(OPEN.minZ, OPEN.maxZ),
        );
        if (out.distanceToSquared(f.position) > 25) break;
      }
    } else if (r < 0.75) {
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

  // Both clocks of hunger rise together, so the long searching tail never starts lower
  // than the scramble that preceded it. A fish that has already eaten its fill is moved
  // less by the same news.
  function rouse(f, amount) {
    f.keen = Math.min(1, f.keen + amount * f.appetite);
    f.searching = Math.max(f.searching, f.keen);
    f.foraging = Math.max(f.keen, f.searching);
  }

  // Going after one particular pellet. A rock is not food: whatever the fish was on its
  // way to look at is dropped.
  function forage(f, pellet) {
    f.mode = "feed";
    f.food = pellet;
    f.foodSerial = pellet.serial;
    f.interest = null;
    f.attempts = 0;
    f.strikeUntil = 0;
    f.launch = range(STRIKE.launch[0], STRIKE.launch[1]);
    f.until = elapsed + FORAGE.pursuit;
  }

  // Giving a pellet up: another fish got there first, three strikes failed, or six
  // seconds of chasing was enough. The turn away is a real flick, because a viewer must
  // see the fish change its mind rather than watch its interest teleport.
  function abandon(f, veer) {
    f.food = null;
    f.strikeUntil = 0;
    f.attempts = 0;
    f.nextScan = elapsed + range(0.15, 0.35);
    if (veer && !f.flick && elapsed > f.lastFlick + 0.6) {
      const angle = (random() < 0.5 ? -1 : 1) * range(0.7, 1.6);
      startFlick(f, angle, twitchProfile(angle));
    }
    if (f.mode === "feed") settle(f);
  }

  // The lunge, built from the same two pieces as a twitch because it is the same
  // movement at a different size: the body takes a C toward the pellet and the tail
  // sweeps it forward onto the jaws. It is aimed where the pellet is now, never where it
  // is going. A hurried fish aims worse, and that is most of where misses come from.
  function strikeAt(f, hurried) {
    // Aimed along the body and not along the snout. The mouth sits a third of a unit
    // ahead of the fish's centre, which at striking range is further than the pellet is
    // away: a fish that swings its head onto a pellet swings its jaws straight past it.
    wash.subVectors(f.food.position, f.position);
    const reach = Math.max(wash.length(), 1e-4);
    const error = STRIKE.aim * (0.3 + hurried);
    const angle = wrap(yawOf(wash) + range(-error, error) - yawOf(f.heading));
    startFlick(
      f,
      angle,
      {
        curvature: STRIKE.curvature,
        thrust: STRIKE.thrust,
        stage1: STRIKE.stage1,
        stage2: STRIKE.stage2,
        burst: 0,
        burstThrust: 0,
      },
      Math.asin(THREE.MathUtils.clamp(wash.y / reach, -0.95, 0.95)) +
        range(-error, error) * 0.5,
    );
    // The lunge is over when the tail stroke is, but the jaws are still closing while the
    // fish coasts through the last of it, which is where most of the forward travel
    // actually happens.
    f.strikeUntil = elapsed + STRIKE.stage1 + STRIKE.stage2 + STRIKE.follow;
    strikes++;
  }

  // The jaws close on it. Most of the time it goes down; a quarter of the time the fish
  // mouths the pellet and spits it out again, turned away from its neighbours, and has
  // to take it a second time -- which is the one moment in a tetra shoal when a pellet
  // can be robbed.
  function capture(f, pellet, crowding) {
    // Handling one item is half a second of intraoral work, and it lengthens as the fish
    // fills up, which is what slows the rhythm of a feeding down near its end.
    f.handling =
      elapsed +
      range(STRIKE.handling[0], STRIKE.handling[1]) * (1 + 2 * (1 - f.appetite));
    f.strikeUntil = 0;
    if (random() < STRIKE.spit) {
      wash.copy(f.heading).addScaledVector(crowding, 0.8);
      if (wash.lengthSq() < 1e-6) wash.copy(f.heading);
      food.nudge(pellet, wash.normalize(), STRIKE.spitShove);
      f.attempts++;
      return;
    }
    // Another fish's jaws may have been a frame ahead of these.
    if (!food.take(pellet)) return;
    bites++;
    rouse(f, FEED.eatDrive);
    f.appetite = Math.max(APPETITE.floor, f.appetite - APPETITE.cost);
    f.food = null;
    f.attempts = 0;
    settle(f);
  }

  // A miss. The strike moved real water: the pellet is shoved along the line of the
  // lunge, and one lying on the sand is blown up off it, which is the fish's own wake
  // handing it a second chance in midwater. The puff is the larger of the two, and has
  // to be: a fish here is never allowed nearer the sand than GROUND_CLEARANCE, so a
  // pellet must come up to meet it. Three failures and it gives up -- adult zebrafish
  // rarely need more than three strikes at anything.
  function missed(f, pellet) {
    f.strikeUntil = 0;
    f.attempts++;
    const lying = food.settled(pellet);
    if (lying) wash.set(f.heading.x * 0.35, 1, f.heading.z * 0.35);
    else wash.copy(f.heading);
    food.nudge(pellet, wash.normalize(), lying ? STRIKE.puff : STRIKE.wash);
    f.handling = elapsed + range(0.12, 0.3);
    // A second attempt is made from closer in, and more slowly.
    f.launch = range(STRIKE.launch[0], STRIKE.launch[1]) * STRIKE.retry;
    if (f.attempts >= STRIKE.attempts) abandon(f, true);
  }

  // Everything a fish notices about food: the pellet it is chasing disappearing, the
  // smell arriving from upstream, a neighbour that has started eating, and its own eyes.
  function senseFood(f, dt, informer) {
    if (f.food && (f.food.gone || f.food.serial !== f.foodSerial)) abandon(f, true);
    if (f.mode === "escape") return;

    // Smell has no direction in it. The plume is the drop point carried downstream at the
    // speed of the water that took it, so a fish behind it meets the front many seconds
    // late and can only search: a surge upstream, then a cast across the flow. Which way
    // that is has to be read off the water at the splash, since the sweep may have turned
    // the whole tank around since the food went in.
    if (elapsed >= f.nextSniff && f.mode !== "feed" && !f.interest) {
      for (const splash of splashes) {
        const age = elapsed - splash.at;
        if (age > FEED.plumeLife) continue;
        flowDirectionAt(splash.point, waterClock, downstream);
        scan.subVectors(f.position, splash.point);
        const along = scan.dot(downstream);
        if (along < 0.6 || along > age * splash.speed) continue;
        if (scan.addScaledVector(downstream, -along).length() > FEED.plumeWidth)
          continue;
        f.nextSniff = elapsed + FEED.sniff;
        rouse(f, FEED.odourDrive);
        if (f.mode === "hover" || f.mode === "settle") {
          scan.copy(downstream).multiplyScalar(-range(2, 3.5));
          rotateAboutY(scan, range(-0.7, 0.7)).add(f.position);
          travel(f, clampToBox(scan, BOUNDS, 0.45), true);
        }
        break;
      }
    }

    // Following a neighbour that is already eating, after the moment it takes to decide
    // that is what it is doing. The recruit goes to the fish, not to a pellet it has no
    // way of seeing, and finds the food itself when it arrives.
    if (f.recruiter) {
      if (elapsed >= f.recruitAt) {
        const leader = f.recruiter;
        f.recruiter = null;
        rouse(f, FEED.recruitDrive);
        if (f.mode !== "feed" && !f.interest) {
          scan.set(
            range(-FOOD_CONTAGION.spread, FOOD_CONTAGION.spread),
            range(-FOOD_CONTAGION.spread, FOOD_CONTAGION.spread) * 0.5,
            range(-FOOD_CONTAGION.spread, FOOD_CONTAGION.spread),
          );
          travel(f, clampToBox(scan.add(leader.position), BOUNDS, 0.45), true);
        }
      }
    } else if (
      informer &&
      f.mode !== "feed" &&
      random() < dt * FOOD_CONTAGION.chance * f.appetite
    ) {
      f.recruiter = informer;
      f.recruitAt = elapsed + range(FOOD_CONTAGION.latency[0], FOOD_CONTAGION.latency[1]);
    }

    if (elapsed < f.nextScan || elapsed < f.handling) return;
    const interval = range(FEED.scan[0], FEED.scan[1]);
    f.nextScan = elapsed + interval;
    // A fish already on a pellet only looks for a much closer one, and only every scan,
    // so that changing its mind stays rare and legible.
    let closest = f.food
      ? f.position.distanceTo(f.food.position) * 0.6
      : FEED.sight;
    let best = null;
    // A fish deep in the tank does not rocket to the film for a floating pellet, though
    // one already worked up will come further up for it.
    const rise = THREE.MathUtils.lerp(FEED.rise[0], FEED.rise[1], f.foraging);
    for (const pellet of food.pellets) {
      if (pellet.gone) continue;
      scan.subVectors(pellet.position, f.position);
      const d = scan.length();
      if (d > closest) continue;
      if (f.heading.dot(scan) < SENSES.blindCosine * d) continue;
      if (food.floating(pellet) && f.position.y < rise) continue;
      best = pellet;
      closest = d;
    }
    if (!best || best === f.food) return;
    // A pellet lying on the sand has the substrate's own texture behind it and no
    // silhouette, and a fish that has stopped thinking about food is not looking down
    // for one. It stays edible, but only for a fish that is still interested and happens
    // to come close -- which is what keeps an uneaten pellet from holding the shoal's
    // attention for as long as it takes to dissolve.
    const looking = food.settled(best) ? 0.1 + 0.9 * f.foraging : 1;
    // Seeing one is a chance per second that climbs as the pellet nears, rolled on each
    // fish's own scan. A radius test would have the whole shoal commit on one frame,
    // which is the single most artificial thing this feature could do.
    const seeing =
      FEED.rate * f.appetite * looking * smoothstep(FEED.sight, FEED.near, closest);
    if (random() > 1 - Math.exp(-seeing * interval)) return;
    rouse(f, FEED.sightDrive);
    forage(f, best);
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
    // Held here rather than read from the caller's vector: the way out is still needed
    // after the contagion loop below has filled `delta` with something else, and a
    // pointer escape is started from `delta` itself.
    flight.copy(direction);
    const angle = wrap(yawOf(flight) - yawOf(f.heading));
    f.interest = null;
    // Nothing outranks a C-start. A startled fish is not hungry.
    f.food = null;
    f.strikeUntil = 0;
    f.recruiter = null;
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
      Math.asin(THREE.MathUtils.clamp(flight.y, -0.4, 0.4)),
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
        .copy(flight)
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
    else if (f.mode === "travel") {
      if (f.interest) inspect(f);
      else if (random() < 0.72) leave(f);
      else settle(f);
    }
    else if (f.mode === "settle") hover(f);
    else if (f.mode === "inspect") {
      f.interest = null;
      leave(f);
    }
    // Six seconds is long enough to want one pellet. The fish coasts off it and looks
    // around again, rather than following it to the sand forever.
    else if (f.mode === "feed") {
      f.food = null;
      f.strikeUntil = 0;
      f.attempts = 0;
      settle(f);
    }
  }

  function update(dt, time, pointer) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    elapsed += dt;
    waterClock = time;
    // A pellet touching the film is the loudest thing that happens in a quiet tank, and
    // the first thing anyone notices: heads turn across the near half of the water before
    // a single fish has swum anywhere. Every pellet that has entered the water since the
    // last frame raises one of these, and it is also where the odour plume starts from.
    if (food)
      for (const pellet of food.pellets) {
        if (pellet.serial <= newestPellet) continue;
        newestPellet = pellet.serial;
        const slot = splashSlot;
        const splash = splashes[slot];
        splashSlot = (splashSlot + 1) % splashes.length;
        splash.point.copy(pellet.position);
        splash.at = elapsed;
        shelteredVelocity(splash.point, time, wash, thickets);
        splash.speed = wash.length();
        for (const f of fish) {
          if (f.splashAt || f.mode === "escape" || f.mode === "feed") continue;
          const d = f.position.distanceTo(splash.point);
          if (d > FEED.splash) continue;
          f.splashSlot = slot;
          // Further away is slower off the mark, as a weaker wave is.
          f.splashAt =
            elapsed +
            THREE.MathUtils.lerp(
              FEED.splashLatency[0],
              FEED.splashLatency[1],
              d / FEED.splash,
            );
        }
      }
    for (const f of fish) {
      const { position, swim, heading } = f;
      shelteredVelocity(position, time, water, thickets);
      const bed = thicketAt(thickets, position);
      if (f.pendingEscape && elapsed >= f.pendingEscape.at) {
        const { direction } = f.pendingEscape;
        f.pendingEscape = null;
        startEscape(f, direction);
      }
      f.alarm *= Math.exp(-dt / THREAT.habituation);
      // Interest in food runs down on two clocks at once and appetite comes back slowly.
      // Both are left exactly zero when there is nothing left of them, so a tank that has
      // never been fed carries none of this.
      if (f.foraging > 0) {
        f.keen *= Math.exp(-dt / APPETITE.keen);
        f.searching *= Math.exp(-dt / APPETITE.residual);
        f.foraging = Math.max(f.keen, f.searching);
        if (f.foraging < 0.01) f.keen = f.searching = f.foraging = 0;
      }
      if (f.appetite < 1)
        f.appetite = Math.min(1, f.appetite + dt * APPETITE.recovery);

      separation.set(0, 0, 0);
      alignment.set(0, 0, 0);
      centroid.set(0, 0, 0);
      let seen = 0;
      let crowded = false;
      let leader = null;
      let leaderDistance = Infinity;
      let informer = null;
      let informerDistance = Infinity;
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
        // Make room before paths cross, while there is still time to turn and coast.
        relativeVelocity.subVectors(other.velocity, f.velocity);
        const approachTime = THREE.MathUtils.clamp(
          -delta.dot(relativeVelocity) / Math.max(relativeVelocity.lengthSq(), 0.001),
          0,
          SHOAL.lookAhead,
        );
        closestApproach.copy(delta).addScaledVector(relativeVelocity, approachTime);
        const clearance = Math.min(d, closestApproach.length());
        if (clearance < SHOAL.spacing) {
          if (closestApproach.lengthSq() < 0.01) closestApproach.copy(delta);
          separation.addScaledVector(
            closestApproach,
            -(SHOAL.spacing - clearance) /
              (SHOAL.spacing * Math.max(closestApproach.length(), 0.05)),
          );
          if (clearance < SHOAL.crowded) crowded = true;
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
        // A feeding neighbour is a conspicuous signal in its own right, and a nearer one
        // is a louder one.
        if (other.mode === "feed" && d < FOOD_CONTAGION.range && d < informerDistance) {
          informer = other;
          informerDistance = d;
        }
      }
      // What pulls the fish somewhere else: neighbours moving off, the group left behind,
      // something come too close.
      urge.set(0, 0, 0);
      // A shoal is a travelling formation, and a shoal that has stopped to eat is not
      // one. Nobody is going the same way any more and the pellets, not the group, are
      // what everyone is pointing at; the fish also put up with crowding they would
      // normally flick away from. This is the fast clock's doing and not the slow one's:
      // the group comes back together over the half minute the scramble takes to fade,
      // while the searching goes on long after, which is the arc a viewer reads as a
      // shoal re-forming.
      if (seen) {
        urge.addScaledVector(alignment, (SHOAL.alignment * (1 - 0.85 * f.keen)) / seen);
        centroid.multiplyScalar(1 / seen).sub(position);
        const away = centroid.length();
        if (away > SHOAL.cohesionRange)
          urge.addScaledVector(
            centroid,
            (SHOAL.cohesion *
              (1 - 0.8 * f.keen) *
              Math.min(1, away - SHOAL.cohesionRange)) /
              away,
          );
      }
      if (pointer) threat(f, pointer, dt);
      // Food is sensed after the pointer, so a fish that has just been startled is
      // already out of feeding by the time it is asked whether it can see a pellet.
      let foodDistance = Infinity;
      if (food) {
        senseFood(f, dt, informer);
        if (f.mode === "feed") {
          // A fish eats with its snout, and at these distances the difference between its
          // snout and its centre is most of the reach of a strike.
          mouth.copy(position).addScaledVector(heading, SNOUT_X * f.scale);
          bite.subVectors(f.food.position, mouth);
          foodDistance = bite.length();
          // Pursuit lags: the fish steers at where it saw the pellet a fraction of a
          // second ago and corrects continuously, which is what bends the approach into
          // the curve from below instead of a straight interception.
          morsel
            .copy(f.food.position)
            .addScaledVector(f.food.velocity, -FORAGE.lag);
        }
      }

      if (elapsed >= f.until) decide(f);
      if (f.mode !== "inspect" && f.mode !== "feed")
        f.curiosity = Math.min(1, f.curiosity + dt * 0.012 * f.character);
      const mayFlick = !f.flick && elapsed > f.lastFlick + 0.6;
      // The splash felt a fraction of a second ago: a turn toward roughly where it came
      // from, and nothing more. The fish has no target yet -- it has only been told to
      // look up.
      if (f.splashAt && elapsed >= f.splashAt) {
        const splash = splashes[f.splashSlot];
        f.splashAt = 0;
        rouse(f, FEED.splashDrive);
        if (mayFlick && f.mode !== "escape" && f.mode !== "feed") {
          scan.subVectors(splash.point, position);
          const reach = Math.max(scan.length(), 1e-4);
          const angle = wrap(
            yawOf(scan) + range(-FEED.splashError, FEED.splashError) - yawOf(heading),
          );
          startFlick(
            f,
            angle,
            twitchProfile(angle),
            Math.asin(THREE.MathUtils.clamp(scan.y / reach, -0.5, 0.5)),
          );
          // Some of them go and look. A pellet a body length across is invisible from
          // most of the tank, so a fish that only turned its head would never find one:
          // what the lateral line buys is a reason to swim up to where it can see. The
          // nearer the splash, the more likely the fish is to bother.
          if (
            !f.interest &&
            random() < FEED.splashChance * f.appetite * (1 - (0.6 * reach) / FEED.splash)
          ) {
            scan
              .copy(splash.point)
              .add(wash.set(range(-0.9, 0.9), range(-0.5, 0.15), range(-0.7, 0.7)));
            travel(f, clampToBox(scan, BOUNDS, 0.45), true);
          }
        }
      }
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
      } else if (
        crowded &&
        mayFlick &&
        (f.mode === "travel" ||
          f.mode === "inspect" ||
          // Fish packed around one pellet is exactly when a crowding flick matters most,
          // but not in the last body length: a fish about to strike holds its line.
          (f.mode === "feed" && foodDistance > FORAGE.brakeRange * STANDARD_LENGTH))
      )
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
      const wallDistance = 1.2;
      for (const [axis, minimum, maximum] of [
        ["x", BOUNDS.minX, BOUNDS.maxX],
        ["y", BOUNDS.minY, BOUNDS.maxY],
        ["z", BOUNDS.minZ, BOUNDS.maxZ],
      ]) {
        if (position[axis] < minimum + wallDistance)
          avoid[axis] += (minimum + wallDistance - position[axis]) * 1.2;
        if (position[axis] > maximum - wallDistance)
          avoid[axis] -= (position[axis] - maximum + wallDistance) * 1.2;
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
        let remaining = desired.length();
        if (remaining < (f.interest ? 0.45 : 0.85)) {
          decide(f);
          desired.subVectors(f.goal, position);
          remaining = desired.length();
        }
        if (f.mode === "travel") {
          // Slower through the grass, easing off on the approach, and quicker for as long
          // as the fish is still keyed up about food.
          const speed =
            SWIM.cruise * f.character * (bed ? 0.72 : 1) *
            (1 + FORAGE.hurry * f.keen) *
            (f.interest ? Math.min(1, 0.25 + remaining / 1.2) : 1);
          desired.multiplyScalar(speed / remaining);
        } else desired.set(0, 0, 0);
      } else if (mode === "feed") {
        const length = STANDARD_LENGTH * f.scale;
        // How much faster than a stalk this fish arrived, which is what spoils its aim
        // and what makes its bow wave push the pellet away.
        const hurried = THREE.MathUtils.clamp(
          (swim.dot(heading) - FORAGE.stalk) / FORAGE.transit,
          0,
          1,
        );
        if (f.strikeUntil) {
          // A strike is resolved by the jaws arriving, not by the fish being near the
          // pellet: the pellet goes only when the mouth has actually reached it, at some
          // point inside the lunge. Otherwise the lunge ends and the fish has missed.
          if (foodDistance <= STRIKE.suction * length) capture(f, f.food, separation);
          else if (elapsed >= f.strikeUntil) missed(f, f.food);
        } else if (
          f.attempts &&
          mayFlick &&
          elapsed >= f.handling &&
          heading.dot(bite) < 0
        ) {
          // Overshot it. The fish brakes on its pectorals, turns hard, and comes back --
          // the beat that reads as an animal changing its mind rather than a tracker
          // snapping onto a new value.
          const angle = wrap(yawOf(bite) - yawOf(heading));
          startFlick(f, angle, twitchProfile(angle));
        } else if (
          elapsed >= f.handling &&
          !f.flick &&
          foodDistance <= f.launch * length &&
          heading.dot(bite) > 0.55 * foodDistance
        )
          strikeAt(f, hurried);
        if (f.mode === "feed") {
          // Fast transit to the neighbourhood, a hard brake, then a slow deliberate
          // stalk over the last body length. Coming in fast is its own punishment: the
          // water the fish pushes ahead of it takes the pellet with it.
          const stalk = FORAGE.stalk * (0.55 + 0.45 * f.appetite);
          const closing =
            (stalk +
              (FORAGE.transit * f.character - stalk) *
                smoothstep(
                  FORAGE.stalkRange * length,
                  FORAGE.brakeRange * length,
                  foodDistance,
                )) *
            (f.attempts ? STRIKE.retry : 1);
          // Closing speed is measured against the pellet and not against the tank. A fish
          // creeping up on food that is itself sinking and drifting has to carry the
          // pellet's motion before any of its own swimming counts toward catching it, and
          // approaching a stationary item slowly is what the measurement describes.
          // The fish closes to its own striking distance and no further. Suction has no
          // reach to speak of, so the last stretch is not swum at all -- it is covered by
          // the lunge, which is why a strike looks like a stab rather than a glide in.
          const standoff = f.launch * length * FORAGE.standoff;
          desired
            .copy(morsel)
            .sub(mouth)
            .setLength(
              Math.min(closing, Math.max(0, foodDistance - standoff) * FORAGE.ease),
            )
            .add(f.food.velocity);
          // Not during the strike itself: the gape opens and the flow reverses, so the
          // water a striking fish moves pulls the pellet in rather than pushing it away.
          if (!f.strikeUntil && foodDistance < FORAGE.bowReach * length)
            food.nudge(
              f.food,
              food.settled(f.food)
                ? wash.set(heading.x * 0.5, 0.8, heading.z * 0.5).normalize()
                : heading,
              FORAGE.bowWave *
                Math.max(0, swim.dot(heading) - closing) *
                (1 - foodDistance / (FORAGE.bowReach * length)) *
                dt,
            );
        } else desired.set(0, 0, 0);
      } else desired.set(0, 0, 0);
      desired.add(avoid).sub(water);
      desired.addScaledVector(separation, SHOAL.separation * (1 - 0.4 * f.keen));
      if (f.mode === "travel") desired.add(urge);
      else if (f.mode === "hover") desired.addScaledVector(urge, 0.5);
      // A feeding fish ignores the shoal, but not something that has come too close: the
      // give-way term the pointer writes into the same pull is kept.
      else if (f.mode === "feed") desired.addScaledVector(urge, 0.3);

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
          flickWave = 0;
          bending = true;
        } else if (t < flick.stage1 + flick.stage2) {
          const k = (t - flick.stage1) / flick.stage2;
          setHeading(heading, flick.yaw0 + flick.angle, flick.pitch);
          bendTarget = c * (1 - 1.5 * k);
          along = flick.thrust * Math.sin(k * Math.PI);
          flickWave = 0;
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
        } else if (
          f.mode === "feed" &&
          foodDistance < FORAGE.brakeRange * STANDARD_LENGTH * f.scale
        ) {
          // Close in, the body lines up with the pellet rather than with wherever the
          // sum of every other pull points: head down for one on the sand and head up for
          // one under the film. That posture is what a viewer recognises. It is the body
          // that is aimed, for the same reason the strike is.
          target.copy(morsel).sub(position).normalize();
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
                : Math.min(
                    f.mode === "feed" ? TURN.feedRate : TURN.maximumRate,
                    TURN.floorRate + swim.length() * TURN.speedRate,
                  );
          const error = wrap(yawOf(target) - yaw);
          f.yawRate = THREE.MathUtils.lerp(
            f.yawRate,
            THREE.MathUtils.clamp(error * TURN.steeringGain, -rate, rate),
            1 - Math.exp(-dt * TURN.response),
          );
          const nextYaw = yaw + f.yawRate * dt;
          const climb = f.mode === "feed" ? TURN.feedPitch : TURN.pitch;
          const pitch = THREE.MathUtils.lerp(
            Math.asin(heading.y),
            Math.asin(THREE.MathUtils.clamp(target.y, -climb, climb)),
            1 - Math.exp(-dt * 4),
          );
          setHeading(heading, nextYaw, pitch);
        }
      }

      // Start a short bout when forward speed falls below demand, then let momentum
      // carry the fish. Pectoral trim does not make the tail beat.
      let drive = Math.min(1, Math.sqrt(along / SWIM.thrustLimit.travel)) * flickWave;
      const frequency = f.mode === "escape" ? 6 : GAIT.frequency * f.character;
      if (flick) acceleration.copy(heading).multiplyScalar(along);
      else {
        acceleration.subVectors(desired, swim).multiplyScalar(1 / SWIM.response);
        if (wanted > 1e-4)
          acceleration.addScaledVector(desired, dragOf(wanted) / wanted);
        const forward = acceleration.dot(heading);
        lateral.copy(acceleration).addScaledVector(heading, -forward);
        lateral.clampLength(
          0, SWIM.scull + SWIM.avoidanceScull * Math.min(1, separation.length()),
        );
        // The pectorals come out at the end of an approach, and the fish is able to back
        // water far harder than it ever needs to while cruising.
        const braking =
          f.mode === "feed" && foodDistance < FORAGE.brakeRange * STANDARD_LENGTH * f.scale
            ? SWIM.feedBrake
            : SWIM.brake;
        if (f.stroke && (elapsed >= f.stroke.end || forward < -braking)) {
          f.stroke = null;
          f.nextStroke =
            elapsed +
            range(...(f.mode === "feed" ? GAIT.feedCoast : GAIT.coast)) / f.character;
        }
        if (
          !f.stroke &&
          elapsed >= f.nextStroke &&
          forward > GAIT.minimumThrust &&
          SWIM.thrustLimit[f.mode] > 0 &&
          swim.dot(heading) < desired.dot(heading) * GAIT.restartSpeed
        ) {
          const beats =
            (f.mode === "travel" || f.mode === "feed") && wanted > SWIM.cruise ? 2 : 1;
          f.stroke = {
            start: elapsed,
            end: elapsed + beats / frequency,
            thrust: Math.min(SWIM.thrustLimit[f.mode], forward * GAIT.strokeGain),
          };
        }
        let tail = THREE.MathUtils.clamp(forward, -braking, 0);
        if (f.stroke) {
          const progress = (elapsed - f.stroke.start) / (f.stroke.end - f.stroke.start);
          const envelope =
            smoothstep(0, 0.2, progress) * (1 - smoothstep(0.72, 1, progress));
          drive = envelope * Math.sqrt(f.stroke.thrust / SWIM.thrustLimit.travel);
          tail = f.stroke.thrust * envelope * (0.65 + 0.35 * Math.pow(Math.cos(f.phase), 2));
        }
        acceleration.copy(lateral).addScaledVector(heading, tail);
      }
      swim.addScaledVector(acceleration, dt);
      lateral.copy(swim).addScaledVector(heading, -swim.dot(heading));
      swim.addScaledVector(lateral, -(1 - Math.exp(-dt * SWIM.lateralDrag)));
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
      // No baseline tail oscillation: once a bout ends the body relaxes into a glide.
      f.effort = THREE.MathUtils.lerp(
        f.effort,
        drive,
        1 - Math.exp(-dt * 18),
      );
      const pectorals =
        f.mode === "settle"
          ? 1
          : f.mode === "inspect"
            ? 0.5
            : // Flared through the brake and held out through the stalk: the single most
              // legible "this fish is about to eat something" pose in the sequence.
              f.mode === "feed"
              ? foodDistance < FORAGE.brakeRange * STANDARD_LENGTH * f.scale && !flick
                ? 0.9
                : 0
              : f.mode === "hover" && !flick
                ? 0.25
                : 0;
      f.finBrake = THREE.MathUtils.lerp(f.finBrake, pectorals, 1 - Math.exp(-dt * 6));
      if (f.stroke || flick) f.phase = (f.phase + dt * TAU * frequency) % TAU;
      f.finPhase = (f.finPhase + dt * TAU * (2.1 + f.effort * 1.5)) % TAU;
      swimAttribute.setXYZW(
        f.id,
        f.phase,
        f.effort * GAIT.waveAngle,
        -f.bend,
        f.finBrake,
      );
      finPhaseAttribute.setX(f.id, f.finPhase);

      axisZ.crossVectors(heading, UP).normalize();
      axisY.crossVectors(axisZ, heading).normalize();
      basis.makeBasis(heading, axisY, axisZ);
      targetQuaternion.setFromRotationMatrix(basis);
      bankQuaternion.setFromAxisAngle(
        FORWARD,
        -THREE.MathUtils.clamp(f.bend, -1.8, 1.8) * 0.08,
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
    finPhaseAttribute.needsUpdate = true;
  }

  for (const f of fish) if (f.id % 4 !== 0) leave(f);
  update(0, 0, null);
  return {
    update,
    fish,
    getTelemetry() {
      const states = { hover: 0, travel: 0, settle: 0, inspect: 0, feed: 0, escape: 0 };
      let twitching = 0,
        totalSpeed = 0,
        maximumSpeed = 0,
        foraging = 0;
      for (const f of fish) {
        states[f.mode]++;
        if (f.flick && f.mode !== "escape") twitching++;
        if (f.foraging > APPETITE.searching) foraging++;
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
        foraging,
        strikes,
        bites,
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
