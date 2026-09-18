import * as THREE from "three";
import { ROCKS, rockCenterY } from "./environment.js";
import {
  groundHeight,
  noise,
  randomGenerator,
  smoothstep,
  vec,
} from "./math.js";
import { TAU, stemStrand } from "./foliage.js";

// The foreground broad-leaf planting: Anubias barteri creeping over the sand and rocks on
// the left, Echinodorus in the right-hand group, Cryptocoryne wendtii through the
// midground and along the front glass.
//
// Every leaf is built from its anatomy. A sheathed petiole leaves the rhizome or the crown,
// arches until it carries its blade clear of the leaves below, and the blade is a surface
// swept along its midrib: ovate-cordate and leathery for Anubias, keeled and lanceolate for
// Echinodorus, undulate and puckered for Cryptocoryne. Submerged tissue is close to
// neutrally buoyant, so the petiole holds the blade up and out instead of letting it flop
// the way an emersed leaf does, and the stiffness of the tissue shows in how little the
// leaf answers the current: the grass streams, these only nod.

// A generator of its own keeps this planting stable whatever else draws from the scene's
// shared sequence.
const rand = randomGenerator(52711);
const between = (a, b) => a + (b - a) * rand();
const UP = vec(0, 1, 0);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

// The rock table mirrors `ROCKS` in environment.js: epiphytes need the faces it describes,
// and nothing may root inside one. Each rock is a unit sphere cut back by fifteen planes,
// noise and pits, which leaves its surface near 0.78 of its radii and never much past 0.95.
const ROCK_FACE = 0.78;
const ROCK_CLEAR = 0.95;

// How far a point on the sand is from the nearest rock, in units of that rock's footprint:
// above 1 the plant is clear of every rock.
function rockClearance(x, z) {
  let nearest = Infinity;
  for (const rock of ROCKS) {
    const radius = ROCK_CLEAR * Math.max(rock.rx, rock.rz);
    nearest = Math.min(nearest, Math.hypot(x - rock.x, z - rock.z) / radius);
  }
  return nearest;
}

// Whether a point is buried in a rock, ignoring the rock an epiphyte is attached to: a leaf
// that would grow into stone is shaded out long before it gets there.
function insideRock(point, host = -1) {
  for (let i = 0; i < ROCKS.length; i++) {
    const rock = ROCKS[i];
    // An epiphyte may lie against the rock it holds onto, but not inside any other.
    const shell = i === host ? 0.84 : 0.92;
    const cy = rockCenterY(rock);
    const radius = shell * Math.max(rock.rx, rock.rz);
    if (
      ((point.x - rock.x) / radius) ** 2 +
        ((point.y - cy) / (shell * rock.ry)) ** 2 +
        ((point.z - rock.z) / radius) ** 2 <
      1
    )
      return true;
  }
  return false;
}

// A point on a rock's upper face, with the face normal, from an offset off its centre.
function rockFace(index, dx, dz) {
  const rock = ROCKS[index];
  const rx = ROCK_FACE * rock.rx,
    ry = ROCK_FACE * rock.ry,
    rz = ROCK_FACE * rock.rz;
  const dy =
    ry * Math.sqrt(Math.max(0.05, 1 - (dx / rx) ** 2 - (dz / rz) ** 2));
  return {
    point: vec(rock.x + dx, rockCenterY(rock) + dy, rock.z + dz),
    normal: vec(dx / rx ** 2, dy / ry ** 2, dz / rz ** 2).normalize(),
  };
}

// ---------------------------------------------------------------------------
// Leaf outlines: half-width as a fraction of the widest point, at ten equal steps from the
// base of the blade to its apex, read back through a Catmull-Rom so the margin stays a
// smooth curve however few rows the blade is built from.
const OUTLINES = {
  // Ovate-cordate: wide across the basal lobes, widest two fifths of the way up, then a
  // long even taper to an acute tip.
  anubias: [0.52, 0.82, 0.95, 1, 1, 0.98, 0.93, 0.85, 0.7, 0.44, 0.04],
  // Broad lanceolate running down into its petiole, shouldered, with a short point.
  echinodorus: [0.11, 0.42, 0.7, 0.88, 0.97, 1, 0.95, 0.85, 0.66, 0.38, 0.02],
  // Lanceolate, drawn out to an acuminate tip.
  crypt: [0.14, 0.46, 0.72, 0.89, 0.98, 1, 0.95, 0.84, 0.63, 0.32, 0.02],
};

function outlineWidth(table, v) {
  const n = table.length - 1;
  const x = clamp01(v) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const t = x - i;
  const y0 = table[i],
    y1 = table[i + 1];
  const ym = i > 0 ? table[i - 1] : 2 * y0 - y1;
  const yp = i + 2 <= n ? table[i + 2] : 2 * y1 - y0;
  return (
    y0 +
    0.5 *
      t *
      (y1 -
        ym +
        t * (2 * ym - 5 * y0 + 4 * y1 - yp + t * (3 * (y0 - y1) + yp - ym)))
  );
}

