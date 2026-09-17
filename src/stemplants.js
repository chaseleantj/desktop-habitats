import * as THREE from "three";
import { groundHeight, randomGenerator, smoothstep, vec } from "./math.js";
import { FLOW_DIRECTION } from "./water.js";
import { TAU, stem, stemStrand } from "./foliage.js";

// The background stem plants: Limnophila sessiliflora, whose whorls of fine keeled leaves
// make the feathery columns rising past the grass at the sides, and Hygrophila polysperma,
// whose opposite pairs of small lanceolate leaves fill the sparser, shadier group behind
// the wood.
//
// Neither is built as a shape. Both are built as the record of a growth: an apex that rose
// toward the light, leaned on the way, was pushed downstream by the flow it grew in, and
// swayed while its tissue set, leaving a sinuous axis; internodes short where the light was
// strong and long where the shoot stretched through the shade beneath the canopy; leaves
// held out square from the stem and curving up toward the light, expanding over the first
// few nodes below the apex, at full size through the lit upper half, and smaller, fewer,
// flatter, darker and partly shed toward the shaded base.
//
// One scene unit is about 4.5 cm: a tetra is 0.8 units long. Every dimension below is a
// real measurement of the plant divided by that.

// This module draws from its own stream so the rest of the scene keeps the numbers it had.
const random = randomGenerator(70241);
const range = (a, b) => a + (b - a) * random();

// Where a leaf points: `azimuth` around the stem, `rise` above the horizontal.
const facing = (azimuth, rise) =>
  vec(
    Math.cos(azimuth) * Math.cos(rise),
    Math.sin(rise),
    Math.sin(azimuth) * Math.cos(rise),
  );

// One leaf: a strip swept along an arc, keeled along its midrib. A narrow submerged leaf
// really is V-sectioned, and the keel is what makes the overhead light run as a highlight
// down one half of it instead of shading the whole leaf flat.
//
// The leaf rides on the strand of the node it grows from, so it cannot come loose: its base
// takes exactly the displacement the stem has there, and the distance along the strand
// grows toward the free tip, which lets the tip trail a little further downstream than the
// attachment. That is the whole of the leaf's own motion, and it is the right amount for a
// leaf this small on a stem this long.
function leaf(batch, points, halfWidth, colors, anchor, node, options) {
  const {
    rows = 3,
    keel = 0.4,
    roll = 0,
    azimuth = 0,
    thin = 0.78,
    needle = true,
    reach = 0.75,
  } = options;
  const curve = new THREE.QuadraticBezierCurve3(...points);
  const length = curve.getLength();
  const cols = needle ? 2 : 4;
  const start = batch.positions.length / 3;
  const rest = vec(-Math.sin(azimuth), 0, Math.cos(azimuth));
  const side = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    side.copy(rest).applyAxisAngle(tangent, roll);
    side.addScaledVector(tangent, -side.dot(tangent)).normalize();
    normal.crossVectors(side, tangent).normalize();
    // A needle widens over its first fifth and then draws steadily out to a fine point; a
    // lanceolate leaf is widest a third of the way up and tapers to a point both ways.
    const shape = needle
      ? Math.pow(1 - t, 0.8) * (0.42 + 0.58 * smoothstep(0, 0.16, t))
      : Math.pow(Math.sin(Math.PI * Math.pow(t, 0.82)), 0.72);
    const half = halfWidth * shape;
    // The keel flattens out toward the tip, as a leaf that narrows to a point must.
    const ridge = keel * (1 - 0.55 * t);
    tint.copy(colors[0]).lerp(colors[1], t * t);
    const strand = {
      direction: node.direction,
      tangent: node.tangent,
      distance: node.distance + t * length * reach,
      compliance: node.compliance,
    };
    for (let j = 0; j <= cols; j++) {
      const across = (j / cols) * 2 - 1;
      // A needle is a slice of a dissected blade, not a blade with a broad midrib of its
      // own, so both its halves are mapped onto the inner flank of the shared leaf texture:
      // they take its gentle edge shading and never its wide bright rib, which on a leaf
      // two pixels across would cover the whole of it and blow out to a white speck.
      const u = needle ? 0.62 + 0.28 * Math.abs(across) : j / cols;
      const p = center
        .clone()
        .addScaledVector(side, across * half)
        .addScaledVector(normal, half * ridge * (1 - Math.abs(across)));
      batch.vertex(p, [u, t], tint, anchor, strand, thin);
      if (i < rows && j < cols) {
        const a = start + i * (cols + 1) + j;
        batch.quad(a, a + 1, a + cols + 1, a + cols + 2);
      }
    }
  }
}

