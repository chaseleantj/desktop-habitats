import { CHROMIS, PLANS } from "./fish-anatomy.js";

// The reef's stocking list. Each species is a body plan from fish-anatomy.js (its own
// outline, fins, eye and mouth; `scale` is the size range in fish units) and a skin: a
// palette in the shape of CHROMIS, with `pattern` GLSL for the markings the palette's
// gradients cannot make. Colours are linear RGB, the way the shader wants them.
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
    float halfWidth = 0.038 + 0.014 * (1.0 - smoothstep(0.1, 0.6, fishBand));
    float white = 1.0 - smoothstep(halfWidth - 0.006, halfWidth, d);
    float seam = smoothstep(halfWidth - 0.006, halfWidth, d) * (1.0 - smoothstep(halfWidth, halfWidth + 0.009, d));
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
  dorsal: [0.94, 0.94, 0.92],
  dorsalLow: [0.94, 0.94, 0.92],
  flank: [0.93, 0.93, 0.9],
  belly: [0.94, 0.94, 0.92],
  bellyLow: [0.94, 0.94, 0.92],
  sheen: [0.9, 0.9, 0.9],
  sheenStrength: 0.08,
  peduncle: [0.94, 0.94, 0.92],
  peduncleStrength: 0,
  sheath: [0.94, 0.94, 0.92],
  gill: [0.6, 0.55, 0.5],
  cheekDark: [0.86, 0.86, 0.84],
  cheekLight: [0.93, 0.93, 0.9],
  skull: [0.92, 0.92, 0.9],
  snout: [0.86, 0.86, 0.84],
  orbit: [0.5, 0.36, 0.14],
  // Black, white and yellow in three black bars and two pale yellow ones. The first bar
  // takes the eye and broadens as it descends, running forward under the throat to the
  // chest and covering the pelvic fins; in front of it a narrow white stripe runs from
  // the forehead down and back to the chest; in front of that the face is black to the
  // snout, which carries a black-edged orange saddle across its top, a grey flank and a
  // black chin, and is white at the tip with black lips. The white behind the first bar
  // runs to lemon yellow over its rear half. The second bar leans back over the rear of
  // the body and carries into the dorsal and the anal fin; behind it a white stripe and
  // then the yellow peduncle separate it from the black tail. An orange spot sits at the
  // base of each pectoral.
  pattern: /* glsl */ `
  {
    const vec3 ink = vec3(0.012, 0.011, 0.012);
    const vec3 gold = vec3(0.98, 0.82, 0.06);
    float front1 = 0.17 - 0.02 * smoothstep(0.0, 0.5, fishBand) - 0.02 * smoothstep(0.5, 0.85, fishBand);
    front1 = mix(front1, 0.27, smoothstep(0.86, 0.94, fishBand));
    float rear1 = -0.03 - 0.03 * smoothstep(0.0, 0.5, fishBand) - 0.04 * smoothstep(0.5, 1.0, fishBand);
    float bar1 = (1.0 - smoothstep(front1 - 0.005, front1 + 0.005, fishX)) * smoothstep(rear1 - 0.006, rear1 + 0.006, fishX);
    float front2 = -0.15 - 0.05 * fishBand;
    float rear2 = -0.21 - 0.06 * fishBand;
    float bar2 = (1.0 - smoothstep(front2 - 0.006, front2 + 0.006, fishX)) * smoothstep(rear2 - 0.006, rear2 + 0.006, fishX);
    // The yellow is a wedge: broad high on the flank, where it begins just behind the
    // first bar, and narrowing toward the belly, where the white runs on much further.
    float yellowFront = -0.06 - 0.03 * smoothstep(0.0, 0.5, fishBand) - 0.05 * smoothstep(0.5, 1.0, fishBand);
    float yellow = 1.0 - smoothstep(yellowFront - 0.03, yellowFront + 0.01, fishX);
    float peduncle = 1.0 - smoothstep(rear2 - 0.03, rear2 - 0.02, fishX);
    skin = mix(skin, gold, max(yellow, peduncle));
    // Everything forward of the white stripe is black, bar the saddle, the grey flank
    // of the tube beneath it, and the white tip.
    float stripeFront = front1 + 0.045;
    float face = smoothstep(stripeFront - 0.005, stripeFront + 0.005, fishX) * (1.0 - smoothstep(0.86, 0.94, fishBand));
    skin = mix(skin, ink, face);
    float tube = smoothstep(0.228, 0.24, fishX);
    float tip = smoothstep(0.302, 0.314, fishX);
    float saddleY = 1.0 - smoothstep(0.4, 0.46, fishBand);
    float flankY = smoothstep(0.46, 0.52, fishBand) * (1.0 - smoothstep(0.6, 0.66, fishBand));
    skin = mix(skin, vec3(0.7, 0.7, 0.68), tube * flankY);
    skin = mix(skin, vec3(0.95, 0.5, 0.04), tube * (1.0 - tip) * saddleY * smoothstep(0.24, 0.25, fishX) * (1.0 - smoothstep(0.292, 0.302, fishX)));
    skin = mix(skin, vec3(0.94, 0.94, 0.92), tip * (1.0 - smoothstep(0.6, 0.66, fishBand)));
    skin = mix(skin, ink, max(bar1, bar2));
    skin = mix(skin, ink, smoothstep(0.336, 0.342, fishX));
    float spot = exp(-pow((fishX - 0.028) / 0.02, 2.0) - pow((fishY - 0.055) / 0.022, 2.0));
    skin = mix(skin, vec3(0.95, 0.5, 0.04), spot * 0.9);
  }`,
  membrane: [0.7, 0.72, 0.7],
  finPigment: [0.012, 0.011, 0.012],
  finReach: 1.3,
  finPaleTip: [0.94, 0.94, 0.92],
  filament: [0.94, 0.95, 0.93],
  // The sail is white along its leading spines, then yellow in a band parallel to
  // them, then black where the second bar runs up through it to the margin, and white
  // again at its rear edge. The anal fin is yellow at its front and black behind,
  // white-edged. The tail is black with a white margin, the pelvics black with a white
  // leading edge, and the pectorals clear.
  finPattern: /* glsl */ `
  {
    const vec3 ink = vec3(0.012, 0.011, 0.012);
    const vec3 chalk = vec3(0.94, 0.94, 0.92);
    const vec3 gold = vec3(0.98, 0.82, 0.06);
    float dorsalFin = step(1.5, vFishPart) * (1.0 - step(2.5, vFishPart));
    float analFin = step(2.5, vFishPart) * (1.0 - step(3.5, vFishPart));
    float pelvicFin = step(5.5, vFishPart) * (1.0 - step(6.5, vFishPart));
    vec3 c = chalk;
    c = mix(c, gold, smoothstep(0.14, 0.2, along) * (1.0 - smoothstep(0.46, 0.52, along)));
    c = mix(c, ink, smoothstep(0.5, 0.55, along) * (1.0 - smoothstep(0.78, 0.84, along)));
    vec3 a = mix(gold, ink, smoothstep(0.12, 0.2, along));
    a = mix(a, chalk, smoothstep(0.9, 0.97, span) * 0.8);
    vec3 t = mix(ink, chalk, smoothstep(0.84, 0.92, span));
    vec3 v = mix(ink, chalk, 1.0 - smoothstep(0.04, 0.12, along));
    diffuseColor.rgb = mix(diffuseColor.rgb, c, dorsalFin);
    diffuseColor.rgb = mix(diffuseColor.rgb, a, analFin);
    diffuseColor.rgb = mix(diffuseColor.rgb, t, caudal);
    diffuseColor.rgb = mix(diffuseColor.rgb, v, pelvicFin);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.33, 0.32), pectoral);
  }`,
  finAbsorption: [5, 5, 5],
  finDensity: 0.7,
  iris: [0.55, 0.4, 0.18],
  irisDark: [0.12, 0.09, 0.05],
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

