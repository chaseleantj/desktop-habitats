import { CHROMIS } from "./fish-anatomy.js";

// The reef's stocking list. Each species is a body shape (`depth` and `width` reshape
// the shared anatomy, `scale` is the size range in fish units) and a skin: a palette in
// the shape of CHROMIS, with `pattern` GLSL for the markings the palette's gradients
// cannot make. Colours are linear RGB, the way the shader wants them.
//
// Markings are drawn in the fish's own coordinates: `fishX` runs from the caudal fork
// near -0.44 to the snout at 0.35, and `fishBand` from 0 on the dorsal midline to 1 on
// the ventral midline, following the body outline. `fishHash(vec2)` is a stable random
// per cell for spots.

// A soft-edged vertical bar centred at x, `width` wide, with the black seam a reef
// fish's white bars nearly always carry.
const bar = (x, width, edge = 0.006) => /* glsl */ `
  {
    float d = abs(fishX - ${x.toFixed(3)});
    float white = 1.0 - smoothstep(${(width / 2 - edge).toFixed(3)}, ${(width / 2).toFixed(3)}, d);
    float seam = smoothstep(${(width / 2 - edge).toFixed(3)}, ${(width / 2).toFixed(3)}, d)
      * (1.0 - smoothstep(${(width / 2).toFixed(3)}, ${(width / 2 + edge * 1.5).toFixed(3)}, d));
    skin = mix(skin, vec3(0.86, 0.87, 0.85), white);
    skin = mix(skin, vec3(0.012, 0.010, 0.010), seam * 0.9);
  }`;

const black = [0.012, 0.011, 0.012];
const white = [0.86, 0.87, 0.85];

export const CLOWNFISH = {
  key: "ocellaris",
  dorsal: [0.62, 0.2, 0.02],
  dorsalLow: [0.72, 0.26, 0.03],
  flank: [0.8, 0.31, 0.04],
  belly: [0.84, 0.38, 0.07],
  bellyLow: [0.86, 0.44, 0.1],
  sheen: [0.8, 0.36, 0.06],
  sheenStrength: 0.2,
  peduncle: [0.72, 0.26, 0.03],
  peduncleStrength: 0.2,
  sheath: [0.7, 0.25, 0.03],
  gill: [0.5, 0.15, 0.04],
  cheekDark: [0.6, 0.2, 0.02],
  cheekLight: [0.78, 0.3, 0.04],
  skull: [0.62, 0.2, 0.02],
  snout: [0.66, 0.24, 0.03],
  orbit: [0.7, 0.3, 0.08],
  // Three white bars: one behind the head, a broad one at mid-body that bulges
  // forward at the top, one across the caudal peduncle.
  pattern: bar(0.185, 0.05) + `
  {
    float centre = -0.015 + 0.03 * (1.0 - smoothstep(0.1, 0.5, fishBand));
    float d = abs(fishX - centre);
    float half = 0.038 + 0.014 * (1.0 - smoothstep(0.1, 0.6, fishBand));
    float white = 1.0 - smoothstep(half - 0.006, half, d);
    float seam = smoothstep(half - 0.006, half, d) * (1.0 - smoothstep(half, half + 0.009, d));
    skin = mix(skin, vec3(0.86, 0.87, 0.85), white);
    skin = mix(skin, vec3(0.012, 0.010, 0.010), seam * 0.9);
  }` + bar(-0.245, 0.035),
  membrane: [0.7, 0.26, 0.04],
  finPigment: [0.78, 0.3, 0.04],
  finReach: 1.3,
  finPaleTip: [0.78, 0.3, 0.04],
  // Orange fins with a black margin and a fine white edge outside it.
  finPattern: /* glsl */ `
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.010, 0.010), smoothstep(0.7, 0.8, span));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.87, 0.85), smoothstep(0.9, 0.96, span));
  `,
  finAbsorption: [5, 5, 5],
  iris: [0.5, 0.3, 0.1],
  irisDark: [0.2, 0.1, 0.04],
};