// The axis a shoot was left with. Height enters linearly, so the plant is as tall as it
// grew; everything else is the history of that growth. The lean is phototropic and so
// accumulates with height; the downstream deflection accumulates faster still, because the
// flow is stronger higher up and the shoot thinner. The sway that shook the apex while it
// was extending is frozen into two perpendicular waves of different wavelength, which is
// why a real stem wanders instead of bowing. A shoot that reached the surface could grow no
// higher and turned over to run along it, downstream.
function stemPath(
  root,
  height,
  { leanAngle, lean, push, wander, waves, phase, arch },
  samples = 7,
) {
  const leanDir = vec(Math.cos(leanAngle), 0, Math.sin(leanAngle));
  const crossDir = vec(-leanDir.z, 0, leanDir.x);
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const curl = arch > 0 ? smoothstep(1 - arch, 1, t) ** 2 : 0;
    const grew = 0.3 + 0.7 * t;
    const p = root.clone();
    p.y += height * (t - 0.62 * arch * curl);
    p.addScaledVector(leanDir, lean * height * Math.pow(t, 1.7));
    p.addScaledVector(
      FLOW_DIRECTION,
      push * height * Math.pow(t, 2.1) + 0.95 * arch * height * curl,
    );
    p.addScaledVector(
      crossDir,
      wander * grew * (Math.sin(waves * TAU * t + phase) - Math.sin(phase) * (1 - t)),
    );
    p.addScaledVector(
      leanDir,
      wander *
        0.62 *
        grew *
        (Math.sin(waves * 0.57 * TAU * t + phase * 2.1) -
          Math.sin(phase * 2.1) * (1 - t)),
    );
    points.push(p);
  }
  return points;
}

// Node positions, walked along the axis rather than in curve parameter, so whorls stay
// evenly spaced where the axis bends over. The internode is the plant's own record of the
// light it grew in: short at the apex, long at the base where the shoot etiolated in the
// shade of everything above it.
function nodeParameters(curve, apexGap, baseGap) {
  const speed = (t) => {
    const a = Math.max(0, t - 0.01);
    const b = Math.min(1, t + 0.01);
    return Math.max(0.05, curve.getPoint(b).distanceTo(curve.getPoint(a)) / (b - a));
  };
  const nodes = [];
  for (let t = 0.03; t < 0.995 && nodes.length < 72; ) {
    nodes.push(t);
    t += (baseGap + (apexGap - baseGap) * t) / speed(t);
  }
  return nodes;
}

// How much light reaches a point in the stand. The gradient down a stem comes far more from
// the canopy above it than from the water above that, so it is a function of absolute
// height: a short shoot is dark all the way up, while a tall one is bright only where it
// clears its neighbours. `exposure` is how open the clump itself stands, and `canopy` is
// the height its stand grows to: a low mound standing on its own in the midground is lit
// nearly to the sand.
const CANOPY = 7.4;
const lightAt = (y, exposure, canopy = CANOPY) =>
  Math.min(1, exposure * smoothstep(0.12 * canopy, canopy, y));
// Dying back: in the dark strip at the foot of the stand, where almost no light gets
// through, leaves thin out and then go altogether, leaving bare stem. It takes both, deep
// in the stand and low on this shoot, at parameter `t`; a short plant's crown is shaded
// but it is still the crown, and keeps its leaves.
const diebackAt = (y, t, exposure, canopy = CANOPY) =>
  Math.min(
    smoothstep(0.345 * canopy, 0.078 * canopy, y),
    smoothstep(0.44, 0.06, t),
  ) *
  (1.15 - 0.35 * exposure);