export const FOUR_STRIPE_DAMSEL = {
  key: "four-stripe-damsel",
  dorsal: [0.7, 0.72, 0.7],
  dorsalLow: [0.8, 0.81, 0.79],
  flank: [0.86, 0.87, 0.85],
  belly: [0.88, 0.89, 0.87],
  bellyLow: [0.88, 0.89, 0.87],
  sheen: [0.9, 0.92, 0.92],
  sheenStrength: 0.3,
  peduncle: [0.86, 0.87, 0.85],
  peduncleStrength: 0,
  sheath: [0.86, 0.87, 0.85],
  gill: [0.6, 0.58, 0.55],
  cheekDark: [0.78, 0.79, 0.77],
  cheekLight: [0.86, 0.87, 0.85],
  skull: [0.8, 0.81, 0.79],
  snout: [0.6, 0.58, 0.56],
  orbit: [0.1, 0.09, 0.09],
  // Three black bars on white, each leaning back as it rises: the first through the eye
  // from the nape to the throat, the second from the front of the dorsal fin through the
  // pectoral base to the pelvics, the third from the soft dorsal down into the anal
  // fin. The peduncle is white, and the tail, the fourth stripe, black.
  pattern: /* glsl */ `
  {
    const vec3 ink = vec3(0.012, 0.011, 0.012);
    float lower = smoothstep(0.0, 0.5, fishBand), upper = smoothstep(0.5, 1.0, fishBand);
    float f1 = mix(mix(0.248, 0.323, lower), 0.29, upper), r1 = mix(mix(0.168, 0.243, lower), 0.23, upper);
    float f2 = mix(mix(0.088, 0.14, lower), 0.16, upper), r2 = mix(mix(0.025, 0.052, lower), 0.088, upper);
    float f3 = mix(mix(-0.08, -0.055, lower), -0.09, upper), r3 = mix(mix(-0.19, -0.126, lower), -0.17, upper);
    float bar = (1.0 - smoothstep(f1 - 0.006, f1 + 0.006, fishX)) * smoothstep(r1 - 0.006, r1 + 0.006, fishX);
    bar = max(bar, (1.0 - smoothstep(f2 - 0.006, f2 + 0.006, fishX)) * smoothstep(r2 - 0.006, r2 + 0.006, fishX));
    bar = max(bar, (1.0 - smoothstep(f3 - 0.006, f3 + 0.006, fishX)) * smoothstep(r3 - 0.006, r3 + 0.006, fishX));
    skin = mix(skin, ink, bar);
  }`,
  membrane: [0.6, 0.62, 0.6],
  finPigment: [0.86, 0.87, 0.85],
  finReach: 1.3,
  finPaleTip: [0.86, 0.87, 0.85],
  // The bars run up into the dorsal fin, and the spines between them carry black tips;
  // the anal fin and the pelvics are black, the tail black beyond a white base, and
  // every dark fin is edged in pale blue.
  finPattern: /* glsl */ `
  {
    const vec3 ink = vec3(0.012, 0.011, 0.012);
    const vec3 sky = vec3(0.3, 0.7, 0.95);
    float dorsalFin = step(1.5, vFishPart) * (1.0 - step(2.5, vFishPart));
    float analFin = step(2.5, vFishPart) * (1.0 - step(3.5, vFishPart));
    float pelvicFin = step(5.5, vFishPart) * (1.0 - step(6.5, vFishPart));
    float d = smoothstep(0.16, 0.2, along) * (1.0 - smoothstep(0.34, 0.38, along))
      + smoothstep(0.64, 0.68, along) * (1.0 - smoothstep(0.96, 0.99, along))
      + smoothstep(0.86, 0.95, span) * (1.0 - smoothstep(0.34, 0.4, along));
    vec3 c = mix(diffuseColor.rgb, ink, clamp(d, 0.0, 1.0));
    c = mix(c, sky, smoothstep(0.93, 0.98, span) * smoothstep(0.96, 1.0, along));
    vec3 a = mix(ink, sky, smoothstep(0.9, 0.97, span));
    vec3 v = mix(ink, sky, 1.0 - smoothstep(0.03, 0.1, along));
    vec3 t = mix(diffuseColor.rgb, ink, smoothstep(0.16, 0.26, span));
    t = mix(t, sky, smoothstep(0.5, 1.0, span) * (1.0 - smoothstep(0.06, 0.12, min(along, 1.0 - along))));
    // A black tail is a dense one.
    pigment = mix(pigment, 1.0, caudal * smoothstep(0.16, 0.26, span));
    diffuseColor.rgb = mix(diffuseColor.rgb, c, dorsalFin);
    diffuseColor.rgb = mix(diffuseColor.rgb, a, analFin);
    diffuseColor.rgb = mix(diffuseColor.rgb, v, pelvicFin);
    diffuseColor.rgb = mix(diffuseColor.rgb, t, caudal);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.62, 0.6), pectoral);
  }`,
  finAbsorption: [5, 5, 5],
  finDensity: 0.5,
  iris: [0.3, 0.22, 0.14],
  irisDark: [0.08, 0.06, 0.05],
};

