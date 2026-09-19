import * as THREE from "three";
import { waterLitShader } from "./water.js";

// The reef's fish, each with anatomy of its own. Every species is a body plan: the
// outline of the fish in side view (top and bottom of the profile along its length),
// the half width and the fullness of the cross-section, the eye, the mouth cleft, the
// gill cover, and the fins, each an insertion line in the skin and the outline of its
// free margin. The plans are written from the shapes of the animals rather than from
// one another: a chromis is a small oval with a forked tail, a clownfish a rounded
// disc with rounded fins, a tang a compressed oval with a pointed snout and a fin
// running the length of its back, a Moorish idol a disc taller than it is long with a
// tubular snout and a sail, a porcupinefish a broad rounded barrel with fans for
// pectorals and no pelvics at all, a gramma a small elongate basslet.
//
// Every plan shares one frame so the skins can be written once. Forward is +X: the
// snout is at x = 0.35 and the caudal fin's base, the hypural plate, at x = -0.295 for
// every species, so a fish's standard length is 0.645 model units whatever its shape;
// species differ in size by the `scale` of their entry in species.js. The spine runs
// along y = 0, z = 0 and the geometry is symmetric in z. Part ids (attribute aPart):
// 0 body, 1 caudal, 2 dorsal, 3 anal, 4 right pectoral, 5 left pectoral, 6 pelvic,
// 7 iris, 8 pupil, 9 oral slit, 10 corneal rim, 11 upper lip. aFinProgress runs 0 at a
// fin's hinge to 1 at its free edge. The swimming deformation in fish.js bends this
// geometry about the vertical axis and supplies vSkinPoint (rest position), vFishUV
// and vFishPart to the skin shader.

const TAU = Math.PI * 2;
// Exported because behaviour needs them: a fish eats with its snout, not its centre, and
// every feeding distance in fish.js is quoted in body lengths.
export const SNOUT_X = 0.35;
export const STANDARD_LENGTH = 0.645;
const HYPURAL_X = SNOUT_X - STANDARD_LENGTH;

const SECTION_WAIST = 2.15;
const BODY_ROWS = 84;
const BODY_COLUMNS = 62;
const MEMBRANE_STEPS = 8;
const RAY_SUBDIVISIONS = 4;

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
// A fin membrane is a fraction of a millimetre of collagen. The rays themselves are bone
// splints, so they stand in a backlit fin as dark striations however bright they look
// by reflection.
const MEMBRANE_THICKNESS = 0.004;
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

