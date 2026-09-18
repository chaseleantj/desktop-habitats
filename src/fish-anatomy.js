import * as THREE from "three";
import { waterLitShader } from "./water.js";

// Bloodfin tetra, Aphyocharax anisitsi — the species behind the reference photograph:
// a small silvery characin whose flank carries a blue-green guanine sheen and whose
// caudal, anal, dorsal, pelvic and adipose fins are blood red at the base. Every
// dimension below is derived from the published morphometrics as a fraction of
// standard length (snout tip to hypural plate) so the whole fish stays in proportion
// if one measure is retuned:
//
//   standard length 0.645 (a 40 mm adult)   greatest depth 29% SL, at the dorsal origin
//   head 27% SL, eye 39% of head length     greatest width 12.6% SL (width/depth 0.43)
//   dorsal origin 52% SL, base 11% SL       anal origin 60% SL, base 26% SL
//   pelvic origin 46% SL                    adipose fin 84% SL
//   caudal peduncle depth 11% SL            caudal lobes 27% SL, deeply forked
//
// Forward axis is +X: the snout is at x = 0.35, the caudal lobes end near x = -0.44,
// the spine runs along y = 0, z = 0 and the geometry is symmetric in z. Part ids
// (attribute aPart): 0 body, 1 caudal, 2 dorsal, 3 anal, 4 right pectoral, 5 left
// pectoral, 6 pelvic, 7 iris, 8 pupil, 9 oral slit, 10 corneal rim, 11 upper lip,
// 12 adipose. aFinProgress runs 0 at a fin's hinge to 1 at its free edge. The
// swimming deformation in fish.js bends this geometry about the vertical axis and
// supplies vSkinPoint (rest position), vFishUV and vFishPart to the skin shader.

const TAU = Math.PI * 2;
// Exported because behaviour needs them: a fish eats with its snout, not its centre, and
// every feeding distance in fish.js is quoted in body lengths.
export const SNOUT_X = 0.35;
export const STANDARD_LENGTH = 0.645;
const HYPURAL_X = SNOUT_X - STANDARD_LENGTH;

// Cross-sections: x, dorsal y, ventral y, half width, then the fullness exponents of
// the upper and lower half. Fullness 2 is an ellipse; below 2 the section comes to a
// ridge, which is how the dorsum and the caudal peduncle are actually shaped, and
// above 2 it rounds out, as the skull and the belly do.
const STATIONS = [
  [0.35, -0.002, -0.009, 0.003, 2.4, 2.5],
  [0.3425, 0.0085, -0.0205, 0.009, 2.4, 2.5],
  [0.332, 0.0225, -0.03, 0.0165, 2.4, 2.5],
  [0.315, 0.0375, -0.042, 0.0255, 2.35, 2.5],
  [0.295, 0.05, -0.0525, 0.032, 2.3, 2.5],
  [0.272, 0.06, -0.061, 0.0358, 2.3, 2.45],
  [0.248, 0.0672, -0.069, 0.0385, 2.25, 2.4],
  [0.22, 0.0722, -0.077, 0.0405, 2.15, 2.4],
  [0.19, 0.0762, -0.085, 0.0408, 2.05, 2.35],
  [0.166, 0.0782, -0.0908, 0.04, 2.0, 2.3],
  [0.13, 0.0808, -0.0958, 0.0382, 2.1, 2.25],
  [0.09, 0.0832, -0.1, 0.036, 2.05, 2.2],
  [0.045, 0.0848, -0.1022, 0.0342, 2.0, 2.15],
  [0.01, 0.0852, -0.1028, 0.0324, 1.95, 2.1],
  [-0.04, 0.0812, -0.0998, 0.0292, 1.88, 1.9],
  [-0.09, 0.073, -0.09, 0.0252, 1.78, 1.78],
  [-0.14, 0.062, -0.0748, 0.0208, 1.66, 1.66],
  [-0.19, 0.049, -0.057, 0.016, 1.52, 1.54],
  [-0.235, 0.04, -0.043, 0.0118, 1.46, 1.48],
  [-0.27, 0.0358, -0.0358, 0.0088, 1.42, 1.42],
  [HYPURAL_X, 0.0336, -0.033, 0.005, 1.4, 1.4],
];
const SECTION_WAIST = 2.15;

// Rows are spaced by the integral of this density, so the snout, the orbit, the
// opercular margin and the peduncle — where the profile turns hardest — get the mesh.
const ROW_DENSITY = [
  [0.35, 2.4],
  [0.315, 2.1],
  [0.288, 3.0],
  [0.256, 3.0],
  [0.228, 2.1],
  [0.19, 1.7],
  [0.16, 1.5],
  [0.06, 1.0],
  [-0.12, 1.0],
  [-0.21, 1.4],
  [-0.265, 2.0],
  [HYPURAL_X, 2.4],
];
const BODY_ROWS = 84;
const BODY_COLUMNS = 62;

// The eyeball is a flattened lens seated in the orbit: 39% of head length across but
// only a fifth of that thick, as a small characin's eye is. The body surface takes on
// the eyeball's shape inside the orbit, so the eye can never part from the head.
const EYE = {
  x: 0.272,
  y: 0.012,
  radiusX: 0.0335,
  radiusY: 0.0325,
  bulge: 0.0126,
  inset: 0.0228,
  pupil: 0.60,
  iris: 0.93,
  rim: 0.985,
};

// Posterior margin of the gill cover: bowed back at mid-height, sloping forward at the
// nape and the isthmus. The opercle's free edge overlaps the shoulder, so the surface
// carries a raised bony edge and then a groove.
const OPERCLE = { x: 0.196, bow: 0.03, y: -0.004, span: 0.078 };

// Terminal, slightly upturned mouth: the cleft rises from the corner to the snout tip.
const MOUTH = { cornerX: 0.322, cornerY: -0.0175, tipX: 0.3495, tipY: -0.0035 };

// Fin ray counts from the species' fin formulae: dorsal ii,9; anal iii,20;
// pectoral i,11; pelvic i,7; caudal 19 principal rays. The adipose fin has none.
const FIN_RAYS = { 1: 19, 2: 11, 3: 23, 4: 12, 5: 12, 6: 8, 12: 0 };
const MEMBRANE_STEPS = 8;
const RAY_SUBDIVISIONS = 4;

// Scale rows for a 40 mm fish: 34 in the lateral series, 11 from the dorsal midline to
// the ventral. Visible only when a scale covers more than a pixel.
const SCALE_ROWS = [34, 11];