export const LONGNOSE_BUTTERFLY = {
  key: "longnose-butterfly",
  dorsal: [0.86, 0.66, 0.04],
  dorsalLow: [0.9, 0.7, 0.05],
  flank: [0.93, 0.75, 0.07],
  belly: [0.94, 0.78, 0.1],
  bellyLow: [0.94, 0.8, 0.14],
  sheen: [0.95, 0.8, 0.1],
  sheenStrength: 0.15,
  peduncle: [0.92, 0.74, 0.08],
  peduncleStrength: 0,
  sheath: [0.92, 0.74, 0.08],
  gill: [0.6, 0.55, 0.5],
  cheekDark: [0.7, 0.72, 0.75],
  cheekLight: [0.76, 0.77, 0.8],
  skull: [0.06, 0.05, 0.05],
  snout: [0.06, 0.05, 0.05],
  orbit: [0.12, 0.1, 0.1],
  // Yellow to the nape and the throat, and a head split down its length: the crown, the
  // eye and the top of the tube are black; the cheek and the lower half of the tube
  // silver. A black ocellus with a pale ring sits at the rear of the anal fin's base.
  pattern: /* glsl */ `
  {
    const vec3 ink = vec3(0.012, 0.011, 0.012);
    float headEdge = 0.06 - 0.035 * smoothstep(0.35, 1.0, fishBand);
    float head = 1.0 - smoothstep(headEdge - 0.008, headEdge + 0.008, -fishX + 2.0 * headEdge);
    head = smoothstep(headEdge - 0.008, headEdge + 0.008, fishX);
    float split = 0.02 * smoothstep(0.34, 0.2, fishX);
    float upper = smoothstep(split - 0.005, split + 0.005, fishY);
    skin = mix(skin, vec3(0.74, 0.75, 0.78), head * (1.0 - upper));
    skin = mix(skin, vec3(0.05, 0.045, 0.045), head * upper);
    float d = length(vec2((fishX + 0.262) / 0.02, (fishY + 0.05) / 0.018));
    skin = mix(skin, vec3(0.9, 0.9, 0.85), smoothstep(0.85, 1.0, d) * (1.0 - smoothstep(1.2, 1.45, d)));
    skin = mix(skin, ink, 1.0 - smoothstep(0.8, 1.0, d));
  }`,
  membrane: [0.6, 0.62, 0.62],
  finPigment: [0.93, 0.75, 0.07],
  finReach: 1.3,
  finPaleTip: [0.93, 0.75, 0.07],
  // Yellow dorsal, anal and pelvics, the soft dorsal and anal edged in pale blue, the
  // black of the nape running into the first dorsal spines; the tail and the pectorals
  // are glass.
  finPattern: /* glsl */ `
  {
    const vec3 ink = vec3(0.012, 0.011, 0.012);
    float dorsalFin = step(1.5, vFishPart) * (1.0 - step(2.5, vFishPart));
    float analFin = step(2.5, vFishPart) * (1.0 - step(3.5, vFishPart));
    float soft = (dorsalFin + analFin) * smoothstep(0.55, 0.75, along);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.8, 0.9), soft * smoothstep(0.92, 0.98, span));
    diffuseColor.rgb = mix(diffuseColor.rgb, ink, dorsalFin * (1.0 - smoothstep(0.02, 0.06, along)));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.62, 0.62), max(caudal, pectoral));
    pigment *= 1.0 - max(caudal, pectoral);
  }`,
  finAbsorption: [5, 5, 5],
  finDensity: 0.75,
  iris: [0.3, 0.2, 0.12],
  irisDark: [0.08, 0.05, 0.04],
};