const SENESCENT = new THREE.Color("#6f5f2e");

// A bunch plant branches from its lowest nodes, and that is how a planted stem becomes a
// clump. The branch rises from a leaf axil, so it sets out along that leaf and then
// straightens toward the light like any other shoot. Taking it from a node this near the
// ground also keeps its own bending in step with its parent's, so the fork holds together.
function branchesOf(grow, batch, plant, curve, nodes, branches) {
  const spacing = Math.max(1, Math.floor(nodes.length * 0.05));
  for (let b = 0; b < branches; b++) {
    const i = Math.min(nodes.length - 2, 1 + b * spacing + Math.floor(range(0, 1.6)));
    const azimuth = range(0, TAU);
    grow(batch, {
      root: curve.getPoint(nodes[i]),
      anchor: plant.anchor,
      height: plant.height * range(0.42, 0.76),
      exposure: plant.exposure * range(0.9, 1.06),
      canopy: plant.canopy,
      compliance: plant.compliance * range(1, 1.12),
      path: {
        leanAngle: azimuth,
        lean: range(0.2, 0.44),
        push: plant.path.push * range(0.8, 1.35),
        wander: range(0.05, 0.14),
        waves: range(1.3, 2.6),
        phase: range(0, TAU),
        arch: 0,
      },
      branches: 0,
    });
  }
}