// Light transport through the body wall. The path is the width of the section at the
// fragment, which the rest position already carries in z. One model unit is 62 mm, so
// these are the effective attenuation coefficients of pale fish muscle — 0.55, 1.35 and
// 1.75 per mm: blood and myoglobin take green and blue out several times faster than
// red, which is why a small fish lit from behind glows pink-orange where it is thin.
const MUSCLE_ABSORPTION = [34, 84, 109];
// Scattering, 2.6 per mm. It decides how much of what survives the path comes back out
// towards the eye rather than carrying straight on: a millimetre of muscle diffuses
// almost everything, a fin membrane hardly redirects the light at all.
const TISSUE_SCATTER = 160;
// Skin, scales and the muscle immediately under them: the shortest path anywhere on the
// body, and what keeps the ridges from reading as a white rim rather than warm tissue.
const MUSCLE_FLOOR = 0.012;
// A fin membrane is a fraction of a millimetre of collagen. Its red is carotenoid in the
// rays' sheath, which absorbs green and blue almost completely at full strength; the rays
// themselves are bone splints, so they stand in a backlit fin as dark striations however
// bright they look by reflection.
const MEMBRANE_THICKNESS = 0.004;
const FIN_PIGMENT = [0.25, 2.0, 2.6];
const FIN_RAY_DENSITY = 0.5;
// Myomeres, roughly one per vertebra, their septa swept forward at mid-depth into the
// chevron that shows when the caudal muscle is lit through. Cycles per model unit.
const MYOMERE_PITCH = 52;
// Tissue a millimetre thick scatters light out broadly rather than as a forward beam, so
// the view-dependent lobe sits on a wrap-around floor and the distortion bends it toward
// the surface normal (Barré-Brisebois). The ambient share is the same transport applied
// to the light that arrives from every direction at once.
const THROUGH = {
  gain: 2.0,
  wrap: 0.35,
  sharpness: 2.0,
  distortion: 0.22,
  ambient: 0.55,
};

const glsl = (value) => value.toFixed(5);

// Smooth interpolation through the station knots. Slopes are the neighbours' secant,
// which keeps the profile C1 without the overshoot a uniform parameterisation adds
// where the knots crowd together at the snout.
function splineThrough(knots) {
  const xs = knots.map((knot) => knot[0]);
  const ys = knots.map((knot) => knot[1]);
  const last = xs.length - 1;
  const slopes = ys.map((_, i) => {
    if (i === 0) return (ys[1] - ys[0]) / (xs[1] - xs[0]);
    if (i === last) return (ys[last] - ys[last - 1]) / (xs[last] - xs[last - 1]);
    return (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1]);
  });
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[last]) return ys[last];
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (xs[middle] <= x) low = middle;
      else high = middle;
    }
    const span = xs[low + 1] - xs[low];
    const u = (x - xs[low]) / span;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * ys[low] +
      (u3 - 2 * u2 + u) * span * slopes[low] +
      (-2 * u3 + 3 * u2) * ys[low + 1] +
      (u3 - u2) * span * slopes[low + 1]
    );
  };
}

const CHANNELS = ["top", "bottom", "width", "fullUp", "fullDown"];
const PROFILE = CHANNELS.map((_, channel) =>
  splineThrough(
    STATIONS.map((station) => [station[0], station[channel + 1]]).reverse(),
  ),
);

function profile(x) {
  const clamped = THREE.MathUtils.clamp(x, HYPURAL_X, SNOUT_X);
  return {
    top: PROFILE[0](clamped),
    bottom: PROFILE[1](clamped),
    width: PROFILE[2](clamped),
    fullUp: PROFILE[3](clamped),
    fullDown: PROFILE[4](clamped),
  };
}

function opercleX(y) {
  const t = THREE.MathUtils.clamp((y - OPERCLE.y) / OPERCLE.span, -1, 1);
  return OPERCLE.x - OPERCLE.bow * (1 - t * t);
}

function mouthCleftY(x) {
  const k = THREE.MathUtils.clamp(
    (x - MOUTH.cornerX) / (MOUTH.tipX - MOUTH.cornerX),
    0,
    1,
  );
  return THREE.MathUtils.lerp(
    MOUTH.cornerY,
    MOUTH.tipY,
    k * k * (3 - 2 * k),
  );
}

// Depth coordinate v runs -1 at the ventral midline to +1 at the dorsal. Returns the
// height of the surface there; the sections are taller above the spine than below it
// by the same ratio a characin's vertebral column sits at.
function sectionY(section, v) {
  const centre = (section.top + section.bottom) * 0.5;
  return v >= 0
    ? centre + v * (section.top - centre)
    : centre + v * (centre - section.bottom);
}

// Half width of the surface at (x, v), with the features that make a head read as a
// head: the gill chamber swelling the cheek, the orbit taking the eyeball's shape, the
// opercular edge and the mouth cleft.
function sectionZ(x, v, section, y) {
  const fullness = v >= 0 ? section.fullUp : section.fullDown;
  const waist = Math.pow(
    Math.max(0, 1 - Math.pow(Math.abs(v), SECTION_WAIST)),
    1 / fullness,
  );
  const cheek =
    1 +
    0.09 *
      Math.exp(-(((x - 0.2) / 0.045) ** 2)) *
      THREE.MathUtils.smoothstep(-v, -0.35, 0.5);
  let z = section.width * waist * cheek;

  const margin = opercleX(y);
  z += 0.0013 * Math.exp(-(((x - margin - 0.009) / 0.008) ** 2));
  z -= 0.0023 * Math.exp(-(((x - margin) / 0.005) ** 2));

  const cleft = Math.exp(-(((y - mouthCleftY(x)) / 0.0045) ** 2));
  const gape = THREE.MathUtils.smoothstep(x, MOUTH.cornerX - 0.012, MOUTH.cornerX + 0.006);
  z -= Math.min(0.0019 * cleft * gape, z * 0.42);

  const orbit = Math.hypot(
    (x - EYE.x) / EYE.radiusX,
    (y - EYE.y) / EYE.radiusY,
  );
  if (orbit < 1.3) {
    const dome =
      EYE.inset + EYE.bulge * Math.sqrt(Math.max(0, 1 - orbit * orbit));
    const weight = 1 - THREE.MathUtils.smoothstep(orbit, 0.92, 1.62);
    z = THREE.MathUtils.lerp(z, dome, weight);
  }
  return Math.max(z, 0.0004);
}

function surfacePoint(x, v, side, target = new THREE.Vector3()) {
  const section = profile(x);
  const y = sectionY(section, v);
  return target.set(x, y, side * sectionZ(x, v, section, y));
}