export const YELLOW_TANG = {
  key: "yellow-tang",
  dorsal: [0.82, 0.62, 0.05],
  dorsalLow: [0.88, 0.68, 0.06],
  flank: [0.92, 0.74, 0.08],
  belly: [0.94, 0.78, 0.12],
  bellyLow: [0.94, 0.8, 0.16],
  sheen: [0.95, 0.8, 0.1],
  sheenStrength: 0.2,
  peduncle: [0.9, 0.72, 0.08],
  peduncleStrength: 0.1,
  sheath: [0.9, 0.72, 0.08],
  gill: [0.7, 0.5, 0.06],
  cheekDark: [0.84, 0.64, 0.05],
  cheekLight: [0.92, 0.74, 0.08],
  skull: [0.82, 0.62, 0.05],
  snout: [0.8, 0.6, 0.05],
  orbit: [0.9, 0.75, 0.2],
  // The white scalpel on the caudal peduncle.
  pattern: /* glsl */ `
  {
    float d = length(vec2((fishX + 0.255) / 0.028, (fishBand - 0.5) / 0.05));
    skin = mix(skin, vec3(0.9, 0.9, 0.86), 1.0 - smoothstep(0.7, 1.0, d));
  }`,
  membrane: [0.9, 0.7, 0.08],
  finPigment: [0.92, 0.74, 0.08],
  finReach: 1.3,
  finPaleTip: [0.92, 0.74, 0.08],
  finPattern: "",
  finAbsorption: [5, 5, 5],
  iris: [0.5, 0.35, 0.1],
  irisDark: [0.2, 0.12, 0.04],
};

export const REGAL_TANG = {
  key: "regal-tang",
  dorsal: [0.02, 0.1, 0.62],
  dorsalLow: [0.03, 0.14, 0.7],
  flank: [0.05, 0.2, 0.78],
  belly: [0.08, 0.26, 0.8],
  bellyLow: [0.1, 0.3, 0.8],
  sheen: [0.1, 0.3, 0.9],
  sheenStrength: 0.25,
  peduncle: [0.05, 0.2, 0.78],
  peduncleStrength: 0,
  sheath: [0.05, 0.2, 0.78],
  gill: [0.03, 0.1, 0.5],
  cheekDark: [0.02, 0.1, 0.62],
  cheekLight: [0.05, 0.2, 0.78],
  skull: [0.02, 0.1, 0.62],
  snout: [0.02, 0.1, 0.55],
  orbit: [0.1, 0.25, 0.6],
  // The painter's palette: a black band along the upper flank from the eye to the
  // tail, joined by a black loop that encloses a blue oval, and a yellow tail.
  pattern: /* glsl */ `
  {
    float upper = smoothstep(0.08, 0.13, fishBand) * (1.0 - smoothstep(0.30, 0.36, fishBand))
      * smoothstep(-0.30, -0.26, fishX) * (1.0 - smoothstep(0.17, 0.22, fishX));
    float loop = length(vec2((fishX + 0.02) / 0.19, (fishBand - 0.47) / 0.22));
    float ring = smoothstep(0.78, 0.86, loop) * (1.0 - smoothstep(1.0, 1.08, loop))
      * smoothstep(0.30, 0.36, fishBand);
    skin = mix(skin, vec3(0.012, 0.011, 0.012), max(upper, ring));
    skin = mix(skin, vec3(0.92, 0.74, 0.08), 1.0 - smoothstep(-0.275, -0.245, fishX));
  }`,
  membrane: [0.05, 0.2, 0.78],
  finPigment: [0.05, 0.2, 0.78],
  finReach: 1.3,
  finPaleTip: [0.05, 0.2, 0.78],
  // Blue fins edged in black; the caudal is yellow with black upper and lower margins.
  finPattern: /* glsl */ `
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.74, 0.08), caudal);
    float margin = caudal > 0.5 ? smoothstep(0.7, 0.85, abs(along - 0.5) * 2.0) : smoothstep(0.75, 0.88, span);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.011, 0.012), margin);
  `,
  finAbsorption: [5, 5, 5],
  iris: [0.2, 0.2, 0.3],
  irisDark: [0.05, 0.05, 0.1],
};