// Limnophila sessiliflora. Whorls of 5-8 narrow leaves 10-40 mm long on 1.5-2.5 cm
// internodes, each whorl turned half a gap from the one below so no leaf sits in another's
// shade. Leaves leave the stem square to it and curve up into the light. Tips flush
// yellow-green where the light is strong; the lower stem, in the dark under the stand,
// carries fewer, shorter, flatter, darker leaves and has dropped some whorls entirely.
function limnophila(batch, plant) {
  const {
    root,
    height,
    exposure,
    canopy = CANOPY,
    compliance,
    path,
    branches = 0,
  } = plant;
  const anchor = plant.anchor ?? root;
  const radius = 0.015 + 0.008 * Math.min(1, height / 7.5);
  const { curve, length } = stem(
    batch,
    stemPath(root, height, path),
    radius,
    new THREE.Color("#55692a"),
    anchor,
    compliance,
    plant.attach,
  );
  const nodes = nodeParameters(
    curve,
    range(0.26, 0.34),
    range(0.6, 0.88) * (1.2 - 0.2 * exposure),
  );
  // Sampled off the reference: its feathery stands read as hue 0.203-0.217 at a saturation
  // of 0.95 and a lightness of 0.28-0.38. A white key light and the transmitted green both
  // wash a leaf out, so the pigment has to start further over and with no blue in it at
  // all to arrive there.
  const shaded = new THREE.Color().setHSL(
    0.272 + range(-0.012, 0.012),
    range(0.9, 1),
    range(0.065, 0.1),
  );
  const sunlit = new THREE.Color().setHSL(
    0.193 + range(-0.012, 0.012),
    range(0.96, 1),
    range(0.15, 0.195),
  );
  // The leaf outline, not one of the thread-fine segments it divides into, is what the eye
  // resolves at this distance, so a leaf is drawn at its full dissected width and left
  // three-quarters translucent: a dissected blade covers only part of its own silhouette.
  const fullLength = range(0.6, 0.84);
  const fullWidth = range(0.03, 0.042);
  const keel = range(0.26, 0.38);
  const thin = range(0.74, 0.84);
  const whorl = range(5.6, 8.4);
  const twist = range(0, TAU);
  const color = new THREE.Color();
  const last = nodes.length - 1;
  for (let i = 0; i <= last; i++) {
    const t = nodes[i];
    const center = curve.getPoint(t);
    const node = plant.attach ?? stemStrand(curve, t, length, compliance);
    const fromApex = last - i;
    const light = lightAt(center.y, exposure, canopy);
    // A leaf is laid down at the apex and reaches full length about three nodes later, by
    // which time the internode beneath it has extended too.
    const expand = 0.26 + 0.74 * smoothstep(0, 2.8, fromApex);
    const young = 1 - smoothstep(0, 4, fromApex);
    // Shed whorls leave bare stem at the foot of the stand.
    const dieback = diebackAt(center.y, t, exposure, canopy);
    if (dieback > 0.5 && random() < dieback * 0.9) continue;
    // How many leaves a whorl carries is the species, not the light. Shade shows in the
    // internode, in the leaf's length and narrowness, and in shed whorls, not in the count.
    const count = Math.max(4, Math.round(whorl - 2.4 * dieback));
    // Held out square from the stem, and turning up through the whorl's own length: the
    // open shuttlecock of a shoot in good light, flattening to a plate in the shade.
    const rise = 0.06 + 0.3 * young + 0.2 * light - 0.3 * dieback;
    const turn = 0.74 + 0.36 * young - 0.95 * (1 - light);
    const scale = range(0.8, 1.14);
    const spin = twist + i * (Math.PI / count) + range(-0.3, 0.3);
    for (let j = 0; j < count; j++) {
      const azimuth = spin + ((j + range(-0.22, 0.22)) / count) * TAU;
      const senescent = dieback > 0.25 && random() < 0.12 + 0.22 * dieback;
      // A whorl is never even: a few of its leaves are half-grown or were shaded out.
      // A shaded leaf is not much shorter than a lit one — it is drawn out and narrower.
      const len =
        fullLength *
        expand *
        scale *
        (0.88 + 0.12 * light) *
        range(0.78, 1.14) *
        (random() < 0.2 ? range(0.45, 0.72) : 1) *
        (senescent ? 0.7 : 1);
      const lift = rise + range(-0.22, 0.22);
      const bow = turn + range(-0.22, 0.22) - (senescent ? 0.5 : 0);
      const base = center
        .clone()
        .addScaledVector(facing(azimuth, lift), radius * 0.8);
      const mid = base.clone().addScaledVector(facing(azimuth, lift), len * 0.5);
      const tip = mid
        .clone()
        .addScaledVector(facing(azimuth, lift + bow), len * 0.5);
      color.copy(shaded).lerp(sunlit, light * range(0.85, 1.05));
      if (senescent) color.lerp(SENESCENT, range(0.45, 0.8));
      leaf(
        batch,
        [base, mid, tip],
        fullWidth *
          (0.78 + 0.22 * expand) *
          (0.8 + 0.2 * light) *
          range(0.86, 1.12),
        [color.clone(), color.clone().lerp(sunlit, senescent ? 0 : 0.16)],
        anchor,
        node,
        {
          // Only the leaves out in the light are subdivided enough to show their curve;
          // deep in the stand a leaf reads as its silhouette and nothing more.
          rows: light > 0.35 ? 3 : 2,
          keel,
          roll: range(-0.6, 0.6),
          azimuth,
          thin: senescent ? 0.88 : thin,
          reach: 0.75,
        },
      );
    }
  }
  if (branches) branchesOf(limnophila, batch, plant, curve, nodes, branches);
}