// Depth coordinate of a given height, so fin roots and lip ribbons can be placed by
// anatomy (an oblique insertion line) rather than by guessing a v.
function depthCoordinate(section, y) {
  const centre = (section.top + section.bottom) * 0.5;
  return y >= centre
    ? (y - centre) / Math.max(section.top - centre, 1e-6)
    : (y - centre) / Math.max(centre - section.bottom, 1e-6);
}

function surfaceAt(x, y, side, target = new THREE.Vector3()) {
  const section = profile(x);
  const v = THREE.MathUtils.clamp(depthCoordinate(section, y), -1, 1);
  return target.set(x, y, side * sectionZ(x, v, section, y));
}

function surfaceNormal(x, y, side, target = new THREE.Vector3()) {
  const step = 0.0015;
  const here = surfaceAt(x, y, side);
  const alongX = surfaceAt(x + step, y, side).sub(here);
  const alongY = surfaceAt(x, y + step, side).sub(here);
  return target
    .crossVectors(alongX, alongY)
    .multiplyScalar(side)
    .normalize();
}

function bodyRows(count) {
  const samples = 1600;
  const density = splineThrough(ROW_DENSITY.map((knot) => [...knot]).reverse());
  const cumulative = [0];
  for (let i = 1; i <= samples; i++) {
    const x = HYPURAL_X + ((SNOUT_X - HYPURAL_X) * i) / samples;
    cumulative.push(cumulative[i - 1] + density(x));
  }
  const total = cumulative[samples];
  const rows = [];
  let cursor = 0;
  for (let row = 0; row <= count; row++) {
    const wanted = (total * row) / count;
    while (cursor < samples && cumulative[cursor + 1] < wanted) cursor++;
    const span = cumulative[cursor + 1] - cumulative[cursor] || 1;
    const fraction = (wanted - cumulative[cursor]) / span;
    rows.push(
      HYPURAL_X +
        ((SNOUT_X - HYPURAL_X) * (cursor + fraction)) / samples,
    );
  }
  return rows.reverse();
}