export const MOORISH_IDOL = {
  key: "moorish-idol",
  dorsal: white,
  dorsalLow: white,
  flank: [0.88, 0.88, 0.84],
  belly: [0.9, 0.9, 0.86],
  bellyLow: [0.9, 0.9, 0.86],
  sheen: [0.9, 0.9, 0.88],
  sheenStrength: 0.15,
  peduncle: white,
  peduncleStrength: 0,
  sheath: white,
  gill: [0.6, 0.55, 0.5],
  cheekDark: [0.8, 0.8, 0.76],
  cheekLight: [0.88, 0.88, 0.84],
  skull: [0.86, 0.86, 0.82],
  snout: [0.5, 0.36, 0.06],
  orbit: [0.2, 0.18, 0.15],
  // Two broad black bands, the yellow saddle between them, a yellow-orange snout, and
  // a black tail with its white edge.
  pattern: /* glsl */ `
  {
    float front = smoothstep(-0.06, -0.02, fishX) * (1.0 - smoothstep(0.08, 0.12, fishX));
    float back = smoothstep(-0.33, -0.29, fishX) * (1.0 - smoothstep(-0.2, -0.16, fishX));
    float saddle = smoothstep(-0.17, -0.13, fishX) * (1.0 - smoothstep(-0.05, -0.02, fishX))
      * (1.0 - smoothstep(0.35, 0.55, fishBand));
    skin = mix(skin, vec3(0.94, 0.7, 0.06), saddle);
    skin = mix(skin, vec3(0.012, 0.011, 0.012), max(front, back));
    skin = mix(skin, vec3(0.012, 0.011, 0.012), 1.0 - smoothstep(-0.31, -0.28, fishX));
    float snoutY = smoothstep(0.3, 0.45, fishBand) * (1.0 - smoothstep(0.55, 0.7, fishBand));
    skin = mix(skin, vec3(0.94, 0.62, 0.05), smoothstep(0.24, 0.3, fishX) * snoutY);
  }`,
  membrane: [0.012, 0.011, 0.012],
  finPigment: [0.012, 0.011, 0.012],
  finReach: 1.3,
  finPaleTip: [0.012, 0.011, 0.012],
  finPattern: /* glsl */ `
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.87, 0.85), smoothstep(0.86, 0.94, span));
  `,
  finAbsorption: [5, 5, 5],
  iris: [0.3, 0.25, 0.15],
  irisDark: [0.08, 0.07, 0.05],
};

export const PORCUPINE_PUFFER = {
  key: "porcupine-puffer",
  dorsal: [0.36, 0.3, 0.14],
  dorsalLow: [0.46, 0.38, 0.18],
  flank: [0.6, 0.5, 0.26],
  belly: [0.8, 0.74, 0.5],
  bellyLow: [0.86, 0.82, 0.6],
  sheen: [0.6, 0.5, 0.26],
  sheenStrength: 0,
  peduncle: [0.5, 0.42, 0.2],
  peduncleStrength: 0.2,
  sheath: [0.5, 0.42, 0.2],
  gill: [0.4, 0.3, 0.15],
  cheekDark: [0.4, 0.34, 0.16],
  cheekLight: [0.62, 0.52, 0.28],
  skull: [0.36, 0.3, 0.14],
  snout: [0.5, 0.42, 0.2],
  orbit: [0.5, 0.42, 0.2],
  // Dark spots scattered over the back and flank, none on the belly, and the short
  // spines lying flat between them, each a paler speck.
  pattern: /* glsl */ `
  {
    vec2 cell = vec2(fishX * 34.0, fishBand * 14.0);
    vec2 jitter = vec2(fishHash(floor(cell)), fishHash(floor(cell) + 11.0)) - 0.5;
    float spot = 1.0 - smoothstep(0.22, 0.32, length(fract(cell) - 0.5 - jitter * 0.4));
    float keep = step(0.45, fishHash(floor(cell) + 5.0)) * (1.0 - smoothstep(0.6, 0.75, fishBand));
    skin = mix(skin, vec3(0.1, 0.07, 0.03), spot * keep * 0.85);
    vec2 spineCell = vec2(fishX * 60.0, fishBand * 26.0);
    float spine = 1.0 - smoothstep(0.06, 0.12, length(fract(spineCell) - 0.5));
    skin = mix(skin, vec3(0.8, 0.74, 0.5), spine * 0.5 * (1.0 - spot * keep));
  }`,
  membrane: [0.5, 0.45, 0.28],
  finPigment: [0.6, 0.5, 0.26],
  finReach: 0.6,
  finPaleTip: [0.6, 0.55, 0.35],
  finPattern: "",
  finAbsorption: [1.2, 1.2, 1.6],
  iris: [0.4, 0.5, 0.3],
  irisDark: [0.1, 0.15, 0.08],
};

