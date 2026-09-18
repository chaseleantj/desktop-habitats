import * as THREE from "three";
import { groundHeight, smoothstep } from "./math.js";

// One clock and one water model for everything the water touches: the current
// that bends plants, carries debris and pushes the fish, and the light refracted
// by the surface.
export const waterTime = { value: 0 };
export const SURFACE_Y = 10;
export const FLOW_DIRECTION = new THREE.Vector3(1, 0, 0.22).normalize();

// Flow runs along FLOW_DIRECTION, left to right with a slight drift toward the front
// glass. A reef tank is not a river: two wavemakers face each other across it and take
// turns, so the water surges one way for most of a minute, slackens, and comes back. The
// strength is signed and goes negative on the return. On top of the sweep rides a much
// faster pulse, the wavemakers' own beat, which is what the tentacles answer and what
// keeps the corals from ever hanging still, and finer eddies keep any two strands from
// moving in lockstep.
//
// Strength is the flow as a multiple of the design flow; the water moves CURRENT_SPEED
// scene units per second per unit of strength. A scene unit is about six centimetres,
// so the open water peaks near five centimetres a second at the top of a surge: brisk
// for the sand, and about what a small reef's chromis are built to hold station in.
const CURRENT = {
  sweep: { amplitude: 0.42, rate: 0.11 },
  waves: [
    { amplitude: 0.2, rate: 0.62, kx: -0.28, kz: -0.15 },
    { amplitude: 0.07, rate: 1.35, kx: 1.4, kz: 0.9 },
    { amplitude: 0.04, rate: 0.21, kx: 0.6, kz: -2.3 },
  ],
};
export const CURRENT_SPEED = 1.25;

const vec3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
const number = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const wavePhase = ({ rate, kx, kz }) =>
  `t * ${number(rate)} + p.x * ${number(kx)} + p.z * ${number(kz)}`;
const sweepPhase = `t * ${number(CURRENT.sweep.rate)}`;

export const currentGLSL = /* glsl */ `
  uniform float waterTime;
  const vec3 FLOW_DIRECTION = ${vec3(FLOW_DIRECTION)};
  float currentStrength(vec3 p, float t) {
    return ${number(CURRENT.sweep.amplitude)} * sin(${sweepPhase})
      ${CURRENT.waves.map((w) => `+ ${number(w.amplitude)} * sin(${wavePhase(w)})`).join("\n      ")};
  }
  // Time integral of the strength: how far, in strength-seconds, the water at p has
  // carried anything riding it since t = 0. With the sweep this no longer grows without
  // bound -- it swings about a fixed offset, so anything riding the current returns to
  // where it started rather than being carried away for good.
  float currentTravel(vec3 p, float t) {
    return ${number(-CURRENT.sweep.amplitude / CURRENT.sweep.rate)} * cos(${sweepPhase})
      ${CURRENT.waves.map((w) => `- ${number(w.amplitude / w.rate)} * cos(${wavePhase(w)})`).join("\n      ")};
  }
`;

// The same field on the CPU: the water velocity at p, written into `out`.
export function currentVelocity(p, t, out) {
  let strength = CURRENT.sweep.amplitude * Math.sin(t * CURRENT.sweep.rate);
  for (const { amplitude, rate, kx, kz } of CURRENT.waves)
    strength += amplitude * Math.sin(t * rate + p.x * kx + p.z * kz);
  return out.copy(FLOW_DIRECTION).multiplyScalar(strength * CURRENT_SPEED);
}

// Which way the water is actually running at p, as a unit vector, for anything that needs
// to point upstream. Callers cannot use FLOW_DIRECTION for this any more: it is the axis
// the flow runs along, not the way it is going. At slack water the local flow is only
// eddies and its sign means nothing, so the nominal axis is handed back instead.
export function flowDirectionAt(p, t, out) {
  currentVelocity(p, t, out);
  return out.lengthSq() > 1e-4 ? out.normalize() : out.copy(FLOW_DIRECTION);
}

// A coral head's footprint, where the branches take the flow. Heads are passed in rather
// than imported so a scene built without coral still works.
export const thicketAt = (thickets, p) =>
  thickets.find(
    (bed) =>
      p.x > bed.minX &&
      p.x < bed.maxX &&
      p.z > bed.minZ &&
      p.z < bed.maxZ &&
      p.y < bed.maxY,
  );

