import * as THREE from "three";
import { groundHeight, smoothstep } from "./math.js";

// One clock and one water model for everything the water touches: the current
// that bends plants, carries debris and pushes the fish, and the light refracted
// by the surface.
export const waterTime = { value: 0 };
export const SURFACE_Y = 10;
export const FLOW_DIRECTION = new THREE.Vector3(1, 0, 0.22).normalize();

// Flow runs along FLOW_DIRECTION, left to right with a slight drift toward the front
// glass -- but the return sweeps through its arc instead of pointing one way forever, so
// the strength is signed and goes negative when the water is running back again. A tank
// whose return never moves has one permanent downstream corner that every light thing
// ends up in, which is both wrong for a planted tank and dull to watch.
//
// The sweep is far slower than anything else in the scene, a little over three minutes
// end to end, so at any one moment the water still reads as a steady drift and only a
// long sit reveals the turn. Twice a cycle it passes through slack, where the eddies are
// all that is left and different corners of the tank briefly disagree about which way
// they are going. On top of the sweep a slow pressure wave travels across the tank so
// neighbours respond in turn, and finer eddies keep any two strands from moving in
// lockstep.
//
// Strength is the flow as a multiple of the design flow; the water moves CURRENT_SPEED
// scene units per second per unit of strength. A scene unit is about six centimetres, so
// the open water peaks near a centimetre and three quarters a second and averages about
// a centimetre, the gentle return of a planted tank.
const CURRENT = {
  sweep: { amplitude: 0.34, rate: 0.031 },
  waves: [
    { amplitude: 0.15, rate: 0.055, kx: -0.34, kz: -0.19 },
    { amplitude: 0.03, rate: 0.235, kx: 1.7, kz: 1.1 },
    { amplitude: 0.03, rate: 0.155, kx: 0.6, kz: -2.3 },
  ],
};
export const CURRENT_SPEED = 0.85;

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

// A grass bed's footprint, where the foliage takes the flow. Beds are passed in rather
// than imported so a scene built without planting still works.
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
// in the boundary layer over the sand and again inside the grass. Fish and sinking food
// must share this, or food would drift off at a different angle from the fish chasing it.
export function shelteredVelocity(p, t, out, thickets) {
  currentVelocity(p, t, out);
  const height = p.y - groundHeight(p.x, p.z);
  let shelter = 0.3 + 0.7 * smoothstep(0, 1.4, height);
  if (thicketAt(thickets, p)) shelter *= 0.35;
  return out.multiplyScalar(shelter);
}

// Light entering through a gently rippled surface is focused and defocused below it, and
// the water column absorbs red faster than green. The surface is a few short wave trains
// raised by the filter return; the focusing factor is the divergence of the refracted rays
// at the fragment's depth, with a small refraction angle so the pattern stays soft.
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
      0.0110 * sin(dot(p.xz, vec2(3.1, 1.9)) - t * 3.4) +
      0.0100 * sin(dot(p.xz, vec2(-2.4, 4.2)) - t * 4.1 + 1.3) +
      0.0075 * sin(dot(p.xz, vec2(5.3, -2.6)) - t * 5.2 + 2.9) +
      0.0060 * sin(dot(p.xz, vec2(-4.1, -6.0)) - t * 6.3 + 0.7);
    float focus = 1.0 / max(0.45, 1.0 - 0.25 * depth * laplacian * 4.0);
    vec3 absorption = exp(-vec3(0.020, 0.008, 0.012) * depth);
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