// A frame that rolls as little as possible along a curve, so a blade or a stalk built on it
// does not twist except where the plant itself twists.
function sweptFrames(curve, count, normal0, extend = 0) {
  const frames = [];
  const speed = curve.getPoint(0.01).distanceTo(curve.getPoint(0)) * 100;
  const start = curve.getPoint(0);
  const first = curve.getTangent(0);
  const normal = normal0.clone();
  let arc = 0;
  let previous = null;
  for (let k = 0; k <= count; k++) {
    const v = -extend + ((1 + extend) * k) / count;
    const point =
      v >= 0
        ? curve.getPoint(v)
        : start.clone().addScaledVector(first, v * speed);
    const tangent = v >= 0 ? curve.getTangent(v) : first.clone();
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-8) normal.crossVectors(tangent, UP);
    normal.normalize();
    if (previous) arc += point.distanceTo(previous);
    previous = point;
    frames.push({
      v,
      point,
      tangent,
      normal: normal.clone(),
      side: new THREE.Vector3().crossVectors(normal, tangent).normalize(),
      arc,
    });
  }
  const zero = extend ? (extend / (1 + extend)) * count : 0;
  const offset = frames[Math.round(zero)].arc;
  for (const frame of frames) frame.arc -= offset;
  return frames;
}

function frameAt(frames, v) {
  const count = frames.length - 1;
  const first = frames[0].v;
  const span = frames[count].v - first;
  const x = clamp01((v - first) / span) * count;
  const i = Math.min(Math.floor(x), count - 1);
  const t = x - i;
  const a = frames[i],
    b = frames[i + 1];
  return {
    point: a.point.clone().lerp(b.point, t),
    tangent: a.tangent.clone().lerp(b.tangent, t).normalize(),
    normal: a.normal.clone().lerp(b.normal, t).normalize(),
    side: a.side.clone().lerp(b.side, t).normalize(),
    arc: a.arc + (b.arc - a.arc) * t,
  };
}