// Hygrophila polysperma. Opposite pairs of lanceolate leaves 15-30 mm long, each pair
// turned a quarter turn from the last, on a stem that leans hard toward the light and
// creeps as it goes. Well-lit shoots run bronze over the top few pairs; the lowest leaves
// brown and go.
function hygrophila(batch, plant) {
  const {
    root,
    height,
    exposure,
    canopy = CANOPY,
    compliance,
    path,
    branches = 0,
  } = plant;
  const anchor = plant.anchor ?? root;
  const radius = 0.014 + 0.007 * Math.min(1, height / 6);
  const { curve, length } = stem(
    batch,
    stemPath(root, height, path),
    radius,
    new THREE.Color("#5c6f2c"),
    anchor,
    compliance,
    plant.attach,
  );
  const nodes = nodeParameters(
    curve,
    range(0.23, 0.29),
    range(0.38, 0.52) * (1.2 - 0.2 * exposure),
  );
  const shaded = new THREE.Color().setHSL(
    0.288 + range(-0.012, 0.012),
    range(0.82, 0.92),
    range(0.06, 0.09),
  );
  const sunlit = new THREE.Color().setHSL(
    0.202 + range(-0.014, 0.014),
    range(0.92, 1),
    range(0.14, 0.185),
  );
  // A quarter of the shoots have taken enough light to flush bronze at the growing tip.
  const flushing = random() < 0.28;
  const flush = new THREE.Color().setHSL(
    range(0.06, 0.1),
    range(0.5, 0.66),
    range(0.2, 0.27),
  );
  const fullLength = range(0.5, 0.72);
  const thin = range(0.55, 0.64);
  const twist = range(0, TAU);
  const color = new THREE.Color();
  const last = nodes.length - 1;
  for (let i = 0; i <= last; i++) {
    const t = nodes[i];
    const center = curve.getPoint(t);
    const node = plant.attach ?? stemStrand(curve, t, length, compliance);
    const fromApex = last - i;
    const light = lightAt(center.y, exposure, canopy);
    const expand = 0.24 + 0.76 * smoothstep(0, 2.4, fromApex);
    const young = 1 - smoothstep(0, 3.4, fromApex);
    const dieback = diebackAt(center.y, t, exposure, canopy);
    if (dieback > 0.55 && random() < dieback * 0.8) continue;
    const rise = 0.12 + 0.5 * young + 0.28 * light - 0.35 * dieback;
    // A broad leaf is stiff enough to hold itself out nearly straight, and only its last
    // third turns: up while it is young and lit, over and down once it is old or shaded.
    const turn = 0.24 + 0.3 * young - 0.75 * (1 - light);
    const spin = twist + i * (Math.PI / 2) + range(-0.13, 0.13);
    for (let j = 0; j < 2; j++) {
      const azimuth = spin + j * Math.PI;
      const senescent = dieback > 0.3 && random() < 0.14 + 0.2 * dieback;
      const len =
        fullLength *
        expand *
        (0.72 + 0.28 * light) *
        range(0.84, 1.14) *
        (senescent ? 0.75 : 1);
      const lift = rise + range(-0.16, 0.16);
      const bow = turn + range(-0.16, 0.16) - (senescent ? 0.4 : 0);
      const base = center
        .clone()
        .addScaledVector(facing(azimuth, lift), radius * 0.8);
      const mid = base.clone().addScaledVector(facing(azimuth, lift), len * 0.56);
      const tip = mid
        .clone()
        .addScaledVector(facing(azimuth, lift + bow), len * 0.44);
      color.copy(shaded).lerp(sunlit, light * range(0.85, 1.05));
      if (flushing) color.lerp(flush, young * light * 0.7);
      if (senescent) color.lerp(SENESCENT, range(0.5, 0.85));
      leaf(
        batch,
        [base, mid, tip],
        len * range(0.115, 0.15),
        [color.clone(), color.clone().lerp(sunlit, senescent ? 0 : 0.12)],
        anchor,
        node,
        {
          rows: 4,
          needle: false,
          // Folded along the midrib, as this leaf is: it gives the bright centre line and
          // the two shaded flanks that let a small leaf read as a surface, not a cutout.
          keel: range(0.36, 0.52),
          roll: range(-0.4, 0.4),
          azimuth,
          thin: senescent ? 0.7 : thin,
          reach: 0.6,
        },
      );
    }
  }
  if (branches) branchesOf(hygrophila, batch, plant, curve, nodes, branches);
}