// Smooth interpolation through knots. Slopes are the neighbours' secant, which keeps
// the profile C1 without the overshoot a uniform parameterisation adds where the knots
// crowd together at the snout.
function splineThrough(knots) {
  const sorted = [...knots].sort((a, b) => a[0] - b[0]);
  const xs = sorted.map((knot) => knot[0]);
  const ys = sorted.map((knot) => knot[1]);
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

// ---------------------------------------------------------------------------------
// The body plans.
//
// `top` and `bottom` are the dorsal and ventral profile, [x, y] from snout to hypural;
// `width` the half width of the section, [x, w]; `fullness` [x, upper, lower] the
// exponents of the section's two halves: 2 is an ellipse, below 2 the section comes to
// a ridge, as the dorsum and the caudal peduncle do, above 2 it rounds out, as the
// skull and the belly do. `eye` is centre, radii and how far the cornea stands proud of
// the orbit; `opercle` the posterior margin of the gill cover, bowed back at mid-height;
// `mouth` the cleft from its corner to the snout tip. `scales` are the lateral and
// transverse scale counts; a tang's scales are too fine to show and a porcupinefish has
// none. `rays` are the ray counts by fin part, and `fins` the fins themselves: `base`
// is the insertion line, either along a median line of the profile or in the skin of
// the flank for a paired fin, `tip` the free margin, `edge` how deeply the membrane
// scallops between rays, `root` how far the insertion sinks into the skin.

const CHROMIS_PLAN = {
  key: "chromis",
  top: [[0.35, -0.002], [0.34, 0.018], [0.325, 0.042], [0.30, 0.072], [0.265, 0.1], [0.22, 0.124], [0.16, 0.142], [0.09, 0.152], [0.02, 0.152], [-0.05, 0.14], [-0.12, 0.112], [-0.18, 0.078], [-0.23, 0.052], [-0.27, 0.04], [HYPURAL_X, 0.036]],
  bottom: [[0.35, -0.01], [0.34, -0.03], [0.325, -0.052], [0.30, -0.076], [0.265, -0.098], [0.22, -0.116], [0.16, -0.13], [0.09, -0.137], [0.02, -0.136], [-0.05, -0.126], [-0.12, -0.102], [-0.18, -0.072], [-0.23, -0.05], [-0.27, -0.038], [HYPURAL_X, -0.034]],
  width: [[0.35, 0.004], [0.335, 0.014], [0.31, 0.026], [0.28, 0.036], [0.24, 0.044], [0.18, 0.049], [0.1, 0.05], [0.0, 0.046], [-0.1, 0.036], [-0.18, 0.024], [-0.24, 0.013], [HYPURAL_X, 0.006]],
  fullness: [[0.35, 2.4, 2.5], [0.25, 2.3, 2.4], [0.1, 2.0, 2.2], [-0.1, 1.85, 1.9], [-0.2, 1.55, 1.55], [HYPURAL_X, 1.4, 1.4]],
  eye: { x: 0.268, y: 0.03, radiusX: 0.03, radiusY: 0.029, bulge: 0.011 },
  opercle: { x: 0.185, bow: 0.03, y: 0.0, span: 0.1 },
  mouth: { cornerX: 0.325, cornerY: -0.018, tipX: 0.3495, tipY: -0.004 },
  scales: [30, 12],
  rays: { 1: 17, 2: 24, 3: 16, 4: 17, 5: 17, 6: 6 },
  fins: [
    // A deeply forked tail with rounded lobes.
    { part: 1, base: { hypural: [0.033, -0.031] }, tip: [[-0.30, 0.048], [-0.37, 0.09], [-0.43, 0.115], [-0.445, 0.105], [-0.40, 0.06], [-0.355, 0.012], [-0.345, -0.008], [-0.39, -0.05], [-0.43, -0.095], [-0.445, -0.108], [-0.415, -0.1], [-0.36, -0.085], [-0.30, -0.045]], edge: 0.022, root: 0.015 },
    // One dorsal, the spines in front lower than the soft rays behind, whose lobe is
    // drawn out over the peduncle.
    { part: 2, base: { median: [0.165, -0.195], dorsal: true }, tip: [[0.165, 0.175], [0.11, 0.198], [0.05, 0.207], [-0.02, 0.205], [-0.09, 0.2], [-0.15, 0.205], [-0.2, 0.195], [-0.24, 0.14]], edge: 0.03 },
    { part: 3, base: { median: [-0.045, -0.195], dorsal: false }, tip: [[-0.05, -0.168], [-0.1, -0.185], [-0.15, -0.19], [-0.2, -0.178], [-0.24, -0.13]], edge: 0.022 },
    { part: 4, paired: true, base: { skin: [[0.178, -0.012], [0.172, -0.03], [0.163, -0.05]] }, tip: [[0.13, -0.015, 0.06], [0.10, -0.03, 0.08], [0.07, -0.05, 0.09], [0.055, -0.075, 0.08], [0.07, -0.095, 0.065], [0.11, -0.09, 0.05]], sway: 0.002, roll: 0.004, edge: 0.024, root: 0.005 },
    { part: 6, paired: true, base: { skin: [[0.155, -0.118], [0.143, -0.125], [0.13, -0.128]] }, tip: [[0.135, -0.165, 0.025], [0.1, -0.2, 0.03], [0.06, -0.19, 0.022], [0.07, -0.15, 0.014]], sway: 0.0012, roll: 0.002, edge: 0.024, root: 0.005 },
  ],
};

const CLOWNFISH_PLAN = {
  key: "ocellaris",
  top: [[0.35, 0.0], [0.34, 0.025], [0.325, 0.052], [0.30, 0.085], [0.265, 0.115], [0.22, 0.14], [0.16, 0.158], [0.09, 0.166], [0.02, 0.165], [-0.05, 0.152], [-0.12, 0.122], [-0.18, 0.088], [-0.23, 0.06], [-0.27, 0.048], [HYPURAL_X, 0.044]],
  bottom: [[0.35, -0.008], [0.34, -0.03], [0.325, -0.056], [0.30, -0.085], [0.265, -0.11], [0.22, -0.13], [0.16, -0.145], [0.09, -0.152], [0.02, -0.15], [-0.05, -0.14], [-0.12, -0.115], [-0.18, -0.084], [-0.23, -0.058], [-0.27, -0.046], [HYPURAL_X, -0.042]],
  width: [[0.35, 0.005], [0.335, 0.016], [0.31, 0.03], [0.28, 0.042], [0.24, 0.052], [0.18, 0.058], [0.1, 0.06], [0.0, 0.055], [-0.1, 0.043], [-0.18, 0.03], [-0.24, 0.018], [HYPURAL_X, 0.009]],
  fullness: [[0.35, 2.5, 2.6], [0.25, 2.5, 2.6], [0.1, 2.3, 2.4], [-0.1, 2.0, 2.1], [-0.2, 1.7, 1.7], [HYPURAL_X, 1.6, 1.6]],
  eye: { x: 0.262, y: 0.035, radiusX: 0.029, radiusY: 0.028, bulge: 0.011 },
  opercle: { x: 0.18, bow: 0.028, y: 0.0, span: 0.11 },
  mouth: { cornerX: 0.325, cornerY: -0.014, tipX: 0.3495, tipY: -0.002 },
  scales: [28, 12],
  rays: { 1: 15, 2: 26, 3: 14, 4: 16, 5: 16, 6: 6 },
  fins: [
    // Every fin rounded: the tail a fan, the dorsal dipping between spines and soft rays.
    { part: 1, base: { hypural: [0.04, -0.04] }, tip: [[-0.31, 0.07], [-0.37, 0.1], [-0.42, 0.09], [-0.445, 0.05], [-0.45, 0.0], [-0.445, -0.05], [-0.42, -0.09], [-0.37, -0.1], [-0.31, -0.07]], edge: 0.03, root: 0.015 },
    { part: 2, base: { median: [0.15, -0.2], dorsal: true }, tip: [[0.15, 0.2], [0.1, 0.228], [0.05, 0.232], [0.0, 0.225], [-0.04, 0.21], [-0.07, 0.215], [-0.11, 0.235], [-0.16, 0.235], [-0.2, 0.215], [-0.23, 0.16]], edge: 0.028 },
    { part: 3, base: { median: [-0.06, -0.2], dorsal: false }, tip: [[-0.06, -0.19], [-0.1, -0.215], [-0.15, -0.225], [-0.2, -0.21], [-0.23, -0.16]], edge: 0.024 },
    { part: 4, paired: true, base: { skin: [[0.175, -0.005], [0.168, -0.03], [0.158, -0.055]] }, tip: [[0.13, 0.0, 0.065], [0.09, -0.015, 0.085], [0.05, -0.04, 0.095], [0.03, -0.07, 0.09], [0.045, -0.1, 0.075], [0.09, -0.105, 0.06]], sway: 0.002, roll: 0.004, edge: 0.026, root: 0.005 },
    { part: 6, paired: true, base: { skin: [[0.15, -0.13], [0.138, -0.14], [0.125, -0.143]] }, tip: [[0.13, -0.18, 0.03], [0.09, -0.215, 0.035], [0.045, -0.2, 0.028], [0.06, -0.16, 0.016]], sway: 0.0012, roll: 0.002, edge: 0.026, root: 0.005 },
  ],
};

const REGAL_TANG_PLAN = {
  key: "regal-tang",
  top: [[0.35, 0.0], [0.34, 0.02], [0.32, 0.05], [0.29, 0.088], [0.25, 0.125], [0.2, 0.155], [0.14, 0.175], [0.07, 0.185], [0.0, 0.182], [-0.07, 0.168], [-0.14, 0.138], [-0.2, 0.098], [-0.245, 0.062], [-0.275, 0.044], [HYPURAL_X, 0.038]],
  bottom: [[0.35, -0.008], [0.34, -0.026], [0.32, -0.05], [0.29, -0.08], [0.25, -0.11], [0.2, -0.135], [0.14, -0.152], [0.07, -0.162], [0.0, -0.16], [-0.07, -0.148], [-0.14, -0.122], [-0.2, -0.086], [-0.245, -0.056], [-0.275, -0.04], [HYPURAL_X, -0.036]],
  width: [[0.35, 0.004], [0.335, 0.012], [0.31, 0.022], [0.28, 0.03], [0.24, 0.036], [0.18, 0.04], [0.1, 0.041], [0.0, 0.038], [-0.1, 0.03], [-0.18, 0.02], [-0.24, 0.012], [HYPURAL_X, 0.006]],
  fullness: [[0.35, 2.3, 2.4], [0.25, 2.2, 2.3], [0.1, 1.9, 2.0], [-0.1, 1.8, 1.85], [-0.2, 1.6, 1.6], [HYPURAL_X, 1.5, 1.5]],
  eye: { x: 0.245, y: 0.065, radiusX: 0.026, radiusY: 0.025, bulge: 0.009 },
  opercle: { x: 0.17, bow: 0.03, y: 0.01, span: 0.12 },
  mouth: { cornerX: 0.33, cornerY: -0.012, tipX: 0.3495, tipY: -0.003 },
  scales: [70, 26],
  rays: { 1: 16, 2: 30, 3: 26, 4: 16, 5: 16, 6: 5 },
  fins: [
    // A lunate tail, and a dorsal and anal that run most of the body's length.
    { part: 1, base: { hypural: [0.036, -0.034] }, tip: [[-0.30, 0.06], [-0.36, 0.095], [-0.42, 0.12], [-0.445, 0.128], [-0.42, 0.08], [-0.395, 0.03], [-0.385, 0.0], [-0.395, -0.03], [-0.42, -0.08], [-0.445, -0.126], [-0.42, -0.118], [-0.36, -0.093], [-0.30, -0.058]], edge: 0.015, root: 0.015 },
    { part: 2, base: { median: [0.175, -0.24], dorsal: true }, tip: [[0.175, 0.2], [0.12, 0.235], [0.06, 0.25], [0.0, 0.25], [-0.07, 0.24], [-0.14, 0.215], [-0.2, 0.175], [-0.24, 0.13], [-0.265, 0.085]], edge: 0.012 },
    { part: 3, base: { median: [-0.01, -0.24], dorsal: false }, tip: [[-0.01, -0.2], [-0.07, -0.215], [-0.14, -0.2], [-0.2, -0.165], [-0.24, -0.125], [-0.265, -0.08]], edge: 0.012 },
    { part: 4, paired: true, base: { skin: [[0.165, 0.0], [0.16, -0.022], [0.152, -0.045]] }, tip: [[0.12, 0.01, 0.05], [0.08, -0.005, 0.065], [0.03, -0.03, 0.075], [0.025, -0.06, 0.068], [0.06, -0.085, 0.055], [0.11, -0.08, 0.042]], sway: 0.002, roll: 0.004, edge: 0.02, root: 0.005 },
    { part: 6, paired: true, base: { skin: [[0.14, -0.14], [0.13, -0.148], [0.118, -0.15]] }, tip: [[0.12, -0.185, 0.02], [0.08, -0.215, 0.024], [0.045, -0.2, 0.018], [0.06, -0.165, 0.012]], sway: 0.0012, roll: 0.002, edge: 0.02, root: 0.005 },
  ],
};

const YELLOW_TANG_PLAN = {
  key: "yellow-tang",
  // Deeper than the regal tang, the forehead concave over a produced snout, and the
  // dorsal and anal spread into sails.
  top: [[0.35, -0.005], [0.34, 0.012], [0.32, 0.035], [0.29, 0.065], [0.25, 0.105], [0.2, 0.15], [0.14, 0.185], [0.07, 0.2], [0.0, 0.2], [-0.07, 0.185], [-0.14, 0.15], [-0.2, 0.105], [-0.245, 0.066], [-0.275, 0.046], [HYPURAL_X, 0.04]],
  bottom: [[0.35, -0.014], [0.34, -0.032], [0.32, -0.056], [0.29, -0.085], [0.25, -0.118], [0.2, -0.148], [0.14, -0.172], [0.07, -0.185], [0.0, -0.185], [-0.07, -0.17], [-0.14, -0.14], [-0.2, -0.098], [-0.245, -0.062], [-0.275, -0.044], [HYPURAL_X, -0.038]],
  width: [[0.35, 0.004], [0.335, 0.011], [0.31, 0.02], [0.28, 0.028], [0.24, 0.034], [0.18, 0.038], [0.1, 0.04], [0.0, 0.037], [-0.1, 0.03], [-0.18, 0.02], [-0.24, 0.012], [HYPURAL_X, 0.006]],
  fullness: [[0.35, 2.3, 2.4], [0.25, 2.2, 2.3], [0.1, 1.9, 2.0], [-0.1, 1.8, 1.85], [-0.2, 1.6, 1.6], [HYPURAL_X, 1.5, 1.5]],
  eye: { x: 0.235, y: 0.075, radiusX: 0.025, radiusY: 0.024, bulge: 0.009 },
  opercle: { x: 0.165, bow: 0.03, y: 0.01, span: 0.13 },
  mouth: { cornerX: 0.335, cornerY: -0.016, tipX: 0.3495, tipY: -0.008 },
  scales: [70, 26],
  rays: { 1: 16, 2: 28, 3: 22, 4: 15, 5: 15, 6: 5 },
  fins: [
    { part: 1, base: { hypural: [0.038, -0.036] }, tip: [[-0.30, 0.07], [-0.36, 0.105], [-0.42, 0.13], [-0.44, 0.135], [-0.425, 0.08], [-0.415, 0.03], [-0.412, 0.0], [-0.415, -0.03], [-0.425, -0.08], [-0.44, -0.135], [-0.42, -0.13], [-0.36, -0.105], [-0.30, -0.068]], edge: 0.014, root: 0.015 },
    { part: 2, base: { median: [0.17, -0.24], dorsal: true }, tip: [[0.17, 0.22], [0.11, 0.29], [0.05, 0.33], [-0.01, 0.34], [-0.07, 0.33], [-0.13, 0.3], [-0.19, 0.245], [-0.235, 0.17], [-0.265, 0.1]], edge: 0.012 },
    { part: 3, base: { median: [-0.02, -0.24], dorsal: false }, tip: [[-0.02, -0.24], [-0.07, -0.28], [-0.13, -0.28], [-0.19, -0.235], [-0.235, -0.165], [-0.265, -0.095]], edge: 0.012 },
    { part: 4, paired: true, base: { skin: [[0.16, 0.005], [0.155, -0.02], [0.147, -0.045]] }, tip: [[0.115, 0.015, 0.05], [0.075, 0.0, 0.065], [0.025, -0.03, 0.075], [0.02, -0.06, 0.068], [0.055, -0.088, 0.055], [0.105, -0.082, 0.042]], sway: 0.002, roll: 0.004, edge: 0.02, root: 0.005 },
    { part: 6, paired: true, base: { skin: [[0.14, -0.16], [0.13, -0.168], [0.118, -0.17]] }, tip: [[0.12, -0.21, 0.02], [0.075, -0.25, 0.024], [0.04, -0.23, 0.018], [0.06, -0.19, 0.012]], sway: 0.0012, roll: 0.002, edge: 0.02, root: 0.005 },
  ],
};

const MOORISH_IDOL_PLAN = {
  key: "moorish-idol",
  // A disc nearly as deep as it is long, drawn out forward into a tubular snout with
  // the mouth at its tip below the axis, and a sail of a dorsal whose front rays trail
  // back past the tail as the filament.
  top: [[0.35, -0.02], [0.335, -0.005], [0.31, 0.02], [0.28, 0.055], [0.25, 0.1], [0.21, 0.16], [0.16, 0.225], [0.1, 0.275], [0.04, 0.3], [-0.03, 0.298], [-0.1, 0.27], [-0.17, 0.205], [-0.225, 0.13], [-0.265, 0.07], [HYPURAL_X, 0.05]],
  bottom: [[0.35, -0.036], [0.335, -0.05], [0.31, -0.065], [0.28, -0.088], [0.25, -0.12], [0.21, -0.16], [0.16, -0.2], [0.1, -0.235], [0.04, -0.25], [-0.03, -0.248], [-0.1, -0.228], [-0.17, -0.18], [-0.225, -0.118], [-0.265, -0.068], [HYPURAL_X, -0.048]],
  width: [[0.35, 0.005], [0.335, 0.009], [0.31, 0.014], [0.28, 0.02], [0.24, 0.027], [0.18, 0.033], [0.1, 0.036], [0.0, 0.034], [-0.1, 0.028], [-0.18, 0.02], [-0.24, 0.012], [HYPURAL_X, 0.007]],
  fullness: [[0.35, 2.4, 2.4], [0.28, 2.2, 2.3], [0.1, 1.8, 1.9], [-0.1, 1.75, 1.8], [-0.2, 1.6, 1.6], [HYPURAL_X, 1.5, 1.5]],
  eye: { x: 0.215, y: 0.09, radiusX: 0.028, radiusY: 0.027, bulge: 0.009 },
  opercle: { x: 0.16, bow: 0.035, y: 0.02, span: 0.17 },
  mouth: { cornerX: 0.335, cornerY: -0.036, tipX: 0.3495, tipY: -0.028 },
  scales: [80, 30],
  rays: { 1: 16, 2: 30, 3: 26, 4: 17, 5: 17, 6: 5 },
  fins: [
    { part: 1, base: { hypural: [0.048, -0.046] }, tip: [[-0.30, 0.075], [-0.35, 0.1], [-0.41, 0.125], [-0.43, 0.13], [-0.42, 0.08], [-0.412, 0.03], [-0.41, 0.0], [-0.412, -0.03], [-0.42, -0.08], [-0.43, -0.13], [-0.41, -0.125], [-0.35, -0.1], [-0.30, -0.073]], edge: 0.014, root: 0.015 },
    { part: 2, base: { median: [0.12, -0.23], dorsal: true, sink: 0.008 }, tip: [[0.125, 0.36], [0.08, 0.45], [0.02, 0.5], [-0.06, 0.5], [-0.16, 0.46], [-0.27, 0.4], [-0.38, 0.33], [-0.47, 0.26]], edge: 0.012, root: 0.01 },
    { part: 3, base: { median: [-0.03, -0.23], dorsal: false }, tip: [[-0.03, -0.3], [-0.09, -0.34], [-0.16, -0.33], [-0.23, -0.28], [-0.28, -0.2], [-0.3, -0.12]], edge: 0.012 },
    { part: 4, paired: true, base: { skin: [[0.16, 0.02], [0.155, -0.005], [0.148, -0.03]] }, tip: [[0.12, 0.03, 0.045], [0.085, 0.015, 0.06], [0.05, -0.01, 0.068], [0.045, -0.04, 0.062], [0.07, -0.065, 0.05], [0.11, -0.06, 0.04]], sway: 0.002, roll: 0.004, edge: 0.02, root: 0.005 },
    { part: 6, paired: true, base: { skin: [[0.15, -0.18], [0.14, -0.19], [0.128, -0.195]] }, tip: [[0.13, -0.24, 0.02], [0.07, -0.31, 0.025], [0.02, -0.3, 0.018], [0.05, -0.23, 0.012]], sway: 0.0012, roll: 0.002, edge: 0.02, root: 0.005 },
  ],
};

const PORCUPINE_PUFFER_PLAN = {
  key: "porcupine-puffer",
  // A barrel nearly as wide as it is deep, the head the broadest part, the eyes large
  // and high on it, the dorsal and anal small and set far back opposite one another,
  // the pectorals broad fans, the tail a paddle, and no pelvic fins.
  top: [[0.35, 0.0], [0.34, 0.03], [0.325, 0.055], [0.30, 0.085], [0.265, 0.108], [0.22, 0.125], [0.16, 0.134], [0.09, 0.135], [0.02, 0.128], [-0.05, 0.114], [-0.12, 0.092], [-0.18, 0.066], [-0.23, 0.045], [-0.27, 0.032], [HYPURAL_X, 0.028]],
  bottom: [[0.35, -0.012], [0.34, -0.04], [0.325, -0.065], [0.30, -0.09], [0.265, -0.11], [0.22, -0.125], [0.16, -0.135], [0.09, -0.138], [0.02, -0.132], [-0.05, -0.118], [-0.12, -0.094], [-0.18, -0.066], [-0.23, -0.044], [-0.27, -0.03], [HYPURAL_X, -0.026]],
  width: [[0.35, 0.008], [0.335, 0.03], [0.31, 0.055], [0.28, 0.078], [0.24, 0.098], [0.18, 0.112], [0.1, 0.118], [0.0, 0.108], [-0.1, 0.082], [-0.18, 0.05], [-0.24, 0.026], [HYPURAL_X, 0.012]],
  fullness: [[0.35, 2.5, 2.6], [0.2, 2.4, 2.5], [0.0, 2.3, 2.4], [-0.15, 2.1, 2.1], [HYPURAL_X, 1.9, 1.9]],
  eye: { x: 0.245, y: 0.055, radiusX: 0.036, radiusY: 0.035, bulge: 0.014 },
  opercle: { x: 0.175, bow: 0.02, y: 0.0, span: 0.1 },
  mouth: { cornerX: 0.335, cornerY: -0.01, tipX: 0.3495, tipY: -0.004 },
  scales: [200, 60],
  rays: { 1: 10, 2: 14, 3: 14, 4: 22, 5: 22 },
  fins: [
    { part: 1, base: { hypural: [0.026, -0.024] }, tip: [[-0.31, 0.05], [-0.37, 0.075], [-0.42, 0.06], [-0.445, 0.025], [-0.45, 0.0], [-0.445, -0.025], [-0.42, -0.06], [-0.37, -0.075], [-0.31, -0.05]], edge: 0.026, root: 0.012 },
    { part: 2, base: { median: [-0.11, -0.22], dorsal: true, sink: 0.005 }, tip: [[-0.12, 0.13], [-0.17, 0.15], [-0.22, 0.14], [-0.26, 0.1]], edge: 0.024 },
    { part: 3, base: { median: [-0.11, -0.22], dorsal: false, sink: 0.005 }, tip: [[-0.12, -0.13], [-0.17, -0.15], [-0.22, -0.14], [-0.26, -0.1]], edge: 0.024 },
    { part: 4, paired: true, base: { skin: [[0.16, 0.03], [0.152, 0.0], [0.142, -0.03], [0.13, -0.055]] }, tip: [[0.12, 0.06, 0.14], [0.07, 0.05, 0.165], [0.03, 0.02, 0.175], [0.015, -0.02, 0.17], [0.025, -0.06, 0.155], [0.06, -0.09, 0.135], [0.1, -0.09, 0.12]], sway: 0.003, roll: 0.006, edge: 0.026, root: 0.006 },
  ],
};

const ROYAL_GRAMMA_PLAN = {
  key: "royal-gramma",
  // A small elongate basslet: a blunt head with a large eye and an oblique mouth, a
  // dorsal along the whole back, a rounded tail and long pelvics.
  top: [[0.35, 0.0], [0.34, 0.018], [0.325, 0.038], [0.30, 0.06], [0.265, 0.078], [0.22, 0.09], [0.16, 0.098], [0.09, 0.1], [0.02, 0.098], [-0.05, 0.09], [-0.12, 0.078], [-0.18, 0.062], [-0.23, 0.048], [-0.27, 0.04], [HYPURAL_X, 0.037]],
  bottom: [[0.35, -0.012], [0.34, -0.032], [0.325, -0.05], [0.30, -0.066], [0.265, -0.078], [0.22, -0.086], [0.16, -0.09], [0.09, -0.091], [0.02, -0.088], [-0.05, -0.08], [-0.12, -0.068], [-0.18, -0.056], [-0.23, -0.045], [-0.27, -0.038], [HYPURAL_X, -0.035]],
  width: [[0.35, 0.005], [0.335, 0.016], [0.31, 0.03], [0.28, 0.04], [0.24, 0.046], [0.18, 0.048], [0.1, 0.046], [0.0, 0.04], [-0.1, 0.032], [-0.18, 0.024], [-0.24, 0.016], [HYPURAL_X, 0.009]],
  fullness: [[0.35, 2.4, 2.5], [0.25, 2.3, 2.4], [0.1, 2.1, 2.2], [-0.1, 1.9, 1.9], [-0.2, 1.7, 1.7], [HYPURAL_X, 1.6, 1.6]],
  eye: { x: 0.268, y: 0.022, radiusX: 0.03, radiusY: 0.029, bulge: 0.011 },
  opercle: { x: 0.185, bow: 0.025, y: -0.005, span: 0.07 },
  mouth: { cornerX: 0.315, cornerY: -0.02, tipX: 0.3495, tipY: -0.003 },
  scales: [30, 10],
  rays: { 1: 15, 2: 22, 3: 12, 4: 15, 5: 15, 6: 5 },
  fins: [
    { part: 1, base: { hypural: [0.034, -0.032] }, tip: [[-0.31, 0.06], [-0.37, 0.085], [-0.42, 0.075], [-0.445, 0.04], [-0.45, 0.0], [-0.445, -0.04], [-0.42, -0.075], [-0.37, -0.085], [-0.31, -0.06]], edge: 0.028, root: 0.014 },
    { part: 2, base: { median: [0.16, -0.22], dorsal: true }, tip: [[0.16, 0.13], [0.1, 0.145], [0.04, 0.15], [-0.03, 0.15], [-0.09, 0.15], [-0.14, 0.158], [-0.19, 0.162], [-0.23, 0.15], [-0.26, 0.1]], edge: 0.028 },
    { part: 3, base: { median: [-0.08, -0.22], dorsal: false }, tip: [[-0.08, -0.13], [-0.13, -0.15], [-0.18, -0.158], [-0.23, -0.145], [-0.26, -0.1]], edge: 0.024 },
    { part: 4, paired: true, base: { skin: [[0.175, -0.012], [0.168, -0.032], [0.16, -0.05]] }, tip: [[0.13, -0.01, 0.055], [0.095, -0.02, 0.07], [0.06, -0.04, 0.078], [0.05, -0.065, 0.07], [0.07, -0.085, 0.058], [0.11, -0.08, 0.048]], sway: 0.002, roll: 0.004, edge: 0.024, root: 0.005 },
    { part: 6, paired: true, base: { skin: [[0.16, -0.085], [0.15, -0.09], [0.138, -0.09]] }, tip: [[0.14, -0.13, 0.025], [0.09, -0.175, 0.03], [0.04, -0.165, 0.022], [0.06, -0.12, 0.014]], sway: 0.0012, roll: 0.002, edge: 0.024, root: 0.005 },
  ],
};

export const PLANS = {
  chromis: CHROMIS_PLAN,
  ocellaris: CLOWNFISH_PLAN,
  "regal-tang": REGAL_TANG_PLAN,
  "yellow-tang": YELLOW_TANG_PLAN,
  "moorish-idol": MOORISH_IDOL_PLAN,
  "porcupine-puffer": PORCUPINE_PUFFER_PLAN,
  "royal-gramma": ROYAL_GRAMMA_PLAN,
};

// ---------------------------------------------------------------------------------
// The body surface of a plan.

class Body {
  constructor(plan) {
    this.plan = plan;
    this.top = splineThrough(plan.top);
    this.bottom = splineThrough(plan.bottom);
    this.width = splineThrough(plan.width);
    this.fullUp = splineThrough(plan.fullness.map(([x, up]) => [x, up]));
    this.fullDown = splineThrough(plan.fullness.map(([x, , down]) => [x, down]));
    this.opercle = plan.opercle;
    this.mouth = plan.mouth;
    // The eyeball is a flattened lens seated in the orbit. The orbit is sunk into the
    // skin so that the dome of the cornea rises just clear of the surrounding surface,
    // and the body surface takes on the eyeball's shape inside the orbit, so the eye can
    // never part from the head.
    const eye = plan.eye;
    const section = this.profile(eye.x);
    const v = THREE.MathUtils.clamp(this.depthCoordinate(section, eye.y), -1, 1);
    const flank = this.sectionZ(eye.x, v, section, eye.y, false);
    this.eye = {
      ...eye,
      inset: flank - eye.bulge * 0.85,
      pupil: 0.6,
      iris: 0.93,
      rim: 0.985,
    };
  }

  profile(x) {
    const clamped = THREE.MathUtils.clamp(x, HYPURAL_X, SNOUT_X);
    return {
      top: this.top(clamped),
      bottom: this.bottom(clamped),
      width: this.width(clamped),
      fullUp: this.fullUp(clamped),
      fullDown: this.fullDown(clamped),
    };
  }

  opercleX(y) {
    const o = this.opercle;
    const t = THREE.MathUtils.clamp((y - o.y) / o.span, -1, 1);
    return o.x - o.bow * (1 - t * t);
  }

  mouthCleftY(x) {
    const m = this.mouth;
    const k = THREE.MathUtils.clamp((x - m.cornerX) / (m.tipX - m.cornerX), 0, 1);
    return THREE.MathUtils.lerp(m.cornerY, m.tipY, k * k * (3 - 2 * k));
  }

  // Depth coordinate v runs -1 at the ventral midline to +1 at the dorsal. Returns the
  // height of the surface there.
  sectionY(section, v) {
    const centre = (section.top + section.bottom) * 0.5;
    return v >= 0
      ? centre + v * (section.top - centre)
      : centre + v * (centre - section.bottom);
  }

  depthCoordinate(section, y) {
    const centre = (section.top + section.bottom) * 0.5;
    return y >= centre
      ? (y - centre) / Math.max(section.top - centre, 1e-6)
      : (y - centre) / Math.max(centre - section.bottom, 1e-6);
  }

  // Half width of the surface at (x, v), with the features that make a head read as a
  // head: the gill chamber swelling the cheek, the orbit taking the eyeball's shape,
  // the opercular edge and the mouth cleft.
  sectionZ(x, v, section, y, withOrbit = true) {
    const fullness = v >= 0 ? section.fullUp : section.fullDown;
    const waist = Math.pow(
      Math.max(0, 1 - Math.pow(Math.abs(v), SECTION_WAIST)),
      1 / fullness,
    );
    const cheekX = this.opercle.x + 0.015;
    const cheek =
      1 +
      0.09 *
        Math.exp(-(((x - cheekX) / 0.045) ** 2)) *
        THREE.MathUtils.smoothstep(-v, -0.35, 0.5);
    let z = section.width * waist * cheek;

    const margin = this.opercleX(y);
    z += 0.0013 * Math.exp(-(((x - margin - 0.009) / 0.008) ** 2));
    z -= 0.0023 * Math.exp(-(((x - margin) / 0.005) ** 2));

    const m = this.mouth;
    const cleft = Math.exp(-(((y - this.mouthCleftY(x)) / 0.0045) ** 2));
    const gape = THREE.MathUtils.smoothstep(x, m.cornerX - 0.012, m.cornerX + 0.006);
    z -= Math.min(0.0019 * cleft * gape, z * 0.42);

    if (withOrbit) {
      const eye = this.eye;
      const orbit = Math.hypot((x - eye.x) / eye.radiusX, (y - eye.y) / eye.radiusY);
      if (orbit < 1.3) {
        const dome = eye.inset + eye.bulge * Math.sqrt(Math.max(0, 1 - orbit * orbit));
        const weight = 1 - THREE.MathUtils.smoothstep(orbit, 0.92, 1.62);
        z = THREE.MathUtils.lerp(z, dome, weight);
      }
    }
    return Math.max(z, 0.0004);
  }

  surfacePoint(x, v, side, target = new THREE.Vector3()) {
    const section = this.profile(x);
    const y = this.sectionY(section, v);
    return target.set(x, y, side * this.sectionZ(x, v, section, y));
  }

  surfaceAt(x, y, side, target = new THREE.Vector3()) {
    const section = this.profile(x);
    const v = THREE.MathUtils.clamp(this.depthCoordinate(section, y), -1, 1);
    return target.set(x, y, side * this.sectionZ(x, v, section, y));
  }

  surfaceNormal(x, y, side, target = new THREE.Vector3()) {
    const step = 0.0015;
    const here = this.surfaceAt(x, y, side);
    const alongX = this.surfaceAt(x + step, y, side).sub(here);
    const alongY = this.surfaceAt(x, y + step, side).sub(here);
    return target.crossVectors(alongX, alongY).multiplyScalar(side).normalize();
  }

  // Rows are spaced by the integral of a density that peaks where the profile turns
  // hardest: the snout, the orbit, the opercular margin and the caudal peduncle.
  rows(count) {
    const gauss = (x, centre, width) => Math.exp(-(((x - centre) / width) ** 2));
    const density = (x) =>
      1 +
      1.6 * gauss(x, SNOUT_X, 0.045) +
      1.8 * gauss(x, this.eye.x, 0.05) +
      1.2 * gauss(x, this.opercle.x, 0.04) +
      1.2 * gauss(x, HYPURAL_X, 0.05);
    const samples = 1600;
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
      rows.push(HYPURAL_X + ((SNOUT_X - HYPURAL_X) * (cursor + fraction)) / samples);
    }
    return rows.reverse();
  }

  // The body shell: a closed tube whose columns start on the dorsal midline, so the uv
  // seam and the normals' only discontinuity fall under the dorsal fin. uv.x runs 0 at
  // the snout to 1 at the hypural; uv.y is the arc fraction from the dorsal midline to
  // the ventral, identical on both flanks, which is how scale rows actually sit.
  geometry() {
    const positions = [];
    const uvs = [];
    const indices = [];
    const rows = this.rows(BODY_ROWS);
    const columns = BODY_COLUMNS;
    const point = new THREE.Vector3();
    const previous = new THREE.Vector3();
    const halfArc = [];
    const arcs = [];

    for (const x of rows) {
      let arc = 0;
      halfArc.length = 0;
      halfArc.push(0);
      this.surfacePoint(x, 1, 1, previous);
      for (let column = 1; column <= columns / 2; column++) {
        const v = Math.cos((column / (columns / 2)) * Math.PI);
        this.surfacePoint(x, v, 1, point);
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
        this.surfacePoint(x, v, mirrored ? 1 : -1, point);
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
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
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
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute("aPart", new THREE.Float32BufferAttribute(parts, 1));
      geometry.setAttribute("aFinProgress", new THREE.Float32BufferAttribute(progress, 1));
      geometry.setIndex(indices);
      return geometry;
    },
  };
}

function fromArrays(positions, normals, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  }
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// A spherical-cap patch of the eyeball, cut between two radius fractions. All three
// eye patches share the analytic normal of the same lens, so the pupil, iris and
// corneal rim meet without a shading crease.
function eyeCap(eye, side, inner, outer, rings, segments, lift, rimLift) {
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
        (dx * eye.radiusX) / (eye.bulge * eye.bulge),
        (dy * eye.radiusY) / (eye.bulge * eye.bulge),
        (side * height) / eye.bulge,
      ).normalize();
      positions.push(
        eye.x + dx * eye.radiusX + normal.x * clearance,
        eye.y + dy * eye.radiusY + normal.y * clearance,
        side * (eye.inset + eye.bulge * height) + normal.z * clearance,
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
function cleftRibbon(body, side, fromY, toY, offset, segments) {
  const positions = [],
    normals = [],
    uvs = [],
    indices = [];
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const m = body.mouth;
  for (let segment = 0; segment <= segments; segment++) {
    const k = segment / segments;
    const x = THREE.MathUtils.lerp(m.cornerX - 0.004, m.tipX, k);
    const taper = Math.sin(Math.min(1, 1.25 * (1 - k)) * Math.PI * 0.5);
    for (const edge of [0, 1]) {
      const y = body.mouthCleftY(x) + THREE.MathUtils.lerp(fromY, toY, edge) * taper;
      body.surfaceAt(x, y, side, point);
      body.surfaceNormal(x, y, side, normal);
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
// real fin its finely scalloped edge. The whole fin is one double-sided sheet; the rays
// are drawn by the skin shader.
function finFan(
  { part, rays, base, tip, sway = 0, roll = 0, edge = 0.055, root = 0.006 },
  membranes,
) {
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
  // No two rays reach exactly the same distance: that is what makes a real fin's edge
  // finely uneven.
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
// wherever the profile happens to run. A median fin runs along the dorsal or ventral
// midline; the caudal fin along the hypural margin; a paired fin sits in the skin of
// one flank, mirrored for the other.
function insertionLine(body, base, side) {
  if (base.median) {
    const [from, to] = base.median;
    const sink = base.sink ?? 0.006;
    const samples = Math.max(4, Math.round(Math.abs(to - from) / 0.04));
    const line = [];
    for (let i = 0; i <= samples; i++) {
      const x = THREE.MathUtils.lerp(from, to, i / samples);
      const section = body.profile(x);
      const y = base.dorsal ? section.top - sink : section.bottom + sink;
      line.push([x, y, 0]);
    }
    return line;
  }
  if (base.hypural) {
    const [top, bottom] = base.hypural;
    return [
      [HYPURAL_X + 0.024, top, 0],
      [HYPURAL_X + 0.009, top * 0.62, 0],
      [HYPURAL_X + 0.004, 0, 0],
      [HYPURAL_X + 0.009, bottom * 0.62, 0],
      [HYPURAL_X + 0.024, bottom, 0],
    ];
  }
  return base.skin.map(([x, y]) => body.surfaceAt(x, y, side).toArray());
}

export function makeAnatomy(plan) {
  const body = new Body(plan);
  const opaque = geometryBuilder();
  const membranes = geometryBuilder();
  opaque.add(body.geometry(), 0);

  for (const side of [-1, 1]) {
    opaque.add(eyeCap(body.eye, side, 0, body.eye.pupil, 4, 30, 0.0009, 0.0013), 8);
    opaque.add(eyeCap(body.eye, side, body.eye.pupil, body.eye.iris, 5, 30, 0.0006, 0.0013), 7);
    opaque.add(eyeCap(body.eye, side, body.eye.iris, body.eye.rim, 2, 30, 0.0004, 0.0013), 10);
    opaque.add(cleftRibbon(body, side, -0.0016, 0.0016, -0.001, 7), 9);
    opaque.add(cleftRibbon(body, side, 0.0022, 0.005, 0.0005, 7), 11);
  }

  for (const fin of plan.fins) {
    const rays = plan.rays[fin.part] || 3;
    if (!fin.paired) {
      finFan({ ...fin, rays, base: insertionLine(body, fin.base, 1) }, membranes);
      continue;
    }
    for (const side of [1, -1]) {
      finFan(
        {
          ...fin,
          rays,
          part: fin.part === 4 ? (side > 0 ? 4 : 5) : fin.part,
          base: insertionLine(body, fin.base, side),
          tip: fin.tip.map(([x, y, z]) => [x, y, side * z]),
          sway: side * (fin.sway || 0),
          roll: side * (fin.roll || 0),
        },
        membranes,
      );
    }
  }

  return {
    body: opaque.finish(),
    fins: membranes.finish(),
    plan,
    eye: body.eye,
  };
}

// Colour, scales, guanine sheen and fin membranes in the fragment stage. The vertex
// stage (owned by fish.js) supplies vSkinPoint, vFishUV and vFishPart; the water light
// model is wired here so the fish receive the same surface focusing and depth
// absorption as everything else lit in the tank.
const c3 = (v) => `vec3(${v.map(glsl).join(", ")})`;

// The blue-green chromis, and the shape every other reef species is written in: body
// colours from dorsum to belly, the mirror, the fins, the eye, and a `pattern` of GLSL
// that runs over the finished body colour with `skin`, `fishX`, `fishBand`, `fishHead`
// and `fishHash` in scope, for bars and spots. `finPattern` does the same for the fins
// with `diffuseColor`, `span` (0 at the base, 1 at the margin) and `along`.
export const CHROMIS = {
  key: "chromis",
  dorsal: [0.06, 0.19, 0.12],
  dorsalLow: [0.12, 0.33, 0.24],
  flank: [0.33, 0.64, 0.56],
  belly: [0.56, 0.72, 0.64],
  bellyLow: [0.68, 0.76, 0.68],
  sheen: [0.25, 0.7, 0.66],
  sheenBand: 0.36,
  sheenWidth: 0.2,
  sheenStrength: 0.75,
  peduncle: [0.42, 0.56, 0.3],
  peduncleStrength: 0.3,
  sheath: [0.3, 0.52, 0.36],
  gill: [0.33, 0.24, 0.2],
  cheekDark: [0.09, 0.24, 0.16],
  cheekLight: [0.34, 0.62, 0.56],
  skull: [0.08, 0.2, 0.13],
  snout: [0.12, 0.22, 0.16],
  orbit: [0.52, 0.64, 0.42],
  pattern: "",
  membrane: [0.15, 0.19, 0.17],
  finPigment: [0.24, 0.52, 0.42],
  finReach: 0.72,
  finPaleTip: [0.38, 0.44, 0.4],
  finPattern: "",
  finAbsorption: [1.6, 0.6, 1.4],
  iris: [0.56, 0.64, 0.38],
  irisDark: [0.26, 0.32, 0.15],
};

export function applySkin(shader, palette = CHROMIS, plan = CHROMIS_PLAN) {
  const p = { ...CHROMIS, ...palette };
  const eye = plan.eye;
  const opercle = plan.opercle;
  const mouth = plan.mouth;
  const rays = plan.rays;
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
      const vec3 FISH_FIN_PIGMENT = ${c3(p.finAbsorption)};
      const vec2 FISH_SCALES = vec2(${glsl(plan.scales[0])}, ${glsl(plan.scales[1])});
      const vec2 FISH_EYE = vec2(${glsl(eye.x)}, ${glsl(eye.y)});
      const vec2 FISH_EYE_RADIUS = vec2(${glsl(eye.radiusX)}, ${glsl(eye.radiusY)});

      float fishHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      // What a slab of tissue this thick sends back out diffusely: what survives the
      // absorption along the path, the tissue's own and any pigment standing in it,
      // times the share the tissue scatters instead of passing straight on.
      vec3 fishThrough(float path, vec3 pigment) {
        return exp(-FISH_ABSORPTION * path - pigment)
          * (1.0 - exp(-${glsl(TISSUE_SCATTER)} * path));
      }

      // Imbricate rows: every row is offset half a scale from its neighbour and the
      // rows run slightly diagonally.
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
        float t = clamp((y - ${glsl(opercle.y)}) / ${glsl(opercle.span)}, -1.0, 1.0);
        return ${glsl(opercle.x)} - ${glsl(opercle.bow)} * (1.0 - t * t);
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
        float k = clamp((x - ${glsl(mouth.cornerX)}) / ${glsl(mouth.tipX - mouth.cornerX)}, 0.0, 1.0);
        return mix(${glsl(mouth.cornerY)}, ${glsl(mouth.tipY)}, k * k * (3.0 - 2.0 * k));
      }
      float fishRayCount(float part) {
        ${Object.entries(rays)
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
        // Countershading: a darker dorsum, a flank that mirrors the water, a paler belly.
        vec3 skin = mix(${c3(p.dorsal)}, ${c3(p.dorsalLow)},
          smoothstep(0.02, 0.135, fishBand));
        skin = mix(skin, ${c3(p.flank)}, smoothstep(0.185, 0.42, fishBand));
        float bellyReach = smoothstep(-0.26, -0.12, fishX);
        skin = mix(skin, ${c3(p.belly)},
          smoothstep(0.52, 0.84, fishBand) * bellyReach);
        skin = mix(skin, ${c3(p.bellyLow)},
          smoothstep(0.88, 1.0, fishBand) * bellyReach);

        // The reflector: broad, strongest a little above the midline.
        float sheen = exp(-pow((fishBand - ${glsl(p.sheenBand)}) / ${glsl(p.sheenWidth)}, 2.0))
          * smoothstep(-0.285, -0.225, fishX)
          * (1.0 - smoothstep(0.188, 0.245, fishX));
        vec2 sheenGrid = fishScaleGrid();
        float mottle = 1.0 + (fishHash(floor(sheenGrid) + 7.0) - 0.5) * 0.18
          * fishFade(sheenGrid);
        skin = mix(skin, ${c3(p.sheen)} * mottle, sheen * ${glsl(p.sheenStrength)});

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

        // The caudal peduncle goes a little warmer toward the tail, and the gill
        // chamber shows faintly through thin opercular skin.
        float warm = (1.0 - smoothstep(-0.27, 0.0, fishX))
          * smoothstep(0.32, 0.60, fishBand) * (1.0 - smoothstep(0.88, 1.0, fishBand));
        skin = mix(skin, ${c3(p.peduncle)}, warm * ${glsl(p.peduncleStrength)});
        float sheath = 1.0 - smoothstep(-0.292, -0.240, fishX);
        skin = mix(skin, ${c3(p.sheath)}, sheath * 0.45);
        float gill = exp(-pow((fishX - ${glsl(opercle.x - 0.01)}) / 0.026, 2.0)
          - pow((fishBand - 0.66) / 0.16, 2.0));
        skin = mix(skin, ${c3(p.gill)}, gill * 0.16);

        // Head: the cheek and opercle carry the same mirror as the flank, and the
        // snout is a shade darker.
        vec3 cheek = mix(${c3(p.cheekDark)}, ${c3(p.cheekLight)},
          smoothstep(0.13, 0.40, fishBand));
        skin = mix(skin, cheek, fishHead * 0.92);
        skin = mix(skin, ${c3(p.skull)}, smoothstep(0.250, 0.330, fishX) * 0.7);
        skin = mix(skin, ${c3(p.snout)}, smoothstep(0.330, 0.350, fishX) * 0.6);

        // The species' own markings, over the finished ground colour.
        ${p.pattern}

        // The opercular edge: a fine dark seam with the pale bony lip in front of it.
        float margin = fishX - fishOpercleX(fishY);
        float opercleFace = 1.0 - smoothstep(0.84, 1.0, fishBand);
        skin *= 1.0 - 0.60 * exp(-pow(margin / 0.0028, 2.0)) * opercleFace;
        skin *= 1.0 + 0.28 * exp(-pow((margin - 0.008) / 0.005, 2.0)) * opercleFace;

        // Mouth cleft, and the ring of skin around the orbit.
        float cleft = exp(-pow((fishY - fishCleftY(fishX)) / 0.0030, 2.0))
          * smoothstep(${glsl(mouth.cornerX - 0.018)}, ${glsl(mouth.cornerX)}, fishX);
        skin = mix(skin, vec3(0.040, 0.028, 0.024), cleft * 0.85);
        float orbit = fishOrbit();
        float ring = (1.0 - smoothstep(1.00, 1.18, orbit)) * smoothstep(0.88, 0.99, orbit);
        skin = mix(skin, ${c3(p.orbit)}, ring * 0.8);

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
          + vec3(0.14, 0.11, 0.06) * gill;
      } else if (vFishPart < 6.5) {
        float caudal = 1.0 - step(1.5, vFishPart);
        float pectoral = step(3.5, vFishPart) * (1.0 - step(5.5, vFishPart));
        float paleTip = step(2.5, vFishPart) * (1.0 - step(3.5, vFishPart))
          + step(5.5, vFishPart) * (1.0 - step(6.5, vFishPart));
        float span = clamp(vFishUV.y, 0.0, 1.0);
        float along = clamp(vFishUV.x, 0.0, 1.0);
        float rays = fishRayCount(vFishPart);

        // Membrane: nearly colourless, so the coral and water behind the fin show
        // through it.
        vec3 membrane = ${c3(p.membrane)};
        // The body's colour carries a little way into the fin bases, furthest through
        // the two caudal lobes, and clears over most of the fin. The pectorals stay
        // almost clear.
        float lobe = 0.5 - 0.5 * cos(PI2 * 2.0 * along);
        float pigment = pow(1.0 - smoothstep(0.18, ${glsl(p.finReach)}, span), 0.8)
          * mix(1.0, 0.42 + 0.58 * lobe, caudal) * mix(1.0, 0.26, pectoral);
        pigment = clamp(pigment, 0.0, 1.0);
        diffuseColor.rgb = mix(membrane, ${c3(p.finPigment)}, pigment);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${c3(p.finPaleTip)},
          paleTip * smoothstep(0.76, 0.98, span) * 0.5);
        ${p.finPattern}

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
        vec3 rayTint = diffuseColor.rgb * 0.68 + vec3(0.070, 0.095, 0.085);
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
        vec3 iris = mix(${c3(p.iris)}, ${c3(p.irisDark)}, vFishUV.y);
        diffuseColor.rgb = iris * (0.92 + 0.08 * fibre)
          * (0.48 + 0.52 * smoothstep(${glsl(eye.y + 0.022)}, ${glsl(eye.y - 0.028)}, fishY));
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
          * (1.0 - smoothstep(${glsl(opercle.x - 0.03)}, ${glsl(opercle.x + 0.02)}, fishX));
        float plate = exp(-pow((fishX - ${glsl(opercle.x + 0.015)}) / 0.038, 2.0))
          * smoothstep(0.22, 0.46, fishBand) * (1.0 - smoothstep(0.80, 0.96, fishBand));
        metalnessFactor = clamp(0.06 + 0.36 * max(scaled, plate), 0.0, 0.44);
        metalnessFactor *= smoothstep(-0.292, -0.248, fishX);
        metalnessFactor *= 1.0 - 0.85 * smoothstep(0.88, 1.06, fishOrbit());
      } else if (vFishPart > 6.5 && vFishPart < 7.5) {
        metalnessFactor = 0.20;
      } else if (vFishPart < 6.5) {
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

export function createFishMaterials(palette = CHROMIS) {
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
  // Every species compiles its own skin; the key keeps the renderer from handing one
  // species another's program.
  skin.customProgramCacheKey = () => `fish-skin-${palette.key}`;
  fins.customProgramCacheKey = () => `fish-fins-${palette.key}`;
  return { skin, fins };
}