// The body shell: a closed tube whose columns start on the dorsal midline, so the uv
// seam and the normals' only discontinuity fall under the dorsal fin. uv.x runs 0 at
// the snout to 1 at the hypural; uv.y is the arc fraction from the dorsal midline to
// the ventral, identical on both flanks, which is how scale rows actually sit.
function bodyGeometry() {
  const positions = [];
  const uvs = [];
  const indices = [];
  const rows = bodyRows(BODY_ROWS);
  const columns = BODY_COLUMNS;
  const point = new THREE.Vector3();
  const previous = new THREE.Vector3();
  const halfArc = [];
  const arcs = [];

  for (const x of rows) {
    let arc = 0;
    halfArc.length = 0;
    halfArc.push(0);
    surfacePoint(x, 1, 1, previous);
    for (let column = 1; column <= columns / 2; column++) {
      const v = Math.cos((column / (columns / 2)) * Math.PI);
      surfacePoint(x, v, 1, point);
      arc += point.distanceTo(previous);
      previous.copy(point);
      halfArc.push(arc);
    }
    arcs.push(halfArc.map((value) => value / Math.max(arc, 1e-6)));
  }

  rows.forEach((x, row) => {
    for (let column = 0; column < columns; column++) {
      const s = (column / columns) * 2;
      const mirrored = s <= 1;
      const t = mirrored ? s : 2 - s;
      const v = Math.cos(t * Math.PI);
      surfacePoint(x, v, mirrored ? 1 : -1, point);
      positions.push(point.x, point.y, point.z);
      const index = Math.round(t * (columns / 2));
      uvs.push((SNOUT_X - x) / STANDARD_LENGTH, arcs[row][index]);
    }
  });

  for (let row = 0; row < rows.length - 1; row++) {
    for (let column = 0; column < columns; column++) {
      const next = (column + 1) % columns;
      const a = row * columns + column;
      const b = row * columns + next;
      const c = (row + 1) * columns + column;
      const d = (row + 1) * columns + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  // Close both ends so the shell is watertight for the shadow pass and nothing can be
  // seen through the caudal peduncle when the tail swings across the camera.
  for (const [row, flip] of [
    [0, false],
    [rows.length - 1, true],
  ]) {
    const centre = new THREE.Vector3();
    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      centre.x += positions[index * 3] / columns;
      centre.y += positions[index * 3 + 1] / columns;
      centre.z += positions[index * 3 + 2] / columns;
    }
    const hub = positions.length / 3;
    positions.push(centre.x, centre.y, centre.z);
    uvs.push((SNOUT_X - centre.x) / STANDARD_LENGTH, 0.5);
    for (let column = 0; column < columns; column++) {
      const a = row * columns + column;
      const b = row * columns + ((column + 1) % columns);
      if (flip) indices.push(hub, b, a);
      else indices.push(hub, a, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function geometryBuilder() {
  const positions = [],
    normals = [],
    uvs = [],
    parts = [],
    progress = [],
    indices = [];
  return {
    add(geometry, part, finProgress) {
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const uv = geometry.getAttribute("uv");
      const offset = positions.length / 3;
      for (let i = 0; i < position.count; i++) {
        positions.push(position.getX(i), position.getY(i), position.getZ(i));
        normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
        uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
        parts.push(part);
        progress.push(finProgress ? finProgress[i] : 0);
      }
      const index = geometry.getIndex();
      for (let i = 0; i < (index ? index.count : position.count); i++) {
        indices.push(offset + (index ? index.getX(i) : i));
      }
      geometry.dispose();
    },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(normals, 3),
      );
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute(
        "aPart",
        new THREE.Float32BufferAttribute(parts, 1),
      );
      geometry.setAttribute(
        "aFinProgress",
        new THREE.Float32BufferAttribute(progress, 1),
      );
      geometry.setIndex(indices);
      return geometry;
    },
  };
}

function fromArrays(positions, normals, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  if (normals.length) {
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// A spherical-cap patch of the eyeball, cut between two radius fractions. All three
// eye patches share the analytic normal of the same lens, so the pupil, iris and
// corneal rim meet without a shading crease.
function eyeCap(side, inner, outer, rings, segments, lift, rimLift) {
  const positions = [],
    normals = [],
    uvs = [],
    indices = [];
  for (let ring = 0; ring <= rings; ring++) {
    const f = THREE.MathUtils.lerp(inner, outer, ring / rings);
    const height = Math.sqrt(Math.max(0, 1 - Math.min(f, 1) ** 2));
    const clearance = lift + rimLift * f * f;
    for (let segment = 0; segment <= segments; segment++) {
      const angle = (segment / segments) * TAU;
      const dx = Math.cos(angle) * f;
      const dy = Math.sin(angle) * f;
      const normal = new THREE.Vector3(
        (dx * EYE.radiusX) / (EYE.bulge * EYE.bulge),
        (dy * EYE.radiusY) / (EYE.bulge * EYE.bulge),
        (side * height) / EYE.bulge,
      ).normalize();
      positions.push(
        EYE.x + dx * EYE.radiusX + normal.x * clearance,
        EYE.y + dy * EYE.radiusY + normal.y * clearance,
        side * (EYE.inset + EYE.bulge * height) + normal.z * clearance,
      );
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(segment / segments, ring / rings);
      if (ring < rings && segment < segments) {
        const i = ring * (segments + 1) + segment;
        if (side > 0) indices.push(i, i + segments + 1, i + 1, i + 1, i + segments + 1, i + segments + 2);
        else indices.push(i, i + 1, i + segments + 1, i + 1, i + segments + 2, i + segments + 1);
      }
    }
  }
  return fromArrays(positions, normals, uvs, indices);
}

// A narrow strip laid along the mouth cleft, offset from the skin along its normal:
// negative for the dark slit at the bottom of the groove, positive for the lip above it.
function cleftRibbon(side, fromY, toY, offset, segments) {
  const positions = [],
    normals = [],
    uvs = [],
    indices = [];
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let segment = 0; segment <= segments; segment++) {
    const k = segment / segments;
    const x = THREE.MathUtils.lerp(MOUTH.cornerX - 0.004, MOUTH.tipX, k);
    const taper = Math.sin(Math.min(1, 1.25 * (1 - k)) * Math.PI * 0.5);
    for (const edge of [0, 1]) {
      const y =
        mouthCleftY(x) + THREE.MathUtils.lerp(fromY, toY, edge) * taper;
      surfaceAt(x, y, side, point);
      surfaceNormal(x, y, side, normal);
      positions.push(
        point.x + normal.x * offset,
        point.y + normal.y * offset,
        point.z + normal.z * offset,
      );
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(k, edge);
    }
    if (segment < segments) {
      const i = segment * 2;
      if (side > 0) indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      else indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  return fromArrays(positions, normals, uvs, indices);
}

function curveThrough(points) {
  return new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(...point)),
    false,
    "catmullrom",
    0.5,
  );
}

// A fin is a fan of rays. `base` is the insertion line in the skin, `tip` the free
// margin; between rays the membrane falls short of the ray tips, which is what gives a
// real fin its finely scalloped edge. Rays become tapered tubes in the opaque mesh,
// the membrane a single double-sided sheet.
function finFan(
  { part, base, tip, sway = 0, roll = 0, edge = 0.055, root = 0.006 },
  membranes,
) {
  const rays = FIN_RAYS[part] || 3;
  const columns = (rays - 1) * RAY_SUBDIVISIONS;
  const baseCurve = curveThrough(base);
  const tipCurve = curveThrough(tip);
  const positions = [],
    uvs = [],
    progress = [],
    indices = [];
  const hinge = new THREE.Vector3();
  const free = new THREE.Vector3();
  const point = new THREE.Vector3();
  const inward = new THREE.Vector3();
  // The membrane falls short of the ray tips between rays, and no two rays reach
  // exactly the same distance: that is what makes a real fin's edge finely uneven.
  const margin = (along) => {
    const rayIndex = along * (rays - 1);
    const between = 0.5 - 0.5 * Math.cos(TAU * rayIndex);
    const uneven =
      0.013 * Math.sin(rayIndex * 5.3 + part * 2.1) +
      0.008 * Math.sin(rayIndex * 11.7 + part);
    return 1 - edge * Math.pow(between, 1.4) + uneven * (1 - between);
  };

  for (let column = 0; column <= columns; column++) {
    const along = column / columns;
    baseCurve.getPoint(along, hinge);
    tipCurve.getPoint(along, free);
    // Sink the insertion into the skin so the membrane grows out of the body.
    inward.subVectors(free, hinge).normalize().multiplyScalar(-root);
    hinge.add(inward);
    const reach = margin(along);
    for (let step = 0; step <= MEMBRANE_STEPS; step++) {
      const t = step / MEMBRANE_STEPS;
      point.lerpVectors(hinge, free, t * reach);
      const bow = Math.sin(t * Math.PI * 0.85);
      point.z += sway * bow;
      point.z += roll * bow * Math.sin((along - 0.5) * Math.PI);
      positions.push(point.x, point.y, point.z);
      uvs.push(along, t);
      progress.push(t);
      if (column < columns && step < MEMBRANE_STEPS) {
        const i = column * (MEMBRANE_STEPS + 1) + step;
        indices.push(
          i,
          i + 1,
          i + MEMBRANE_STEPS + 1,
          i + 1,
          i + MEMBRANE_STEPS + 2,
          i + MEMBRANE_STEPS + 1,
        );
      }
    }
  }
  const membrane = fromArrays(positions, [], uvs, indices);
  membrane.computeVertexNormals();
  membranes.add(membrane, part, progress);
}

// Insertion lines read off the body surface, so every fin is rooted in the skin
// wherever the profile happens to run.
function insertion(points, side = 1) {
  return points.map(([x, y]) => surfaceAt(x, y, side).toArray());
}

function medianInsertion(from, to, samples, dorsal, sink) {
  const line = [];
  for (let i = 0; i <= samples; i++) {
    const x = THREE.MathUtils.lerp(from, to, i / samples);
    const section = profile(x);
    const y = dorsal ? section.top - sink : section.bottom + sink;
    line.push([x, y, 0]);
  }
  return line;
}

export function makeAnatomy() {
  const opaque = geometryBuilder();
  const membranes = geometryBuilder();
  opaque.add(bodyGeometry(), 0);

  for (const side of [-1, 1]) {
    opaque.add(eyeCap(side, 0, EYE.pupil, 4, 30, 0.0009, 0.0013), 8);
    opaque.add(eyeCap(side, EYE.pupil, EYE.iris, 5, 30, 0.0006, 0.0013), 7);
    opaque.add(eyeCap(side, EYE.iris, EYE.rim, 2, 30, 0.0004, 0.0013), 10);
    opaque.add(cleftRibbon(side, -0.0016, 0.0016, -0.001, 7), 9);
    opaque.add(cleftRibbon(side, 0.0022, 0.005, 0.0005, 7), 11);
  }

  // Caudal fin: 19 principal rays fanning from the hypural plate into two rounded
  // lobes, the median rays a third of the lobe length so the fork stays deep.
  finFan(
    {
      part: 1,
      base: [
        [-0.271, 0.032, 0],
        [-0.286, 0.021, 0],
        [-0.292, 0, 0],
        [-0.286, -0.02, 0],
        [-0.271, -0.031, 0],
      ],
      tip: [
        [-0.302, 0.045, 0],
        [-0.362, 0.082, 0],
        [-0.414, 0.094, 0],
        [-0.436, 0.096, 0],
        [-0.43, 0.073, 0],
        [-0.398, 0.038, 0],
        [-0.347, 0.001, 0],
        [-0.394, -0.036, 0],
        [-0.426, -0.071, 0],
        [-0.434, -0.093, 0],
        [-0.412, -0.094, 0],
        [-0.356, -0.077, 0],
        [-0.3, -0.042, 0],
      ],
      edge: 0.022,
      root: 0.015,
    },
    membranes,
  );

  // Dorsal fin at 52% SL: a short base, the apex over the third ray, the margin
  // falling away concavely behind it.
  finFan(
    {
      part: 2,
      base: medianInsertion(0.015, -0.056, 4, true, 0.006),
      tip: [
        [0.022, 0.113, 0],
        [0.012, 0.155, 0],
        [-0.007, 0.176, 0],
        [-0.025, 0.166, 0],
        [-0.04, 0.147, 0],
        [-0.051, 0.122, 0],
        [-0.058, 0.098, 0],
      ],
      edge: 0.02,
    },
    membranes,
  );

  // Anal fin: the long, low, falcate base that marks the genus.
  finFan(
    {
      part: 3,
      base: medianInsertion(-0.04, -0.205, 6, false, 0.006),
      tip: [
        [-0.036, -0.132, 0],
        [-0.052, -0.162, 0],
        [-0.073, -0.159, 0],
        [-0.098, -0.146, 0],
        [-0.128, -0.128, 0],
        [-0.158, -0.106, 0],
        [-0.185, -0.084, 0],
        [-0.208, -0.07, 0],
      ],
      edge: 0.018,
    },
    membranes,
  );

  // Adipose fin at 84% SL: a small rayless flap of skin, red in this species.
  finFan(
    {
      part: 12,
      base: medianInsertion(-0.178, -0.206, 3, true, 0.004),
      tip: [
        [-0.179, 0.062, 0],
        [-0.194, 0.067, 0],
        [-0.208, 0.055, 0],
      ],
      edge: 0.02,
      root: 0.003,
    },
    membranes,
  );

  for (const side of [-1, 1]) {
    // Pectorals inserted low and just behind the opercular margin, reaching back to
    // the pelvic origin.
    finFan(
      {
        part: side > 0 ? 4 : 5,
        base: insertion(
          [
            [0.174, -0.034],
            [0.166, -0.048],
            [0.156, -0.062],
          ],
          side,
        ),
        tip: [
          [0.130, -0.040, side * 0.052],
          [0.110, -0.053, side * 0.068],
          [0.086, -0.068, side * 0.076],
          [0.079, -0.085, side * 0.067],
          [0.097, -0.095, side * 0.053],
          [0.126, -0.088, side * 0.042],
        ],
        sway: side * 0.002,
        roll: side * 0.004,
        edge: 0.024,
        root: 0.005,
      },
      membranes,
    );
    // Pelvics at 46% SL, close to the ventral midline.
    finFan(
      {
        part: 6,
        base: insertion(
          [
            [0.064, -0.093],
            [0.05, -0.0975],
            [0.038, -0.0975],
          ],
          side,
        ),
        tip: [
          [0.04, -0.128, side * 0.028],
          [0.014, -0.141, side * 0.034],
          [-0.006, -0.131, side * 0.026],
          [0.002, -0.111, side * 0.016],
        ],
        sway: side * 0.0012,
        roll: side * 0.002,
        edge: 0.024,
        root: 0.005,
      },
      membranes,
    );
  }

  return { body: opaque.finish(), fins: membranes.finish() };
}

// Colour, scales, guanine sheen and fin membranes in the fragment stage. The vertex
// stage (owned by fish.js) supplies vSkinPoint, vFishUV and vFishPart; the water light
// model is wired here so the fish receive the same surface focusing and depth
// absorption as everything else lit in the tank.
export function applySkin(shader) {
  if (!/vWaterPosition/.test(shader.vertexShader)) {
    waterLitShader(shader, {
      perLight: /* glsl */ `
        // Light that entered the far face and scattered out towards the eye. What enters
        // still obeys Lambert on the face it crosses, so the leak is strongest where the
        // surface turns away from the light; what survives the path is in gFishThrough,
        // and the lobe is how much of it leaves towards the viewer rather than sideways.
        float enter = max(0.0, -dot(geometryNormal, directLight.direction));
        vec3 through = normalize(directLight.direction
          + geometryNormal * ${glsl(THROUGH.distortion)});
        float lobe = ${glsl(THROUGH.wrap)}
          + pow(max(dot(geometryViewDir, -through), 0.0), ${glsl(THROUGH.sharpness)});
        reflectedLight.directDiffuse += lit.color * gFishThrough
          * enter * lobe * ${glsl(THROUGH.gain)} * RECIPROCAL_PI;
      `,
    });
  }
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      /* glsl */ `
      #include <common>
      varying vec3 vSkinPoint;
      varying vec2 vFishUV;
      varying float vFishPart;

      // What the tissue under this fragment passes: set once the anatomy is known, read
      // back by every light below.
      vec3 gFishThrough = vec3(0.0);

      const vec3 FISH_ABSORPTION = vec3(${MUSCLE_ABSORPTION.map(glsl).join(", ")});
      const vec3 FISH_FIN_PIGMENT = vec3(${FIN_PIGMENT.map(glsl).join(", ")});
      const vec2 FISH_SCALES = vec2(${glsl(SCALE_ROWS[0])}, ${glsl(SCALE_ROWS[1])});
      const vec2 FISH_EYE = vec2(${glsl(EYE.x)}, ${glsl(EYE.y)});
      const vec2 FISH_EYE_RADIUS = vec2(${glsl(EYE.radiusX)}, ${glsl(EYE.radiusY)});

      float fishHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      // What a slab of tissue this thick sends back out diffusely: what survives the
      // absorption along the path, the tissue's own and any pigment standing in it,
      // times the share the tissue scatters instead of passing straight on.
      vec3 fishThrough(float path, vec3 pigment) {
        return exp(-FISH_ABSORPTION * path - pigment)
          * (1.0 - exp(-${glsl(TISSUE_SCATTER)} * path));
      }

      // Imbricate rows: every row is offset half a scale from its neighbour and the
      // rows run slightly diagonally, as a characin's do.
      vec2 fishScaleGrid() {
        vec2 grid = vFishUV * FISH_SCALES;
        grid.y += 0.11 * sin(grid.x * 0.62 + 1.3);
        grid.x += grid.y * 0.24 + mod(floor(grid.y), 2.0) * 0.5;
        return grid;
      }
      // Detail fades out rather than aliasing once a cell is smaller than a pixel.
      float fishFade(vec2 grid) {
        return 1.0 - smoothstep(0.42, 1.1, max(fwidth(grid.x), fwidth(grid.y)));
      }
      float fishOpercleX(float y) {
        float t = clamp((y - ${glsl(OPERCLE.y)}) / ${glsl(OPERCLE.span)}, -1.0, 1.0);
        return ${glsl(OPERCLE.x)} - ${glsl(OPERCLE.bow)} * (1.0 - t * t);
      }
      // Scales stop at the caudal fin base and at the bare bony gill cover.
      float fishScaleMask() {
        float rear = smoothstep(${glsl(HYPURAL_X)}, ${glsl(HYPURAL_X + 0.05)}, vSkinPoint.x);
        float front = 1.0 - smoothstep(-0.005, 0.011,
          vSkinPoint.x - fishOpercleX(vSkinPoint.y));
        float ridge = smoothstep(0.0, 0.11, vFishUV.y)
          * (1.0 - smoothstep(0.90, 1.0, vFishUV.y));
        return rear * front * ridge * fishFade(fishScaleGrid());
      }
      float fishScaleRelief() {
        vec2 cell = fract(fishScaleGrid()) - 0.5;
        float dome = 1.0 - smoothstep(0.15, 0.55, length(cell * vec2(0.9, 1.0)));
        return dome * (0.42 - cell.x * 0.85) * fishScaleMask();
      }
      float fishOrbit() {
        return length((vSkinPoint.xy - FISH_EYE) / FISH_EYE_RADIUS);
      }
      float fishCleftY(float x) {
        float k = clamp((x - ${glsl(MOUTH.cornerX)}) / ${glsl(MOUTH.tipX - MOUTH.cornerX)}, 0.0, 1.0);
        return mix(${glsl(MOUTH.cornerY)}, ${glsl(MOUTH.tipY)}, k * k * (3.0 - 2.0 * k));
      }
      float fishRayCount(float part) {
        ${Object.entries(FIN_RAYS)
          .map(([part, count]) => `if (part < ${glsl(Number(part) + 0.5)}) return ${glsl(Math.max(count - 1, 2))};`)
          .join("\n        ")}
        return 2.0;
      }
      // Guanine platelets stacked under the scales make a broadband reflector. It covers
      // the flank between the dark dorsum and the scattering belly, and it is tuned
      // blue-green, which is why the band flares cyan off normal. The layer is thickest
      // where it doubles as the lining of the body cavity and thins over the caudal
      // muscle, which passes light instead of mirroring it.
      float fishReflector(float band, float x) {
        return smoothstep(0.07, 0.24, band) * (1.0 - smoothstep(0.58, 0.92, band))
          * mix(0.70, 1.0, smoothstep(-0.195, 0.015, x));
      }
      // The peritoneum: the silvered sheet lining the body cavity, from behind the
      // pectoral girdle back to the anal fin origin and from the belly up to the swim
      // bladder under the spine. Gut and bladder fill it, so nothing gets through.
      float fishCavity(float x, float band) {
        return smoothstep(-0.080, -0.020, x) * (1.0 - smoothstep(0.140, 0.180, x))
          * smoothstep(0.34, 0.47, band);
      }
      // The vertebral column and the septa between the muscle blocks stand in the path
      // behind the cavity: a denser line along the axis with a faint chevron either side.
      float fishAxialShadow(float x, float y) {
        float column = exp(-pow(y / 0.011, 2.0));
        float phase = (x + 0.007 * cos(y * 30.0)) * ${glsl(MYOMERE_PITCH)};
        return 0.62 * column - 0.06 * cos(PI2 * phase) * fishFade(vec2(phase, 0.0));
      }
    `,
    )
    .replace(
      "#include <color_fragment>",
      /* glsl */ `
      #include <color_fragment>
      float fishX = vSkinPoint.x;
      float fishY = vSkinPoint.y;
      // Band runs 0 on the dorsal midline to 1 on the ventral, measured along the
      // section, so every colour zone follows the body outline instead of a height.
      float fishBand = clamp(vFishUV.y, 0.0, 1.0);
      float fishHead = smoothstep(-0.008, 0.034, fishX - fishOpercleX(fishY));
      if (vFishPart < 0.5) {
        // Countershading: an olive dorsum against the substrate seen from above, a
        // guanine flank that mirrors the water, a pale belly against the surface.
        vec3 skin = mix(vec3(0.0105, 0.0150, 0.0125), vec3(0.034, 0.049, 0.043),
          smoothstep(0.02, 0.135, fishBand));
        skin = mix(skin, vec3(0.470, 0.510, 0.500), smoothstep(0.185, 0.42, fishBand));
        float bellyReach = smoothstep(-0.26, -0.12, fishX);
        skin = mix(skin, vec3(0.655, 0.660, 0.630),
          smoothstep(0.52, 0.84, fishBand) * bellyReach);
        skin = mix(skin, vec3(0.720, 0.700, 0.635),
          smoothstep(0.88, 1.0, fishBand) * bellyReach);

        // The reflector band: blue-green, from behind the eye to the caudal peduncle.
        float sheen = exp(-pow((fishBand - 0.250) / 0.070, 2.0))
          * smoothstep(-0.285, -0.225, fishX)
          * (1.0 - smoothstep(0.188, 0.245, fishX));
        vec2 sheenGrid = fishScaleGrid();
        float mottle = 1.0 + (fishHash(floor(sheenGrid) + 7.0) - 0.5) * 0.14
          * fishFade(sheenGrid);
        skin = mix(skin, vec3(0.080, 0.410, 0.620) * mottle, sheen * 0.82);

        // Lateral line: one row of pored scales, gently decurved along the flank.
        float lineBand = mix(0.50, 0.43, smoothstep(-0.28, 0.16, fishX));
        float lateral = exp(-pow((fishBand - lineBand) / 0.020, 2.0));
        vec2 poreGrid = fishScaleGrid();
        float pore = smoothstep(0.60, 0.95, fishHash(vec2(floor(poreGrid.x), 3.0)));
        skin *= 1.0 - lateral * (0.09 + 0.20 * pore) * fishFade(poreGrid);

        // Scales: a faint sheen difference per scale and a darker free margin. Most
        // of the scale relief lives in roughness and normal, not in albedo.
        vec2 grid = fishScaleGrid();
        float mask = fishScaleMask();
        float rim = smoothstep(0.40, 0.50, length((fract(grid) - 0.5) * vec2(0.85, 1.0)));
        skin *= 1.0 + (fishHash(floor(grid)) - 0.5) * 0.06 * mask - rim * 0.035 * mask;

        // Red pigment bleeds out of the caudal and anal fin bases over the posterior
        // ventral flank, and the gill chamber shows warm through thin opercular skin.
        float warm = (1.0 - smoothstep(-0.27, 0.0, fishX))
          * smoothstep(0.32, 0.60, fishBand) * (1.0 - smoothstep(0.88, 1.0, fishBand));
        skin = mix(skin, vec3(0.420, 0.105, 0.030), warm * 0.45);
        float sheath = 1.0 - smoothstep(-0.292, -0.240, fishX);
        skin = mix(skin, vec3(0.255, 0.080, 0.038), sheath * 0.60);
        float gill = exp(-pow((fishX - 0.178) / 0.026, 2.0)
          - pow((fishBand - 0.66) / 0.16, 2.0));
        skin = mix(skin, vec3(0.330, 0.098, 0.078), gill * 0.20);

        // Head: silver cheek and opercle, dark olive over the skull and the snout.
        vec3 cheek = mix(vec3(0.040, 0.052, 0.046), vec3(0.420, 0.440, 0.420),
          smoothstep(0.13, 0.40, fishBand));
        skin = mix(skin, cheek, fishHead * 0.92);
        skin = mix(skin, vec3(0.050, 0.056, 0.046), smoothstep(0.250, 0.330, fishX) * 0.82);
        skin = mix(skin, vec3(0.098, 0.092, 0.078), smoothstep(0.330, 0.350, fishX) * 0.7);

        // The opercular edge: a fine dark seam with the pale bony lip in front of it.
        float margin = fishX - fishOpercleX(fishY);
        float opercleFace = 1.0 - smoothstep(0.84, 1.0, fishBand);
        skin *= 1.0 - 0.60 * exp(-pow(margin / 0.0028, 2.0)) * opercleFace;
        skin *= 1.0 + 0.28 * exp(-pow((margin - 0.008) / 0.005, 2.0)) * opercleFace;

        // Mouth cleft, and the silver-gold ring of skin around the orbit.
        float cleft = exp(-pow((fishY - fishCleftY(fishX)) / 0.0030, 2.0))
          * smoothstep(0.304, 0.322, fishX);
        skin = mix(skin, vec3(0.040, 0.028, 0.024), cleft * 0.85);
        float orbit = fishOrbit();
        float ring = (1.0 - smoothstep(1.00, 1.18, orbit)) * smoothstep(0.88, 0.99, orbit);
        skin = mix(skin, vec3(0.520, 0.455, 0.235), ring * 0.8);

        diffuseColor.rgb = skin;

        // Behind the body cavity the wall is thin swimming muscle, and a small fish's
        // muscle passes light. The path is the width of the section here, so the caudal
        // peduncle and the dorsal and ventral ridges leak most, while the silvered
        // cavity, the skull and the column leak nothing. The gill chamber is the one
        // place light crosses the head, through the thin opercular flap.
        float path = max(abs(vSkinPoint.z) * 2.0, ${glsl(MUSCLE_FLOOR)});
        float wall = (1.0 - max(fishHead, fishCavity(fishX, fishBand)))
          * (1.0 - 0.55 * fishReflector(fishBand, fishX))
          * (1.0 - fishAxialShadow(fishX, fishY));
        gFishThrough = fishThrough(path, vec3(0.0)) * wall
          + vec3(0.24, 0.055, 0.038) * gill;
      } else if (vFishPart < 6.5 || vFishPart > 11.5) {
        float caudal = 1.0 - step(1.5, vFishPart);
        float pectoral = step(3.5, vFishPart) * (1.0 - step(5.5, vFishPart));
        float paleTip = step(2.5, vFishPart) * (1.0 - step(3.5, vFishPart))
          + step(5.5, vFishPart) * (1.0 - step(6.5, vFishPart));
        float span = clamp(vFishUV.y, 0.0, 1.0);
        float along = clamp(vFishUV.x, 0.0, 1.0);
        float rays = fishRayCount(vFishPart);

        // Membrane: nearly colourless where there is no pigment, so the plants and
        // water behind the fin show through it.
        vec3 membrane = vec3(0.135, 0.158, 0.142);
        // Blood red at the base, carried furthest out through the two caudal lobes and
        // clearing to hyaline at the margin. The pectorals stay almost clear.
        float lobe = 0.5 - 0.5 * cos(PI2 * 2.0 * along);
        float pigment = pow(1.0 - smoothstep(0.34, 1.04, span), 0.8)
          * mix(1.0, 0.42 + 0.58 * lobe, caudal) * mix(1.0, 0.26, pectoral);
        pigment = clamp(pigment, 0.0, 1.0);
        diffuseColor.rgb = mix(membrane, vec3(0.400, 0.052, 0.020), pigment);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.400, 0.410, 0.380),
          paleTip * smoothstep(0.76, 0.98, span) * 0.7);

        // Each soft ray branches twice on its way to the margin, so the ribbing
        // doubles and then doubles again over the outer half of the fin.
        float stem = pow(0.5 + 0.5 * cos(PI2 * along * rays), 20.0);
        float split = pow(0.5 + 0.5 * cos(PI2 * (along * rays + 0.5)), 24.0)
          * smoothstep(0.30, 0.55, span);
        float twig = pow(0.5 + 0.5 * cos(PI2 * (along * rays * 2.0 + 0.5)), 28.0)
          * smoothstep(0.62, 0.86, span);
        float ribs = clamp(
          stem * fishFade(vec2(along * rays, span)) +
          split * fishFade(vec2(along * rays * 2.0, span)) +
          twig * fishFade(vec2(along * rays * 4.0, span)), 0.0, 1.0);
        vec3 rayTint = diffuseColor.rgb * 0.68 + vec3(0.088, 0.082, 0.072);
        diffuseColor.rgb = mix(diffuseColor.rgb, rayTint, ribs * 0.85);

        // Hyaline membrane: thin enough that most of the light carries straight through
        // it rather than scattering back, which is what keeps a fin see-through.
        gFishThrough = fishThrough(${glsl(MEMBRANE_THICKNESS)},
          FISH_FIN_PIGMENT * pigment + ${glsl(FIN_RAY_DENSITY)} * ribs);
        #ifdef FISH_MEMBRANE
          // Thickness falls away toward the free margin; pigment and rays add body.
          float thickness = mix(1.0, mix(0.34, 0.50, caudal), smoothstep(0.06, 1.0, span));
          diffuseColor.a = clamp(diffuseColor.a * mix(0.86, 1.0, caudal) * thickness
            * (1.0 + pigment * 1.2 + ribs * 0.85), 0.0, 1.0);
        #endif
      } else if (vFishPart < 7.5) {
        // Iris: a guanine ring, brightest below and behind the pupil, with fine fibres.
        float fibre = 0.5 + 0.5 * cos(vFishUV.x * PI2 * 24.0);
        vec3 iris = mix(vec3(0.620, 0.600, 0.415), vec3(0.330, 0.300, 0.150), vFishUV.y);
        diffuseColor.rgb = iris * (0.92 + 0.08 * fibre)
          * (0.48 + 0.52 * smoothstep(0.034, -0.016, fishY));
      } else if (vFishPart < 8.5) {
        diffuseColor.rgb = vec3(0.0055, 0.0075, 0.0085);
      } else if (vFishPart < 9.5) {
        diffuseColor.rgb = vec3(0.036, 0.020, 0.018);
      } else if (vFishPart < 10.5) {
        diffuseColor.rgb = vec3(0.175, 0.168, 0.132);
      } else {
        diffuseColor.rgb = vec3(0.330, 0.310, 0.265);
      }
    `,
    )
    .replace(
      "#include <metalnessmap_fragment>",
      /* glsl */ `
      #include <metalnessmap_fragment>
      if (vFishPart < 0.5) {
        // Only the reflector layer behaves as a metal. The dark dorsum and the
        // light-scattering belly stay dielectric, which is what keeps the flank
        // reading as a mirror set into a fish rather than as chrome plating.
        // Guanine sits under the scales and in the opercle and cheek plates. The
        // snout, jaws and skull roof carry none, so they stay dull dielectric.
        float scaled = fishReflector(fishBand, fishX)
          * (1.0 - smoothstep(0.155, 0.205, fishX));
        float plate = exp(-pow((fishX - 0.200) / 0.038, 2.0))
          * smoothstep(0.22, 0.46, fishBand) * (1.0 - smoothstep(0.80, 0.96, fishBand));
        metalnessFactor = clamp(0.06 + 0.36 * max(scaled, plate), 0.0, 0.44);
        metalnessFactor *= smoothstep(-0.292, -0.248, fishX);
        metalnessFactor *= 1.0 - 0.85 * smoothstep(0.88, 1.06, fishOrbit());
      } else if (vFishPart > 6.5 && vFishPart < 7.5) {
        metalnessFactor = 0.20;
      } else if (vFishPart < 6.5 || vFishPart > 11.5) {
        metalnessFactor = 0.05;
      } else {
        metalnessFactor = 0.0;
      }
    `,
    )
    .replace(
      "#include <roughnessmap_fragment>",
      /* glsl */ `
      #include <roughnessmap_fragment>
      if (vFishPart < 0.5) {
        // Each scale is a slightly different mirror, which breaks what would
        // otherwise be one broad plastic highlight into a field of glints.
        float scale = 0.17 + fishHash(floor(fishScaleGrid())) * 0.13;
        roughnessFactor = mix(roughnessFactor, scale, fishScaleMask());
        roughnessFactor = mix(roughnessFactor, 0.44, smoothstep(0.60, 0.94, fishBand));
        float grain = fishHash(floor(vSkinPoint.xy * 260.0));
        roughnessFactor *= 1.0 + (grain - 0.5) * 0.26 * fishHead;
        roughnessFactor = mix(roughnessFactor, 0.06, 1.0 - smoothstep(0.86, 1.04, fishOrbit()));
      } else if (vFishPart > 6.5 && vFishPart < 7.5) {
        roughnessFactor = 0.34;
      } else if (vFishPart < 8.5) {
        roughnessFactor = 0.05;
      } else if (vFishPart > 9.5 && vFishPart < 10.5) {
        roughnessFactor = 0.09;
      }
    `,
    )
    .replace(
      "#include <normal_fragment_maps>",
      /* glsl */ `
      #include <normal_fragment_maps>
      if (vFishPart < 0.5) {
        float relief = fishScaleRelief() * 0.00030;
        vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
        vec3 rx = cross(dy, normal), ry = cross(normal, dx);
        float determinant = dot(dx, rx);
        vec3 gradient = sign(determinant) * (dFdx(relief) * rx + dFdy(relief) * ry);
        normal = normalize(abs(determinant) * normal - gradient);
      }
    `,
    )
    .replace(
      "#include <clearcoat_normal_fragment_maps>",
      /* glsl */ `
      #include <clearcoat_normal_fragment_maps>
      #ifdef USE_CLEARCOAT
        clearcoatNormal = normal;
      #endif
    `,
    )
    .replace(
      "#include <lights_physical_fragment>",
      /* glsl */ `
      #include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        // The cornea is a wet lens over the iris: one tight highlight, not a sheen.
        float cornea = step(6.5, vFishPart) * (1.0 - step(8.5, vFishPart))
          + step(9.5, vFishPart) * (1.0 - step(10.5, vFishPart));
        material.clearcoat = mix(material.clearcoat, 1.0, cornea);
        material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.02, cornea);
      #endif
      #ifdef USE_IRIDESCENCE
        // Thin-film interference over the guanine stack, mottled scale by scale.
        float sheenBand = vFishPart < 0.5
          ? fishReflector(fishBand, fishX) * smoothstep(-0.30, -0.22, fishX)
          : 0.0;
        material.iridescence *= 0.12 + sheenBand * 0.88;
        material.iridescenceThickness = 230.0
          + fishHash(floor(fishScaleGrid())) * 160.0
          + fishHash(floor(fishScaleGrid() * 0.34)) * 110.0;
      #endif
    `,
    )
    .replace(
      "#include <lights_fragment_end>",
      /* glsl */ `
      #include <lights_fragment_end>
      // The same transport for the light that arrives from everywhere, so the thin
      // places read lit through even with nothing behind them. View-independent, and
      // small enough to leave the modelling alone.
      reflectedLight.indirectDiffuse += (irradiance + iblIrradiance) * gFishThrough
        * ${glsl(THROUGH.ambient)} * RECIPROCAL_PI;
    `,
    );
}

export function createFishMaterials() {
  const skin = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.5,
    roughness: 0.32,
    clearcoat: 0.1,
    clearcoatRoughness: 0.3,
    iridescence: 0.5,
    iridescenceIOR: 1.38,
    iridescenceThicknessRange: [180, 420],
  });
  const fins = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.05,
    roughness: 0.40,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // Both materials run the same fragment hook; the define marks out the fin membranes.
  fins.defines.FISH_MEMBRANE = "";
  return { skin, fins };
}