// ---------------------------------------------------------------------------
// A stalk: petiole, rhizome, crown or root. The cross-section is an ellipse wider than it
// is deep, optionally grooved along its upper face and flared into a sheath at the base,
// which is what a petiole leaving a rhizome or a crown actually looks like.
function stalk(
  batch,
  {
    curve,
    root,
    radius,
    color,
    tipColor = null,
    rows,
    cols = 7,
    flat = 1.2,
    groove = 0,
    sheath = 0,
    taper = 0.2,
    knuckle = null,
    compliance,
    distance0 = 0,
    attached = null,
  },
) {
  const length = curve.getLength();
  const frames = sweptFrames(curve, rows, UP);
  const start = batch.positions.length / 3;
  const tint = new THREE.Color();
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const { point, normal, side } = frames[i];
    const swell = sheath * Math.exp(-((t / 0.19) ** 2));
    // A rhizome is knuckled: it swells at every node it has carried a leaf from.
    const node = knuckle
      ? 1 + knuckle.depth * Math.cos(t * knuckle.count * TAU)
      : 1;
    const scale = radius * (1 - taper * t) * node;
    const rx = scale * (flat + 1.5 * swell);
    const ry = scale * (1 + 0.35 * swell);
    const strand = attached ?? stemStrand(curve, t, length, compliance);
    const carry = { ...strand, distance: distance0 + t * length };
    tint.copy(color);
    if (tipColor) tint.lerp(tipColor, t);
    for (let j = 0; j <= cols; j++) {
      const angle = (j / cols) * TAU;
      const ca = Math.cos(angle),
        sa = Math.sin(angle);
      let depth = ry * sa;
      if (groove && sa > 0)
        depth -= groove * ry * Math.max(0, 1 - (ca / 0.72) ** 2);
      const p = point
        .clone()
        .addScaledVector(side, rx * ca)
        .addScaledVector(normal, depth);
      // uv.x puts the shader's midrib highlight along the top and bottom of the stalk and
      // its edge shading down the flanks; uv.y barely moves, so the venation reads as the
      // faint lengthwise ribbing a petiole has rather than as cross-banding.
      batch.vertex(
        p,
        [0.5 - 0.42 * ca, 0.0064 + t * 0.008],
        tint,
        root,
        carry,
        0,
      );
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  const last = frames[rows];
  return {
    length,
    tip: last.point,
    tangent: last.tangent,
    normal: last.normal,
    strand: {
      ...stemStrand(curve, 1, length, compliance),
      distance: distance0 + length,
    },
  };
}

// Mesh density follows the blade: a young leaf, or one in the midground, does not need the
// rows a foreground leaf needs to hold a smooth margin.
function density(size) {
  return {
    rows: Math.max(12, Math.min(22, Math.round(8 + 14 * size))),
    cols: 2 * Math.max(4, Math.min(7, Math.round(2 + 5 * size))),
  };
}

// ---------------------------------------------------------------------------
// A blade. The midrib is a cubic that leaves the petiole along its tangent and lets the
// apex hang a little; the lamina is the surface swept across it.
//
// The vein pattern comes from the shared material, which draws it at a fixed slope in uv
// space. Giving uv.y a span of one vein period per vein pair therefore lands the veins
// where the species keeps them: a broad leaf gets steep pinnate veins, a narrow one the
// shallow near-parallel veins of a Cryptocoryne or an Echinodorus.
const VEIN_PERIOD = TAU / 155;

function bladeSurface(batch, spec) {
  const {
    base,
    tangent,
    face,
    length,
    width,
    outline,
    root,
    color,
    distance0,
    parent = null,
    compliance = 0.3,
    thin = 0.2,
    rows = 20,
    cols = 12,
    veinPairs = 9,
    arch = 0.06,
    droop = 0.16,
    sweep = 0,
    cordate = null,
    cup = 0.2,
    keel = 0.03,
    twist = 0,
    undulate = 0,
    undulateWaves = 5,
    bullate = 0,
    furl = 0,
    age = 0.5,
    bites = [],
    holes = [],
    spots = [],
    seed = 0,
  } = spec;

  const side0 = new THREE.Vector3().crossVectors(face, tangent).normalize();
  const curve = new THREE.CubicBezierCurve3(
    base.clone(),
    base
      .clone()
      .addScaledVector(tangent, length * 0.34)
      .addScaledVector(face, length * arch),
    base
      .clone()
      .addScaledVector(tangent, length * 0.72)
      .addScaledVector(UP, -length * droop * 0.3)
      .addScaledVector(side0, length * sweep * 0.45),
    base
      .clone()
      .addScaledVector(tangent, length)
      .addScaledVector(UP, -length * droop)
      .addScaledVector(side0, length * sweep),
  );
  const reach = cordate ? cordate.reach : 0;
  const frames = sweptFrames(curve, rows * 3 + 6, face, reach);
  const start = batch.positions.length / 3;

  const brown = new THREE.Color("#5f4c1c");
  const algae = new THREE.Color("#16180d");
  const tint = new THREE.Color();
  const bite = (v, u) => {
    let loss = 0;
    for (const b of bites)
      if (u * b.side > 0)
        loss += b.depth * Math.max(0, 1 - Math.abs(v - b.v) / b.span) ** 0.55;
    return Math.min(0.85, loss);
  };

  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    const half = width * outlineWidth(outline, v);
    const basal = cordate ? clamp01(1 - v / cordate.span) ** 1.45 : 0;
    const roll = furl * smoothstep(0.04, 0.42, v);
    const attach = smoothstep(0, 0.16, v);
    // The margin waves die out where the lamina is held: at the base by the petiole and at
    // the apex by the midrib running into it.
    const wave =
      undulate *
      (Math.sin(v * undulateWaves * TAU + seed * 5.3) +
        0.42 * Math.sin(v * undulateWaves * 1.73 * TAU + seed * 11.1)) *
      Math.sin(Math.PI * v) ** 0.7;
    const pucker = Math.sin(v * veinPairs * Math.PI + 1.1 + seed * 2.1);
    const uvy = 0.02 + v * veinPairs * VEIN_PERIOD;
    for (let j = 0; j <= cols; j++) {
      const u = (2 * j) / cols - 1;
      const edge = half * (1 - bite(v, u));
      const pinch = bullate * width * Math.cos(u * 7.2) * (1 - u ** 4);
      const lobe = Math.abs(u) ** 1.3 * (1 - 0.32 * Math.abs(u) ** 8);
      const frame = frameAt(frames, v - reach * basal * lobe);
      const spin = twist * v;
      const side = frame.side
        .clone()
        .multiplyScalar(Math.cos(spin))
        .addScaledVector(frame.normal, Math.sin(spin));
      const normal = frame.normal
        .clone()
        .multiplyScalar(Math.cos(spin))
        .addScaledVector(frame.side, -Math.sin(spin));
      let across = u * edge;
      let out = 0;
      if (roll > 0.02) {
        // A leaf that has not finished opening is still rolled about its midrib: the
        // lamina keeps its width but wraps it into an arc.
        const k = (roll * Math.PI) / Math.max(edge, 1e-4);
        across = Math.sin(k * across) / k;
        out = (1 - Math.cos(k * u * edge)) / k;
      } else {
        out =
          cup * edge * u * u +
          wave * edge * Math.abs(u) ** 2.2 +
          pucker * pinch;
        if (cordate) out += cordate.lift * edge * u * u * basal;
      }
      // One surface carries both sides of the midrib: a groove above, a raised rib below.
      out -= keel * width * Math.exp(-((u / 0.11) ** 2));
      const p = frame.point
        .clone()
        .addScaledVector(side, across)
        .addScaledVector(normal, out);

      // The blade's base is held by the petiole and answers the current with it; the free
      // lamina bends along its own face. Blending the two over the first sixth of the
      // blade keeps the junction watertight while it moves.
      const direction = parent
        ? parent.direction.clone().lerp(normal, attach)
        : normal.clone();
      if (direction.lengthSq() < 1e-6) direction.copy(normal);
      const strand = {
        direction: direction.normalize(),
        tangent: parent
          ? parent.tangent.clone().lerp(frame.tangent, attach).normalize()
          : frame.tangent,
        distance: distance0 + frame.arc,
        compliance: parent
          ? parent.compliance + (compliance - parent.compliance) * attach
          : compliance,
      };

      tint.copy(color);
      const blotch =
        0.93 + 0.14 * noise(v * 4.3 + seed * 7.1, u * 2.1, seed * 3.7);
      const vein =
        0.5 + 0.5 * Math.cos((uvy - Math.abs(j / cols - 0.5) * 0.32) * 155);
      tint.multiplyScalar(
        blotch *
          (0.84 + 0.16 * smoothstep(0, 0.28, v)) *
          (0.9 + 0.1 * vein ** 5),
      );
      if (age > 0.78)
        tint.lerp(brown, smoothstep(0.66, 1, v) * (age - 0.78) * 1.5);
      for (const spot of spots) {
        const d = Math.hypot((v - spot.v) * length, (u - spot.u) * width * 1.3);
        tint.lerp(algae, 0.6 * Math.max(0, 1 - d / spot.r) ** 0.8);
      }
      batch.vertex(
        p,
        [j / cols, uvy],
        tint,
        root,
        strand,
        thin * (1 + 0.5 * Math.abs(u) ** 3),
      );
      if (i < rows && j < cols) {
        // A snail hole is a pinhole whatever the leaf: one or two faces of the mesh.
        const cv = v + 0.5 / rows,
          cu = u + 1 / cols;
        let open = true;
        for (const hole of holes)
          if (
            Math.hypot((cv - hole.v) * length, (cu - hole.u) * width) <
            (0.9 * width) / cols
          )
            open = false;
        if (open) {
          const k = start + i * (cols + 1) + j;
          batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wear. Old leaves carry algae along the margins where flow is slowest, snail pinholes and
// torn edges; young ones are clean.
function wear(age, count) {
  const spots = [],
    holes = [],
    bites = [];
  if (age < 0.45) return { spots, holes, bites };
  const load = (age - 0.45) / 0.55;
  for (let i = 0; i < Math.round(load * count * 2.4); i++)
    spots.push({
      v: between(0.15, 0.97),
      u: (rand() < 0.5 ? -1 : 1) * between(0.5, 1.05),
      r: between(0.02, 0.07),
    });
  if (rand() < load * 0.45) {
    const hole = { v: between(0.3, 0.85), u: between(-0.7, 0.7) };
    holes.push(hole);
    spots.push({ ...hole, r: 0.055 });
  }
  if (rand() < load * 0.6)
    bites.push({
      v: between(0.35, 0.78),
      side: rand() < 0.5 ? -1 : 1,
      depth: between(0.08, 0.22),
      span: between(0.06, 0.15),
    });
  return { spots, holes, bites };
}

// A blade can turn about its midrib but not off it. It rolls to the attitude that gives its
// face the most light: from overhead, plus whatever comes across the open water in front of
// the clump, where nothing shades it. A crowded leaf settles wherever there is room instead.
function faceToLight(lamina, upright, open, jitter) {
  const side = new THREE.Vector3().crossVectors(lamina, upright);
  const preferred = UP.clone().multiplyScalar(0.6).addScaledVector(open, 0.9);
  const theta = Math.atan2(preferred.dot(side), preferred.dot(upright));
  return spun(upright, lamina, theta + jitter);
}

// Rotate `v` about a unit axis.
function spun(v, axis, angle) {
  return v.clone().applyAxisAngle(axis, angle);
}

// ---------------------------------------------------------------------------
// Anubias barteri. A creeping rhizome, never buried, with thick roots gripping whatever it
// lies on and stiff petioles leaving it left and right in a loose spiral. The leaves are
// the darkest in the tank, leathery enough to be opaque, and held nearly flat so the
// overhead light rakes across them.
function anubias(
  batch,
  {
    anchor,
    heading,
    blade: bladeLength,
    leaves,
    surface = (x, z) => groundHeight(x, z),
    faceNormal = UP,
    host = -1,
    hue = 0.33,
    open = vec(0, 0, 1),
  },
) {
  const rocky = host >= 0;
  const root = anchor.clone();
  const radius = 0.062 * bladeLength;
  const step = 0.165 * bladeLength;
  const along = vec(Math.cos(heading), 0, Math.sin(heading));
  const drift = between(-0.5, 0.5);
  const spine = [];
  for (let k = 0; k <= 4; k++) {
    const t = k / 4;
    const p = anchor
      .clone()
      .addScaledVector(along, step * leaves * (t - 0.25))
      .addScaledVector(
        vec(-along.z, 0, along.x),
        drift * step * leaves * t * t,
      );
    p.y = surface(p.x, p.z) + radius * 0.8 + 0.04 * t * bladeLength;
    spine.push(p);
  }
  const rhizomeCurve = new THREE.CatmullRomCurve3(spine);
  const rhizome = stalk(batch, {
    curve: rhizomeCurve,
    root,
    radius,
    rows: 16,
    cols: 9,
    flat: 1.05,
    taper: 0.2,
    knuckle: { count: leaves, depth: 0.14 },
    color: new THREE.Color().setHSL(0.22, 0.26, 0.11),
    tipColor: new THREE.Color().setHSL(0.27, 0.4, 0.14),
    compliance: 0.02,
  });
  const frames = sweptFrames(rhizomeCurve, 24, faceNormal);

  // Thick roots leave the underside of the rhizome and hold onto the sand or, on a rock,
  // flatten out and run down the face.
  for (let k = 0; k < (rocky ? 7 : 5); k++) {
    const t = between(0.06, 0.94);
    const frame = frameAt(frames, t);
    const out = spun(frame.normal, frame.tangent, between(2.0, 4.3));
    const grip = rocky ? between(0.4, 0.85) : between(0.2, 0.4);
    const points = [frame.point.clone().addScaledVector(out, radius * 0.6)];
    let p = points[0].clone();
    let direction = out.clone().addScaledVector(UP, -0.8).normalize();
    for (let s = 1; s <= 3; s++) {
      p = p
        .clone()
        .addScaledVector(direction, (grip * bladeLength) / 3)
        .addScaledVector(UP, -0.03 * bladeLength);
      const floor = surface(p.x, p.z);
      if (rocky) p.y = Math.max(p.y, floor + 0.015);
      else p.y = Math.min(p.y, floor + (s === 3 ? -0.1 : 0.02) * bladeLength);
      points.push(p.clone());
      direction = direction.addScaledVector(UP, -0.45).normalize();
    }
    stalk(batch, {
      curve: new THREE.CatmullRomCurve3(points),
      root,
      radius: radius * between(0.22, 0.34),
      rows: 6,
      cols: 5,
      flat: rocky ? 2.1 : 1.1,
      taper: 0.45,
      color: new THREE.Color().setHSL(0.1, 0.2, 0.19),
      tipColor: new THREE.Color().setHSL(0.09, 0.17, 0.11),
      compliance: 0,
      attached: { direction: UP, tangent: UP, distance: 0, compliance: 0 },
    });
  }

  for (let k = 0; k < leaves; k++) {
    const t = clamp01((k + 0.55) / leaves);
    const age = 1 - t;
    const frame = frameAt(frames, t);
    const young = age < 0.22;
    const size =
      bladeLength * (young ? between(0.45, 0.62) : between(0.82, 1.06));
    const stalkLength =
      size * (young ? between(0.4, 0.75) : between(0.6, 1.15));
    // Leaves alternate to either side of the creeping rhizome, the angle drifting round it
    // so the clump fills in rather than forming a flat row. A leaf that would grow into a
    // rock finds its way round it instead.
    let emerge = null;
    let outward = null;
    for (let attempt = 0; attempt < 4 && !outward; attempt++) {
      const swing =
        (k % 2 ? 1 : -1) *
          (between(0.3, rocky ? 0.75 : 1.1) + attempt * (rocky ? 0.4 : 0.8)) +
        Math.sin(k * 1.9) * 0.3;
      emerge = spun(frame.normal, frame.tangent, swing).normalize();
      const flat = emerge
        .clone()
        .addScaledVector(UP, -emerge.dot(UP))
        .normalize();
      if (flat.lengthSq() < 0.05)
        flat.crossVectors(frame.tangent, UP).multiplyScalar(Math.sign(swing));
      // An old leaf has arched further over, so its blade is carried lower and further out.
      const lift = between(0.42, 0.85) + 0.45 * (1 - age) ** 1.4;
      const candidate = flat
        .clone()
        .multiplyScalar(Math.cos(lift))
        .addScaledVector(UP, Math.sin(lift))
        .normalize();
      const stem = frame.point
        .clone()
        .addScaledVector(emerge, stalkLength * 0.3)
        .addScaledVector(candidate, stalkLength * 0.78);
      const mid = stem.clone().addScaledVector(candidate, size * 0.45);
      const tip = stem.clone().addScaledVector(candidate, size * 0.9);
      if (
        attempt === 3 ||
        (!insideRock(stem, host) &&
          !insideRock(mid, host) &&
          !insideRock(tip, host))
      )
        outward = candidate;
    }
    const node = frame.point.clone().addScaledVector(emerge, radius * 0.7);
    const petiole = stalk(batch, {
      curve: new THREE.CubicBezierCurve3(
        node,
        node.clone().addScaledVector(emerge, stalkLength * 0.44),
        node
          .clone()
          .addScaledVector(emerge, stalkLength * 0.34)
          .addScaledVector(outward, stalkLength * 0.42),
        node
          .clone()
          .addScaledVector(emerge, stalkLength * 0.3)
          .addScaledVector(outward, stalkLength * 0.78),
      ),
      root,
      radius: 0.026 * size,
      rows: 9,
      cols: 7,
      flat: 1.25,
      groove: 0.45,
      sheath: 0.7,
      taper: 0.14,
      color: new THREE.Color().setHSL(
        hue - 0.04,
        between(0.36, 0.5),
        between(0.085, 0.12),
      ),
      compliance: 0.16,
      distance0: rhizome.length * t,
    });
    // The lamina does not carry straight on from the petiole: it is hinged away from it,
    // more so the more steeply the petiole is held, which is how a leaf on an upright stalk
    // still turns its face to the light.
    const hinge = new THREE.Vector3()
      .crossVectors(UP, petiole.tangent)
      .normalize();
    const lamina = spun(
      petiole.tangent,
      hinge,
      0.3 + 0.55 * Math.max(0, petiole.tangent.y),
    );
    const upright = UP.clone()
      .addScaledVector(lamina, -UP.dot(lamina))
      .normalize();
    const face =
      rand() < 0.3
        ? spun(upright, lamina, between(-1.5, 1.5))
        : faceToLight(lamina, upright, open, between(-0.8, 0.8));
    const canopy =
      0.66 +
      0.34 *
        smoothstep(
          0.25,
          1.9,
          petiole.tip.y - groundHeight(petiole.tip.x, petiole.tip.z),
        );
    const shade = (0.84 + 0.3 * t) * canopy;
    const damage = wear(age, young ? 0 : 3);
    bladeSurface(batch, {
      base: petiole.tip,
      tangent: lamina,
      face,
      length: size,
      width: size * between(0.44, 0.5),
      outline: OUTLINES.anubias,
      root,
      color: new THREE.Color().setHSL(
        hue + between(-0.03, 0.035) - (young ? 0.035 : 0),
        between(0.55, 0.78),
        (young ? between(0.14, 0.19) : between(0.07, 0.15)) * shade,
      ),
      distance0: petiole.strand.distance,
      parent: petiole.strand,
      compliance: 0.27,
      thin: young ? 0.28 : 0.1,
      ...density(size),
      veinPairs: 12,
      arch: between(0.03, 0.1),
      droop: between(0.03, 0.12),
      sweep: between(-0.12, 0.12),
      cordate: { reach: between(0.12, 0.18), span: 0.28, lift: 0.25 },
      cup: between(0.26, 0.46),
      keel: 0.02,
      twist: between(-0.1, 0.1),
      undulate: between(0.02, 0.05),
      undulateWaves: 2,
      bullate: 0.03,
      furl: young && rand() < 0.6 ? between(0.5, 0.85) : 0,
      age,
      seed: rand(),
      ...damage,
    });
  }
}

// The roots a rosette shows where it meets the sand: pale, creeping just under the surface
// so only their backs are visible, the way a crown's anchor roots sit in fine gravel.
function crownRoots(batch, { x, z, root, blade: bladeLength, count }) {
  for (let k = 0; k < count; k++) {
    const a = between(0, TAU);
    const reach = between(0.3, 0.62) * bladeLength;
    const point = (f, sink) => {
      const px = x + Math.cos(a) * reach * f,
        pz = z + Math.sin(a) * reach * f;
      return vec(px, groundHeight(px, pz) - sink * bladeLength, pz);
    };
    stalk(batch, {
      curve: new THREE.CatmullRomCurve3([
        point(0, 0.02),
        point(0.45, 0.035),
        point(0.8, 0.06),
        point(1, 0.14),
      ]),
      root,
      radius: 0.016 * bladeLength,
      rows: 6,
      cols: 5,
      flat: 1.15,
      taper: 0.45,
      color: new THREE.Color().setHSL(0.11, 0.16, 0.2),
      tipColor: new THREE.Color().setHSL(0.1, 0.14, 0.11),
      compliance: 0,
      attached: { direction: UP, tangent: UP, distance: 0, compliance: 0 },
    });
  }
}

// ---------------------------------------------------------------------------
// Echinodorus. A rosette on a short crown at the sand, broad lanceolate blades folded along
// the midrib and carried up and out on ribbed petioles; the youngest leaves stand almost
// upright in the middle, the oldest lie nearly flat around the outside.
function echinodorus(
  batch,
  { x, z, blade: bladeLength, leaves, hue = 0.26, open = vec(0, 0, 1) },
) {
  const ground = groundHeight(x, z);
  const root = vec(x, ground - 0.04, z);
  const crownTop = vec(x, ground + 0.1 * bladeLength, z);
  stalk(batch, {
    curve: new THREE.CatmullRomCurve3([
      vec(x, ground - 0.16 * bladeLength, z),
      crownTop.clone().lerp(root, 0.45),
      crownTop,
    ]),
    root,
    radius: 0.062 * bladeLength,
    rows: 5,
    cols: 8,
    flat: 1,
    taper: 0.3,
    color: new THREE.Color().setHSL(0.1, 0.28, 0.1),
    tipColor: new THREE.Color().setHSL(0.19, 0.34, 0.09),
    compliance: 0.03,
  });
  crownRoots(batch, { x, z, root, blade: bladeLength, count: 3 });
  for (let k = 0; k < leaves; k++) {
    const t = (k + 0.5) / leaves;
    const age = 1 - t;
    const angle = k * 2.39996 + between(-0.35, 0.35);
    // Older leaves sit lower on the crown and lean out much further.
    const lift = between(1.32, 1.5) - 0.95 * age * between(0.7, 1.15);
    const flat = vec(Math.cos(angle), 0, Math.sin(angle));
    const outward = flat
      .clone()
      .multiplyScalar(Math.cos(lift))
      .addScaledVector(UP, Math.sin(lift))
      .normalize();
    const young = age < 0.18;
    const size =
      bladeLength * (young ? between(0.45, 0.62) : between(0.8, 1.08));
    const stalkLength = size * between(0.4, 0.68);
    const node = vec(
      x + Math.cos(angle) * 0.06 * bladeLength,
      ground + between(0.02, 0.12) * bladeLength,
      z + Math.sin(angle) * 0.06 * bladeLength,
    );
    const rise = UP.clone()
      .multiplyScalar(2.2)
      .addScaledVector(flat, 0.5)
      .normalize();
    const petiole = stalk(batch, {
      curve: new THREE.CubicBezierCurve3(
        node,
        node.clone().addScaledVector(rise, stalkLength * 0.5),
        node
          .clone()
          .addScaledVector(rise, stalkLength * 0.55)
          .addScaledVector(outward, stalkLength * 0.34),
        node
          .clone()
          .addScaledVector(rise, stalkLength * 0.42)
          .addScaledVector(outward, stalkLength * 0.72),
      ),
      root,
      radius: 0.023 * size,
      rows: 9,
      cols: 7,
      flat: 1.4,
      groove: 0.55,
      sheath: 0.85,
      taper: 0.1,
      color: new THREE.Color().setHSL(
        hue - 0.045,
        between(0.38, 0.52),
        between(0.075, 0.115),
      ),
      compliance: 0.26,
    });
    const hinge = new THREE.Vector3()
      .crossVectors(UP, petiole.tangent)
      .normalize();
    const lamina = spun(
      petiole.tangent,
      hinge,
      0.24 + 0.5 * Math.max(0, petiole.tangent.y),
    );
    const upright = UP.clone()
      .addScaledVector(lamina, -UP.dot(lamina))
      .normalize();
    const face =
      rand() < 0.14
        ? spun(upright, lamina, between(-1.5, 1.5))
        : faceToLight(lamina, upright, open, between(-0.5, 0.5));
    const damage = wear(age * 0.85, 2);
    bladeSurface(batch, {
      base: petiole.tip,
      tangent: lamina,
      face,
      length: size,
      width: size * between(0.15, 0.19),
      outline: OUTLINES.echinodorus,
      root,
      color: new THREE.Color().setHSL(
        hue + between(-0.02, 0.03) - (young ? 0.02 : 0),
        between(0.6, 0.8),
        (young ? between(0.17, 0.23) : between(0.11, 0.19)) * (0.85 + 0.3 * t),
      ),
      distance0: petiole.strand.distance,
      parent: petiole.strand,
      compliance: 0.4,
      thin: 0.32,
      ...density(size * 0.85),
      veinPairs: 6,
      arch: between(0.04, 0.12),
      droop: between(0.12, 0.3),
      sweep: between(-0.15, 0.15),
      cup: between(0.22, 0.42),
      keel: 0.03,
      twist: between(-0.25, 0.25),
      undulate: between(0.05, 0.12),
      undulateWaves: 2,
      bullate: 0.02,
      furl: young && rand() < 0.5 ? between(0.45, 0.8) : 0,
      age,
      seed: rand(),
      ...damage,
    });
  }
}

// ---------------------------------------------------------------------------
// Cryptocoryne wendtii. A low rosette of olive to bronze lanceolate leaves on slender
// petioles, the margins strongly waved and the lamina puckered between its veins.
function crypt(
  batch,
  { x, z, blade: bladeLength, leaves, hue = 0.16, open = vec(0, 0, 1) },
) {
  const ground = groundHeight(x, z);
  const root = vec(x, ground - 0.05, z);
  const bronze = between(0, 1);
  stalk(batch, {
    curve: new THREE.CatmullRomCurve3([
      vec(x, ground - 0.2 * bladeLength, z),
      vec(x, ground - 0.02 * bladeLength, z),
      vec(x, ground + 0.1 * bladeLength, z),
    ]),
    root,
    radius: 0.055 * bladeLength,
    rows: 5,
    cols: 7,
    flat: 1,
    taper: 0.4,
    color: new THREE.Color().setHSL(0.09, 0.3, 0.09),
    tipColor: new THREE.Color().setHSL(0.14, 0.36, 0.085),
    compliance: 0.03,
  });
  crownRoots(batch, { x, z, root, blade: bladeLength, count: 2 });
  for (let k = 0; k < leaves; k++) {
    const t = (k + 0.5) / leaves;
    const age = 1 - t;
    const angle = k * 2.39996 + between(-0.4, 0.4);
    const lift = between(1.15, 1.4) - 1.0 * age * between(0.75, 1.2);
    const flat = vec(Math.cos(angle), 0, Math.sin(angle));
    const outward = flat
      .clone()
      .multiplyScalar(Math.cos(lift))
      .addScaledVector(UP, Math.sin(lift))
      .normalize();
    const young = age < 0.2;
    const size =
      bladeLength * (young ? between(0.4, 0.58) : between(0.78, 1.06));
    const stalkLength = size * between(0.42, 0.72);
    const node = vec(
      x + Math.cos(angle) * 0.05 * bladeLength,
      ground + between(0.01, 0.1) * bladeLength,
      z + Math.sin(angle) * 0.05 * bladeLength,
    );
    const rise = UP.clone()
      .multiplyScalar(2)
      .addScaledVector(flat, 0.6)
      .normalize();
    const petiole = stalk(batch, {
      curve: new THREE.CubicBezierCurve3(
        node,
        node.clone().addScaledVector(rise, stalkLength * 0.5),
        node
          .clone()
          .addScaledVector(rise, stalkLength * 0.52)
          .addScaledVector(outward, stalkLength * 0.36),
        node
          .clone()
          .addScaledVector(rise, stalkLength * 0.38)
          .addScaledVector(outward, stalkLength * 0.76),
      ),
      root,
      radius: 0.021 * size,
      rows: 8,
      cols: 6,
      flat: 1.15,
      groove: 0.35,
      sheath: 0.7,
      taper: 0.12,
      color: new THREE.Color().setHSL(
        0.115,
        between(0.3, 0.46),
        between(0.08, 0.115),
      ),
      compliance: 0.32,
    });
    const hinge = new THREE.Vector3()
      .crossVectors(UP, petiole.tangent)
      .normalize();
    const lamina = spun(
      petiole.tangent,
      hinge,
      0.26 + 0.5 * Math.max(0, petiole.tangent.y),
    );
    const upright = UP.clone()
      .addScaledVector(lamina, -UP.dot(lamina))
      .normalize();
    const face =
      rand() < 0.18
        ? spun(upright, lamina, between(-1.5, 1.5))
        : faceToLight(lamina, upright, open, between(-0.55, 0.55));
    const damage = wear(age * 0.9, 2);
    bladeSurface(batch, {
      base: petiole.tip,
      tangent: lamina,
      face,
      length: size,
      width: size * between(0.115, 0.145),
      outline: OUTLINES.crypt,
      root,
      color: new THREE.Color().setHSL(
        hue + between(-0.035, 0.05) * (1 - bronze) - 0.03 * bronze,
        between(0.42, 0.66),
        (young ? between(0.12, 0.17) : between(0.065, 0.115)) *
          (0.85 + 0.3 * t),
      ),
      distance0: petiole.strand.distance,
      parent: petiole.strand,
      compliance: 0.48,
      thin: 0.35,
      ...density(size * 0.9),
      veinPairs: 5,
      arch: between(0.05, 0.13),
      droop: between(0.14, 0.34),
      sweep: between(-0.2, 0.2),
      cup: between(0.14, 0.3),
      keel: 0.025,
      twist: between(-0.35, 0.35),
      undulate: between(0.14, 0.26),
      undulateWaves: between(2.5, 4),
      bullate: 0.03,
      furl: young && rand() < 0.55 ? between(0.4, 0.8) : 0,
      age,
      seed: rand(),
      ...damage,
    });
  }
}

// ---------------------------------------------------------------------------
// The composition: a dark Anubias colony massed at bottom left in front of and over the
// rocks, a lighter Echinodorus group at bottom right, and Cryptocoryne through the
// midground and along the front glass.
export function plantForeground(batch) {
  // A colony of Anubias rhizomes on the sand in the left corner, the front row low and
  // spreading toward the glass, the back row taller where the substrate rises behind the
  // stones. It stops short of the stones so they and the sand at their foot stay in view,
  // and short of the glass so a strip of open sand runs under it.
  // x, z, blade length, leaves, rhizome heading.
  for (const [x, z, blade, leaves, heading] of [
    [-9.15, 0.85, 0.7, 9, 0.5],
    [-8.3, 0.6, 0.84, 10, -0.35],
    [-7.4, 0.9, 0.62, 8, 1.15],
    [-9.3, -0.2, 0.8, 9, 0.15],
    [-8.4, -0.45, 0.95, 10, 0.95],
    [-7.35, -0.3, 0.74, 8, -0.8],
    [-9.1, -1.3, 0.84, 10, 0.35],
    [-8.1, -1.5, 0.92, 10, 1.55],
    [-9.2, -2.3, 0.78, 9, 0.1],
    [-8.2, -2.5, 0.88, 9, 1.9],
    [-7.3, -2.9, 0.7, 8, 2.5],
  ]) {
    anubias(batch, {
      anchor: vec(x, 0, z),
      heading,
      blade,
      leaves,
      hue: between(0.285, 0.325),
      open: vec(-0.55, 0, 1).normalize(),
    });
  }
  // Epiphytes: the same species gripping a rock face, which is where it grows in a river.
  // They creep over the low left companion, one sits on the back of the secondary stone's
  // crown so its leaves hang behind the face rather than across it, and one small plant
  // sits on the right companion. rock index, offset from its centre, blade length, leaves,
  // heading.
  for (const [index, dx, dz, blade, leaves, heading] of [
    [3, -0.55, -0.2, 1.0, 7, 1.0],
    [3, -0.1, -0.45, 0.9, 6, 2.5],
    [3, -0.35, 0.35, 0.82, 6, 0.3],
    [1, -0.6, -0.45, 0.95, 6, 2.2],
    [2, -0.5, 0.5, 0.62, 4, 2.2],
  ]) {
    const face = rockFace(index, dx, dz);
    anubias(batch, {
      anchor: face.point,
      heading,
      blade,
      leaves,
      host: index,
      faceNormal: face.normal,
      surface: (px, pz) =>
        rockFace(index, px - ROCKS[index].x, pz - ROCKS[index].z).point.y,
      hue: between(0.285, 0.325),
      open: vec(index === 2 ? 0.5 : -0.45, 0, 1).normalize(),
    });
  }
  // Echinodorus group in the right corner, beyond the main stone and stepping down toward
  // the glass, set back so open sand runs in front of it.
  for (const [x, z, blade, leaves] of [
    [7.35, 0.4, 1.6, 11],
    [8.3, -0.3, 1.35, 9],
    [6.9, 1.0, 1.05, 8],
    [8.75, 0.7, 0.95, 8],
    [7.9, 1.25, 0.7, 6],
  ]) {
    echinodorus(batch, {
      x,
      z,
      blade,
      leaves,
      hue: between(0.235, 0.265),
      open: vec(0.5, 0, 1).normalize(),
    });
  }
  // Cryptocoryne wendtii in its green and bronze forms, planted the way crypts are bought
  // and set: in small uneven groups. Two groups at the foot of the left stones, one plant
  // at the right edge of the channel, and groups along either bank in the midground where
  // the sand rises toward the grass. None stand in the channel or on the open sand at the
  // glass. x, z, blade length, leaves, hue.
  const BRONZE = 0.13,
    GREEN = 0.27;
  for (const [x, z, blade, leaves, hue] of [
    [-7.0, 1.15, 0.8, 7, BRONZE],
    [-6.55, 1.45, 0.6, 6, BRONZE],
    [-5.15, 1.3, 0.66, 7, GREEN],
    [-4.35, 1.2, 0.6, 6, GREEN],
    [-3.75, 1.45, 0.52, 6, GREEN],
    [3.9, 2.0, 0.5, 5, BRONZE],
    [9.35, -1.35, 0.72, 7, GREEN],
    [-2.75, -2.25, 1.0, 9, BRONZE],
    [-1.85, -3.05, 0.9, 8, BRONZE],
    [-0.35, -3.3, 1.05, 8, GREEN],
    [-3.85, -2.75, 0.85, 7, BRONZE],
    [2.9, -2.9, 0.8, 7, GREEN],
    [3.95, -2.4, 1.15, 9, BRONZE],
    [5.2, -2.85, 0.9, 7, BRONZE],
  ]) {
    if (rockClearance(x, z) < 1) continue;
    crypt(batch, {
      x,
      z,
      blade,
      leaves,
      hue: hue + between(-0.02, 0.02),
      open: vec(x * 0.06, 0, 1).normalize(),
    });
  }
}