// The roster, in the order the shoal is numbered. `count` is how many, `plan` the
// anatomy, `scale` the size range as a multiple of a 40 mm fish.
export const SPECIES = [
  { key: "chromis", name: "Blue-green chromis", count: 8, scale: [0.85, 1.05], palette: CHROMIS },
  { key: "ocellaris", name: "Ocellaris clownfish", count: 3, scale: [1.0, 1.2], palette: CLOWNFISH },
  { key: "moorish-idol", name: "Moorish idol", count: 1, scale: [1.7, 1.7], palette: MOORISH_IDOL },
  { key: "regal-tang", name: "Regal blue tang", count: 1, scale: [1.65, 1.65], palette: REGAL_TANG },
  { key: "porcupine-puffer", name: "Porcupine pufferfish", count: 1, scale: [1.6, 1.6], palette: PORCUPINE_PUFFER },
  { key: "royal-gramma", name: "Royal gramma", count: 1, scale: [0.9, 0.9], palette: ROYAL_GRAMMA },
  { key: "yellow-tang", name: "Yellow tang", count: 1, scale: [1.55, 1.55], palette: YELLOW_TANG },
  { key: "four-stripe-damsel", name: "Four-stripe damselfish", count: 3, scale: [0.95, 1.1], palette: FOUR_STRIPE_DAMSEL },
  { key: "longnose-butterfly", name: "Yellow longnose butterflyfish", count: 1, scale: [1.6, 1.6], palette: LONGNOSE_BUTTERFLY },
].map((species) => ({ ...species, plan: PLANS[species.key] }));

export const COUNT = SPECIES.reduce((total, species) => total + species.count, 0);