export const ROYAL_GRAMMA = {
  key: "royal-gramma",
  dorsal: [0.36, 0.03, 0.42],
  dorsalLow: [0.42, 0.04, 0.5],
  flank: [0.5, 0.06, 0.58],
  belly: [0.56, 0.1, 0.6],
  bellyLow: [0.6, 0.14, 0.62],
  sheen: [0.55, 0.1, 0.7],
  sheenStrength: 0.3,
  peduncle: [0.5, 0.06, 0.58],
  peduncleStrength: 0,
  sheath: [0.5, 0.06, 0.58],
  gill: [0.3, 0.03, 0.3],
  cheekDark: [0.4, 0.04, 0.46],
  cheekLight: [0.52, 0.08, 0.6],
  skull: [0.36, 0.03, 0.42],
  snout: [0.4, 0.05, 0.42],
  orbit: [0.5, 0.2, 0.5],
  // Purple forward, yellow aft, the two meeting on a slant that runs from high on the
  // back to low on the belly; a black line through the eye and a spot on the dorsal.
  pattern: /* glsl */ `
  {
    float boundary = -0.03 + 0.1 * (fishBand - 0.5);
    float yellow = 1.0 - smoothstep(boundary - 0.03, boundary + 0.03, fishX);
    vec3 gold = mix(vec3(0.9, 0.6, 0.06), vec3(0.94, 0.78, 0.12), smoothstep(0.3, 0.8, fishBand));
    skin = mix(skin, gold, yellow);
    float streak = exp(-pow((fishBand - 0.25 - (fishX - 0.2) * 0.4) / 0.03, 2.0))
      * smoothstep(0.17, 0.2, fishX) * (1.0 - smoothstep(0.29, 0.32, fishX));
    skin = mix(skin, vec3(0.012, 0.011, 0.012), streak * 0.8);
  }`,
  membrane: [0.45, 0.08, 0.5],
  finPigment: [0.5, 0.06, 0.58],
  finReach: 1.1,
  finPaleTip: [0.6, 0.2, 0.6],
  // The yellow carries into the fins behind the boundary.
  finPattern: /* glsl */ `
    float aft = caudal + (1.0 - caudal) * step(2.5, vFishPart) * (1.0 - step(3.5, vFishPart)) * smoothstep(0.4, 0.6, along)
      + (1.0 - caudal) * step(6.5, vFishPart) * 0.0;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.7, 0.08), clamp(aft, 0.0, 1.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.011, 0.012),
      step(2.5, vFishPart) * (1.0 - step(3.5, vFishPart)) * (1.0 - smoothstep(0.02, 0.06, length(vec2((along - 0.28) * 1.5, span - 0.55)))));
  `,
  finAbsorption: [3, 3, 3],
  iris: [0.4, 0.3, 0.1],
  irisDark: [0.15, 0.1, 0.03],
};

// The roster, in the order the shoal is numbered. `count` is how many, `depth` and
// `width` the body reshaping, `scale` the size range as a multiple of the tetra's 40 mm.
export const SPECIES = [
  { key: "chromis", name: "Blue-green chromis", count: 8, depth: 1.15, width: 1, scale: [0.78, 0.98], palette: CHROMIS },
  { key: "ocellaris", name: "Ocellaris clownfish", count: 3, depth: 1.45, width: 1.15, scale: [0.95, 1.15], palette: CLOWNFISH },
  { key: "moorish-idol", name: "Moorish idol", count: 1, depth: 2.1, width: 0.7, scale: [1.6, 1.6], palette: MOORISH_IDOL },
  { key: "regal-tang", name: "Regal blue tang", count: 1, depth: 1.85, width: 0.8, scale: [1.55, 1.55], palette: REGAL_TANG },
  { key: "porcupine-puffer", name: "Porcupine pufferfish", count: 1, depth: 1.7, width: 1.9, scale: [1.5, 1.5], palette: PORCUPINE_PUFFER },
  { key: "royal-gramma", name: "Royal gramma", count: 1, depth: 1.2, width: 1, scale: [0.85, 0.85], palette: ROYAL_GRAMMA },
  { key: "yellow-tang", name: "Yellow tang", count: 1, depth: 1.95, width: 0.8, scale: [1.45, 1.45], palette: YELLOW_TANG },
];

export const COUNT = SPECIES.reduce((total, species) => total + species.count, 0);
