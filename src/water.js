import * as THREE from "three";

// One clock and one water model for everything the water touches: the current
// that bends plants and carries debris, and the light refracted by the surface.
export const waterTime = { value: 0 };
export const SURFACE_Y = 10;
export const FLOW_DIRECTION = new THREE.Vector3(1, 0, 0.22).normalize();

const vec3 = (v) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

// Filter return runs left to right with a slight drift toward the front glass. A slow
// pressure wave travels across the tank so neighbours respond in turn, and finer eddies
// keep any two strands from moving in lockstep.
export const currentGLSL = /* glsl */ `
  uniform float waterTime;
  const vec3 FLOW_DIRECTION = ${vec3(FLOW_DIRECTION)};
  float currentStrength(vec3 p, float t) {
    float gust = sin(t * 0.11 - p.x * 0.34 - p.z * 0.19);
    float eddy = 0.5 * sin(t * 0.47 + p.x * 1.7 + p.z * 1.1) + 0.5 * sin(t * 0.31 - p.z * 2.3 + p.x * 0.6);
    return 0.62 + 0.30 * gust + 0.12 * eddy;
  }
`;

// Light entering through a gently rippled surface is focused and defocused below it, and
// the water column absorbs red faster than green. The surface is a few short wave trains
// raised by the filter return; the focusing factor is the divergence of the refracted rays
// at the fragment's depth, with a small refraction angle so the pattern stays soft.
export const surfaceLightGLSL = /* glsl */ `
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
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vWaterPosition;",
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
    `,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      /* glsl */ `
      #include <common>
      uniform float waterTime;
      varying vec3 vWaterPosition;
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
      gWaterLight = waterLight(vWaterPosition, waterTime);
      #include <lights_fragment_begin>
    `,
    );
  return shader;
}