// The stands: dense at both sides, where the feathery stems rise past the top of the
// frame; one short, sparse, shade-grown group in the middle of the back, behind the wood,
// where the channel opens into dark water; and two well-lit, small-leaved mounds in the
// midground that step the planting down from the grass to the sand, one on the left bank
// of the channel and one behind the main stone. Stem plants are planted in bunches and
// then branch from their lowest nodes, so they stand in clumps of unequal shoots sharing a
// crown, not as scattered singles.
const BANDS = [
  { x: [-10.6, -6.2], z: [-6.0, -3.1], clumps: 11, shoots: [3, 5], height: [5.4, 10.2], exposure: [0.94, 1.16], feathery: 0.78 },
  { x: [5.6, 10.6], z: [-6.0, -3.1], clumps: 10, shoots: [3, 5], height: [5.2, 10.0], exposure: [0.9, 1.12], feathery: 0.74 },
  { x: [-3.0, 3.6], z: [-5.9, -3.4], clumps: 9, shoots: [2, 4], height: [4.2, 7.6], exposure: [0.5, 0.8], feathery: 0.5 },
  { x: [-3.5, -0.9], z: [-3.4, -1.6], clumps: 7, shoots: [4, 6], height: [2.4, 4.2], exposure: [0.95, 1.15], feathery: 0.1, canopy: 2.6 },
  { x: [4.3, 5.4], z: [-2.9, -1.7], clumps: 3, shoots: [3, 5], height: [2.2, 3.4], exposure: [0.9, 1.1], feathery: 0.1, canopy: 2.4 },
];

export function plantStems(batch) {
  for (const band of BANDS) {
    for (let c = 0; c < band.clumps; c++) {
      const cx = range(band.x[0], band.x[1]);
      const cz = range(band.z[0], band.z[1]);
      const exposure = range(band.exposure[0], band.exposure[1]);
      // The stands rise toward the ends of the tank, where nothing is in front of them and
      // the oldest plantings have had the longest to run up to the surface.
      const tallest =
        range(band.height[0], band.height[1]) *
        (0.92 + 0.34 * smoothstep(6, 10.4, Math.abs(cx)));
      // The whorled plant is the one that runs to the surface; the small-leaved one keeps
      // to the middle of the tank, so the tallest stands are nearly all feathery.
      const feathery =
        random() < band.feathery + 0.35 * smoothstep(6.5, 9.5, tallest);
      const species = feathery ? limnophila : hygrophila;
      const shoots = Math.round(range(band.shoots[0], band.shoots[1]));
      // The oldest shoot stands at the crown; the younger ones lean out around it, and the
      // younger they are the shorter and the further out they stand.
      const spread = range(0.2, 0.5);
      const away = range(0, TAU);
      for (let s = 0; s < shoots; s++) {
        const age = s === 0 ? 1 : range(0.42, 0.93);
        const out = away + (s / shoots) * TAU + range(-0.5, 0.5);
        const offset = spread * (1.15 - age) * range(0.4, 1.5);
        const x = cx + Math.cos(out) * offset;
        const z = cz + Math.sin(out) * offset * 0.7;
        const height = tallest * age * range(0.94, 1.06);
        const root = vec(x, groundHeight(x, z) - 0.03, z);
        // A shoot that reached the surface could grow no further up and turned to run
        // along it, downstream. How far it turned is simply how much more it grew than the
        // water above its crown was deep.
        const ceiling = range(8.8, 9.4);
        const arch =
          height > ceiling
            ? Math.min(0.4, (1 - ceiling / height) / 0.62)
            : random() < 0.12
              ? range(0.04, 0.12)
              : 0;
        species(batch, {
          root,
          height,
          // A shoot at the edge of the clump sees more light than the one inside it.
          exposure: exposure * (s === 0 ? 0.92 : range(0.98, 1.12)),
          canopy: band.canopy,
          compliance: feathery ? range(0.46, 0.64) : range(0.3, 0.44),
          branches: height > 4.6 && random() < 0.42 ? (random() < 0.28 ? 2 : 1) : 0,
          path: {
            // Leaning out of the clump, forward into the light from the front glass, and
            // downstream with the flow.
            leanAngle: Math.atan2(
              Math.sin(out) * 0.45 + range(0.25, 1),
              Math.cos(out) * 0.7 + range(-0.5, 0.5),
            ),
            lean: (feathery ? range(0.04, 0.16) : range(0.12, 0.3)) * (1.2 - 0.4 * age),
            push: range(0.035, 0.13),
            wander: range(0.05, 0.135),
            waves: range(1.4, 2.7),
            phase: range(0, TAU),
            arch,
          },
        });
      }
    }
  }
}