// The current anything drifting in the tank actually feels: the open-water field slowed
// in the boundary layer over the sand and again among the branches. Fish and sinking food
// must share this, or food would drift off at a different angle from the fish chasing it.
export function shelteredVelocity(p, t, out, thickets) {
  currentVelocity(p, t, out);
  const height = p.y - groundHeight(p.x, p.z);
  let shelter = 0.3 + 0.7 * smoothstep(0, 1.4, height);
  if (thicketAt(thickets, p)) shelter *= 0.35;
  return out.multiplyScalar(shelter);
}

// Light entering through a chopped surface is focused and defocused below it, and
// tropical water absorbs red far faster than blue: two metres down, a red fish is
// brown. The surface is choppier than a planted tank's, worked by the wavemakers and
// the surface skimmer, so the caustics are sharper and quicker; the focusing factor is
// the divergence of the refracted rays at the fragment's depth.
export const surfaceLightGLSL = /* glsl */ `
  // Broad, slow changes are smooth enough to evaluate at vertices and interpolate.
  float waterLightDrift(vec3 p, float t) {
    return 1.0
      + 0.024 * sin(t * 0.145 + p.x * 0.23 + p.z * 0.12)
      + 0.012 * sin(t * 0.073 - p.x * 0.16 + p.z * 0.21 + 1.7);
  }
  vec3 waterLight(vec3 p, float t) {
    float depth = clamp(${SURFACE_Y.toFixed(1)} - p.y, 0.5, 10.0);
    float laplacian =
      0.0150 * sin(dot(p.xz, vec2(3.4, 2.1)) - t * 3.9) +
      0.0135 * sin(dot(p.xz, vec2(-2.6, 4.6)) - t * 4.7 + 1.3) +
      0.0100 * sin(dot(p.xz, vec2(5.8, -2.9)) - t * 5.9 + 2.9) +
      0.0080 * sin(dot(p.xz, vec2(-4.5, -6.6)) - t * 7.1 + 0.7);
    float focus = 1.0 / max(0.4, 1.0 - 0.25 * depth * laplacian * 4.0);
    vec3 absorption = exp(-vec3(0.046, 0.014, 0.005) * depth);
    return focus * absorption;
  }
`;

// Wraps a Three.js lit material so every direct light arrives through the water model.
// `perLight` may add GLSL that runs once per light with `lit` (the shadowed, water-modulated
// light), `geometryNormal`, `material` and `reflectedLight` in scope.
export function waterLitShader(shader, { perLight = "" } = {}) {
  if (shader.fragmentShader.includes("RE_Direct_Water")) return shader;
  shader.uniforms.waterTime = waterTime;
  // A separate vertex uniform name avoids redeclaring the foliage's current clock.
  shader.uniforms.waterLightTime = waterTime;
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      /* glsl */ `
      #include <common>
      uniform float waterLightTime;
      varying vec3 vWaterPosition;
      varying float vWaterDrift;
      ${surfaceLightGLSL}
    `,
    )
    .replace(
      "#include <worldpos_vertex>",
      /* glsl */ `
      #include <worldpos_vertex>
      vec4 waterWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        waterWorld = instanceMatrix * waterWorld;
      #endif
      vWaterPosition = (modelMatrix * waterWorld).xyz;
      vWaterDrift = waterLightDrift(vWaterPosition, waterLightTime);
    `,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      /* glsl */ `
      #include <common>
      uniform float waterTime;
      varying vec3 vWaterPosition;
      varying float vWaterDrift;
      vec3 gWaterLight = vec3(1.0);
      ${surfaceLightGLSL}
    `,
    )
    .replace(
      "#include <lights_physical_pars_fragment>",
      /* glsl */ `
      #include <lights_physical_pars_fragment>
      #undef RE_Direct
      void RE_Direct_Water(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
        IncidentLight lit = directLight;
        lit.color *= gWaterLight;
        RE_Direct_Physical(lit, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
        ${perLight}
      }
      #define RE_Direct RE_Direct_Water
    `,
    )
    .replace(
      "#include <lights_fragment_begin>",
      /* glsl */ `
      gWaterLight = waterLight(vWaterPosition, waterTime) * vWaterDrift;
      #include <lights_fragment_begin>
    `,
    );
  return shader;
}
