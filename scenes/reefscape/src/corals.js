import * as THREE from "three";
import { GeometryBatch, groundHeight, noise, random, randomGenerator, range, smoothstep, vec } from "./math.js";
import { FLOW_DIRECTION, waterLitShader } from "./water.js";
import { TAU, foliageDepth, tissueMaterial } from "./foliage.js";

// The corals. Hard corals are stone: a colony is a skeleton the polyps have laid down,
// and it holds still in the flow, so they are ordinary lit meshes with a living film
// over the stone. Soft corals and the anemone are tissue, and every tentacle stands in
// the current on the same strand system the plants of a freshwater tank use, with the
// tissue material in place of the leaf.
//
// Under a reef lamp most of what a coral shows is fluorescence: the pigments take in the
// blue and give it back as green, orange or pink. That is why the palette below is
// written as a body colour and a glow, and why the glow only appears where the light is
// blue. Nothing here is a named species from a photograph the way the fish is; each is
// the growth form, at aquarium size.

// The coral heads the chromis hover over and dive into when something frightens them:
// the branching colonies, as volumes. Kept in the order the colonies are placed.
export const THICKETS = [];

// Corallite texture and fluorescence over stone. `glow` is the fluorescent colour, and
// `glowStrength` how much of the blue in the light comes back as it.
function coralSkin({ glow = "#7cffb0", glowStrength = 0.4, roughness = 0.86, dimple = 24 } = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness,
    metalness: 0,
    vertexColors: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.coralGlow = { value: new THREE.Color(glow) };
    shader.uniforms.coralGlowStrength = { value: glowStrength };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform vec3 coralGlow; uniform float coralGlowStrength;
        float coralHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float coralNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(coralHash(i), coralHash(i + vec3(1, 0, 0)), f.x), mix(coralHash(i + vec3(0, 1, 0)), coralHash(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(coralHash(i + vec3(0, 0, 1)), coralHash(i + vec3(1, 0, 1)), f.x), mix(coralHash(i + vec3(0, 1, 1)), coralHash(i + vec3(1, 1, 1)), f.x), f.y),
            f.z);
        }
        float gCorallite = 0.0;
      `,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        // Corallites: a close, even pitting over the whole skeleton, each cup a little
        // darker than the wall between.
        float cup = coralNoise(vWaterPosition * ${dimple.toFixed(1)});
        gCorallite = smoothstep(0.35, 0.75, cup);
        diffuseColor.rgb *= 0.82 + 0.18 * gCorallite;
      `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        vec3 pit = vec3(
          coralNoise(vWaterPosition * ${dimple.toFixed(1)} + 3.1) - 0.5,
          coralNoise(vWaterPosition * ${dimple.toFixed(1)} + 7.7) - 0.5,
          coralNoise(vWaterPosition * ${dimple.toFixed(1)} + 1.3) - 0.5);
        normal = normalize(normal + pit * 0.45);
      `,
      );
    waterLitShader(shader, {
      perLight: /* glsl */ `
        float blue = lit.color.b * 0.55;
        reflectedLight.directDiffuse += coralGlow * blue * coralGlowStrength * (0.6 + 0.4 * gCorallite);
      `,
    });
  };
  material.customProgramCacheKey = () => `coral-skin-v1-${glow}-${glowStrength}-${dimple}`;
  return material;
}

// Plain triangle soup with colours, for the stone corals.
class Stone {
  constructor() {
    this.positions = [];
    this.colors = [];
    this.indices = [];
  }
  vertex(p, color) {
    this.positions.push(p.x, p.y, p.z);
    this.colors.push(color.r, color.g, color.b);
    return this.positions.length / 3 - 1;
  }
  // A closed tube along `points`, `radiusAt(t)` wide, coloured by `colorAt(t)`.
  tube(points, radiusAt, colorAt, cols = 8) {
    const curve = new THREE.CatmullRomCurve3(points);
    const rows = Math.max(3, Math.ceil(curve.getLength() * 6));
    const frames = curve.computeFrenetFrames(rows, false);
    const start = this.positions.length / 3;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows,
        p = curve.getPointAt(t),
        r = radiusAt(t),
        color = colorAt(t);
      for (let j = 0; j <= cols; j++) {
        const a = (j / cols) * TAU;
        const lumps = 1 + 0.08 * Math.sin(a * 3 + t * 9) + 0.05 * Math.sin(a * 7 - t * 17);
        const v = p
          .clone()
          .addScaledVector(frames.normals[i], Math.cos(a) * r * lumps)
          .addScaledVector(frames.binormals[i], Math.sin(a) * r * lumps);
        this.vertex(v, color);
        if (i < rows && j < cols) {
          const k = start + i * (cols + 1) + j;
          this.indices.push(k, k + cols + 1, k + 1, k + 1, k + cols + 1, k + cols + 2);
        }
      }
    }
    // A rounded cap at the tip.
    const tip = this.vertex(curve.getPointAt(1).addScaledVector(curve.getTangentAt(1), radiusAt(1) * 0.8), colorAt(1));
    for (let j = 0; j < cols; j++) {
      const k = start + rows * (cols + 1) + j;
      this.indices.push(k, tip, k + 1);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    return g;
  }
}

// A staghorn colony: a few main stems from the base that fork as they rise, every
// branch drifting upward toward the light and away from its neighbours, the growing
// tips pale where the polyps have not yet laid down pigment. `size` is the height of
// the colony in scene units; a unit is about six centimetres.
function branchingCoral(stone, base, normal, size, body, tip, seed) {
  const pick = randomGenerator(seed);
  const grow = (start, direction, length, radius, depth) => {
    const points = [start.clone()];
    const dir = direction.clone();
    const steps = 3;
    for (let i = 1; i <= steps; i++) {
      // Each segment bends a little toward vertical and wanders.
      dir.y += 0.22 * (1 - dir.y);
      dir.x += (pick() - 0.5) * 0.3;
      dir.z += (pick() - 0.5) * 0.3;
      dir.normalize();
      points.push(points[i - 1].clone().addScaledVector(dir, length / steps));
    }
    const white = 1 - depth / 4;
    stone.tube(
      points,
      (t) => radius * (1 - 0.35 * t),
      (t) => body.clone().lerp(tip, smoothstep(0.55, 1, t) * (0.4 + 0.6 * white)),
      depth > 2 ? 6 : 8,
    );
    if (depth >= 4 || length < size * 0.12) return;
    const end = points[points.length - 1];
    const children = depth === 0 ? 3 : pick() < 0.7 ? 2 : 1;
    const spin = pick() * TAU;
    for (let c = 0; c < children; c++) {
      const a = spin + (c / children) * TAU + (pick() - 0.5) * 0.8;
      const spread = 0.35 + pick() * 0.3;
      const child = dir
        .clone()
        .multiplyScalar(1 - spread)
        .add(vec(Math.cos(a) * spread, 0.2, Math.sin(a) * spread))
        .normalize();
      grow(end, child, length * (0.62 + pick() * 0.2), radius * 0.68, depth + 1);
    }
    // A branch may carry a short side shoot partway up.
    if (depth < 3 && pick() < 0.6) {
      const t = 0.3 + pick() * 0.4;
      const p = new THREE.CatmullRomCurve3(points).getPointAt(t);
      const a = pick() * TAU;
      grow(p, vec(Math.cos(a), 0.9, Math.sin(a)).normalize(), length * 0.45, radius * 0.5, depth + 2);
    }
  };
  const stems = 3 + Math.floor(pick() * 2);
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * TAU + pick() * 0.7;
    const lean = 0.25 + pick() * 0.3;
    const dir = normal.clone().multiplyScalar(1 - lean).add(vec(Math.cos(a) * lean, 0.15, Math.sin(a) * lean)).normalize();
    const foot = base.clone().add(vec(Math.cos(a) * size * 0.1, -0.05, Math.sin(a) * size * 0.1));
    grow(foot, dir, size * 0.42, size * 0.075, 0);
  }
  // The heads are where the chromis go: the volume the branches fill.
  THICKETS.push({
    minX: base.x - size * 0.55, maxX: base.x + size * 0.55,
    minZ: base.z - size * 0.5, maxZ: base.z + size * 0.5,
    minY: base.y + size * 0.2, maxY: base.y + size * 1.15,
  });
}

// A brain coral: a boulder whose surface is folded into meandering valleys, the ridges
// one colour and the valleys another. The stone of the reef rock, refolded.
function brainCoral(stone, centre, radius, ridge, valley, seed) {
  const sphere = new THREE.SphereGeometry(1, 72, 48);
  const p = sphere.attributes.position;
  const start = stone.positions.length / 3;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Meanders: a slowly varying field, banded.
    const field = noise(v.x * 2.4 + seed, v.y * 2.4, v.z * 2.4) * 2 + noise(v.x * 6 + seed, v.y * 6, v.z * 6) * 0.6;
    const groove = 0.5 + 0.5 * Math.sin(field * 9.5);
    const depth = smoothstep(0.35, 0.85, groove);
    const bulge = 1 + 0.06 * (noise(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3) - 0.5);
    // Squat: a boulder coral is wider than it is tall, and its underside is buried.
    const r = radius * bulge * (1 - 0.055 * depth);
    const q = vec(v.x * r, v.y * r * 0.72, v.z * r).add(centre);
    stone.vertex(q, ridge.clone().lerp(valley, depth));
  }
  const index = sphere.index;
  for (let i = 0; i < index.count; i++) stone.indices.push(start + index.getX(i));
  sphere.dispose();
}

// A table coral: a plate that grew outward from a short stalk, its upper face thick
// with short vertical branchlets and its underside bare and shaded.
function tableCoral(stone, base, radius, body, tip, seed) {
  const pick = randomGenerator(seed);
  const top = base.y + radius * 0.45;
  // Stalk.
  stone.tube([base.clone(), vec(base.x, top - 0.02, base.z)], () => radius * 0.22, () => body.clone().multiplyScalar(0.8), 10);
  // Plate: two rings of vertices, upper and lower faces, with a wavy rim.
  const segments = 56;
  const rim = (a) => radius * (1 + 0.08 * Math.sin(a * 5 + seed) + 0.05 * Math.sin(a * 11));
  const upperCentre = stone.vertex(vec(base.x, top + 0.05, base.z), body);
  const lowerCentre = stone.vertex(vec(base.x, top - 0.08, base.z), body.clone().multiplyScalar(0.55));
  const upper = [], lower = [];
  for (let j = 0; j <= segments; j++) {
    const a = (j / segments) * TAU;
    const r = rim(a);
    const sag = -0.03 * r;
    upper.push(stone.vertex(vec(base.x + Math.cos(a) * r, top + 0.02 + sag, base.z + Math.sin(a) * r), body.clone().lerp(tip, 0.35)));
    lower.push(stone.vertex(vec(base.x + Math.cos(a) * r, top - 0.04 + sag, base.z + Math.sin(a) * r), body.clone().multiplyScalar(0.55)));
  }
  for (let j = 0; j < segments; j++) {
    stone.indices.push(upperCentre, upper[j], upper[j + 1]);
    stone.indices.push(lowerCentre, lower[j + 1], lower[j]);
    stone.indices.push(upper[j], lower[j], upper[j + 1], upper[j + 1], lower[j], lower[j + 1]);
  }
  // Branchlets over the plate, densest toward the rim where growth is youngest.
  const count = Math.round(radius * radius * 110);
  for (let i = 0; i < count; i++) {
    const a = pick() * TAU,
      d = Math.sqrt(pick()) * 0.92;
    const r = rim(a) * d;
    const foot = vec(base.x + Math.cos(a) * r, top + 0.02, base.z + Math.sin(a) * r);
    const h = radius * (0.12 + 0.16 * pick()) * (0.7 + 0.3 * d);
    stone.tube(
      [foot, foot.clone().add(vec((pick() - 0.5) * 0.05, h, (pick() - 0.5) * 0.05))],
      (t) => radius * 0.035 * (1 - 0.3 * t),
      (t) => body.clone().lerp(tip, smoothstep(0.4, 1, t)),
      5,
    );
  }
}

// How a tentacle answers the current at its parameter t: across its axis, toward
// wherever the flow pushes it.
function tentacleStrand(tangent, t, length, compliance) {
  const direction = FLOW_DIRECTION.clone().addScaledVector(tangent, -FLOW_DIRECTION.dot(tangent));
  if (direction.lengthSq() < 1e-4) direction.crossVectors(tangent, vec(0, 1, 0));
  return { direction: direction.normalize(), tangent, distance: t * length, compliance };
}

// One tentacle: a tapering tube from `root` along `direction`, optionally swelling into
// a bulb before the tip. `thin` rises root to tip and carries the fluorescence.
function tentacle(batch, root, direction, length, radius, colorAt, { bulb = 0, compliance = 1.4, rows = 7, cols = 5 } = {}) {
  const points = [root.clone()];
  const dir = direction.clone();
  for (let i = 1; i <= 3; i++) {
    dir.y += 0.15;
    dir.normalize();
    points.push(points[i - 1].clone().addScaledVector(dir, length / 3));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const start = batch.positions.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      p = curve.getPoint(t),
      tangent = curve.getTangent(t);
    const swell = bulb * Math.exp(-(((t - 0.82) / 0.13) ** 2));
    const r = radius * (1 - 0.55 * t) + swell;
    const a = new THREE.Vector3().crossVectors(tangent, vec(0.2, 0.01, 1)).normalize();
    const b = new THREE.Vector3().crossVectors(tangent, a).normalize();
    const strand = tentacleStrand(tangent, t, length, compliance);
    const color = colorAt(t);
    for (let j = 0; j <= cols; j++) {
      const angle = (j / cols) * TAU;
      const v = p.clone().addScaledVector(a, Math.cos(angle) * r).addScaledVector(b, Math.sin(angle) * r);
      batch.vertex(v, [j / cols, t], color, root, strand, t);
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
}

// A bubble-tip anemone: a short column fixed in a crevice, a disc, and a crowd of
// tentacles, each swollen just below the tip. The chromis leave it alone; a clownfish
// would not.
function anemone(batch, centre, normal, radius, { column, disc, tentacleColor, tipColor }, seed) {
  const pick = randomGenerator(seed);
  // The column: a wide, short tube up to the oral disc, held still.
  const still = { direction: vec(1, 0, 0), tangent: vec(0, 1, 0), distance: 0, compliance: 0 };
  const rows = 4, cols = 18;
  const start = batch.positions.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const r = radius * (0.55 + 0.25 * Math.sin(t * Math.PI) + 0.15 * t);
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * TAU;
      const v = centre.clone().add(vec(Math.cos(a) * r, t * radius * 0.5, Math.sin(a) * r));
      batch.vertex(v, [j / cols, t], column.clone().lerp(disc, t), centre, still, 0);
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  // The oral disc.
  const discY = centre.y + radius * 0.5;
  const mouth = batch.vertex(vec(centre.x, discY + 0.02, centre.z), [0.5, 0], disc.clone().multiplyScalar(0.7), centre, still, 0);
  const ring = [];
  for (let j = 0; j <= cols; j++) {
    const a = (j / cols) * TAU;
    ring.push(batch.vertex(vec(centre.x + Math.cos(a) * radius * 0.95, discY, centre.z + Math.sin(a) * radius * 0.95), [j / cols, 1], disc, centre, still, 0));
  }
  for (let j = 0; j < cols; j++) batch.indices.push(mouth, ring[j + 1], ring[j]);
  // Tentacles: rings of them, longest at the rim, shorter and more upright near the mouth.
  const count = Math.round(radius * radius * 130);
  for (let i = 0; i < count; i++) {
    const a = pick() * TAU,
      d = 0.15 + 0.8 * Math.sqrt(pick());
    const root = vec(centre.x + Math.cos(a) * radius * d, discY + 0.01, centre.z + Math.sin(a) * radius * d);
    const out = vec(Math.cos(a), 0, Math.sin(a));
    const direction = normal.clone().multiplyScalar(1.1 - 0.7 * d).addScaledVector(out, 0.15 + 0.85 * d).normalize();
    const length = radius * (0.55 + 0.5 * d) * (0.85 + 0.3 * pick());
    tentacle(batch, root, direction, length, radius * 0.045, (t) => tentacleColor.clone().lerp(tipColor, smoothstep(0.6, 0.95, t)), {
      bulb: radius * 0.05,
      compliance: 1.3 + 0.5 * pick(),
    });
  }
}

// A toadstool leather coral: a thick stalk under a folded cap, the cap furred with
// small polyps that all lean the same way in the flow.
function leatherCoral(batch, base, radius, { stalk, cap, polyp, polypTip }, seed) {
  const pick = randomGenerator(seed);
  const still = { direction: vec(1, 0, 0), tangent: vec(0, 1, 0), distance: 0, compliance: 0 };
  const height = radius * 0.9;
  // Stalk.
  const rows = 5, cols = 16;
  let start = batch.positions.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const r = radius * (0.3 - 0.06 * Math.sin(t * Math.PI) + 0.12 * t * t);
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * TAU;
      const v = base.clone().add(vec(Math.cos(a) * r, t * height, Math.sin(a) * r));
      batch.vertex(v, [j / cols, t], stalk.clone().lerp(cap, t * t), base, still, 0);
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  // Cap: a dished disc with a folded, drooping rim.
  const segments = 48, rings = 4;
  const capY = base.y + height;
  start = batch.positions.length / 3;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * TAU;
      const fold = 1 + 0.12 * Math.sin(a * 6 + seed) * t + 0.05 * Math.sin(a * 13) * t;
      const r = radius * t * fold;
      const y = capY + radius * (0.12 * Math.sin(t * Math.PI * 0.9) - 0.16 * t * t * t);
      batch.vertex(base.clone().add(vec(Math.cos(a) * r, y, Math.sin(a) * r)), [j / segments, t], cap, base, still, 0);
      if (i < rings && j < segments) {
        const k = start + i * (segments + 1) + j;
        batch.quad(k, k + 1, k + segments + 1, k + segments + 2);
      }
    }
  }
  // Polyps over the cap.
  const count = Math.round(radius * radius * 120);
  for (let i = 0; i < count; i++) {
    const a = pick() * TAU,
      t = Math.sqrt(pick()) * 0.95;
    const fold = 1 + 0.12 * Math.sin(a * 6 + seed) * t + 0.05 * Math.sin(a * 13) * t;
    const r = radius * t * fold;
    const y = capY + radius * (0.12 * Math.sin(t * Math.PI * 0.9) - 0.16 * t * t * t) + 0.01;
    const root = base.clone().add(vec(Math.cos(a) * r, y, Math.sin(a) * r));
    tentacle(batch, root, vec((pick() - 0.5) * 0.4, 1, (pick() - 0.5) * 0.4).normalize(), radius * (0.2 + 0.1 * pick()), radius * 0.022, (s) => polyp.clone().lerp(polypTip, s), {
      compliance: 2.2,
      rows: 3,
      cols: 4,
    });
  }
}

// Where a coral sits on the rock: straight down onto the rockwork from above the tank.
function settle(raycaster, meshes, x, z, fallback) {
  raycaster.set(vec(x, 20, z), vec(0, -1, 0));
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return { point: vec(x, groundHeight(x, z), z), normal: vec(0, 1, 0) };
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  return { point: hit.point, normal: normal.y < 0.3 ? vec(0, 1, 0) : normal };
}

export function createCorals(scene, { perches = [], animatedShadows = true } = {}) {
  const raycaster = new THREE.Raycaster();
  const rocks = perches.map((p) => p.mesh);
  for (const mesh of rocks) mesh.updateMatrixWorld(true);
  const obstacles = [];
  const stats = {};
  const c = (hex) => new THREE.Color(hex);

  // Stone corals, one mesh per palette.
  const stones = [
    // Staghorns: a blue-tipped brown one on the left summit, a purple one on the right
    // tier, a green one on the back ridge.
    { skin: coralSkin({ glow: "#6fd6ff", glowStrength: 0.45 }), build: (s) => {
      const { point, normal } = settle(raycaster, rocks, -4.6, -0.7);
      branchingCoral(s, point, normal, 2.4, c("#8a6a4a"), c("#b9e6ff"), 11);
    } },
    { skin: coralSkin({ glow: "#e07cff", glowStrength: 0.4 }), build: (s) => {
      const { point, normal } = settle(raycaster, rocks, 5.4, -1.2);
      branchingCoral(s, point, normal, 2.0, c("#6b4b7a"), c("#f0d8ff"), 23);
    } },
    { skin: coralSkin({ glow: "#8dff6a", glowStrength: 0.5 }), build: (s) => {
      let { point, normal } = settle(raycaster, rocks, -1.8, -4.4);
      branchingCoral(s, point, normal, 2.1, c("#5f7a48"), c("#dcffc4"), 37);
      ({ point, normal } = settle(raycaster, rocks, 2.9, -4.3));
      branchingCoral(s, point, normal, 1.7, c("#6f8a50"), c("#e2ffd0"), 41);
    } },
    // The brain coral on the sand at the right foot, and a smaller one behind the left.
    { skin: coralSkin({ glow: "#a8ff70", glowStrength: 0.18, dimple: 40 }), build: (s) => {
      const x = 2.55, z = 0.1;
      brainCoral(s, vec(x, groundHeight(x, z) + 0.2, z), 0.95, c("#b8aa84"), c("#5c6e4c"), 5);
      obstacles.push({ center: vec(x, groundHeight(x, z) + 0.2, z), radius: 1.0 });
      const x2 = -7.0, z2 = -2.0;
      brainCoral(s, vec(x2, groundHeight(x2, z2) + 0.15, z2), 0.7, c("#a89c86"), c("#56608a"), 9);
      obstacles.push({ center: vec(x2, groundHeight(x2, z2) + 0.15, z2), radius: 0.75 });
    } },
    // The table coral on the right stack's front slab.
    { skin: coralSkin({ glow: "#ffd27a", glowStrength: 0.35 }), build: (s) => {
      const { point } = settle(raycaster, rocks, 3.7, 0.35);
      tableCoral(s, point, 1.15, c("#8a7a5a"), c("#f4e8c8"), 17);
      obstacles.push({ center: point.clone().add(vec(0, 0.5, 0)), radius: 1.15 });
    } },
  ];
  let triangles = 0;
  for (const { skin, build } of stones) {
    const stone = new Stone();
    build(stone);
    const mesh = new THREE.Mesh(stone.geometry(), skin);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    triangles += stone.indices.length / 3;
  }
  stats.stoneTriangles = triangles;

  // Tissue: the anemone in the crevice between the left stack's slab and its tier, the
  // leather coral on the right base, and a second, smaller anemone on the pillar.
  const soft = [
    { material: tissueMaterial({ glow: "#ff8fb0", glowStrength: 0.5 }), build: (batch) => {
      const { point, normal } = settle(raycaster, rocks, -3.9, 0.9);
      anemone(batch, point.clone().add(vec(0, -0.1, 0)), normal, 1.05, {
        column: c("#7a5a48"), disc: c("#a88a70"), tentacleColor: c("#b0a080"), tipColor: c("#ff9ab8"),
      }, 3);
      obstacles.push({ center: point.clone().add(vec(0, 0.6, 0)), radius: 1.1 });
      const p2 = settle(raycaster, rocks, 7.7, -1.5);
      anemone(batch, p2.point.clone().add(vec(0, -0.05, 0)), p2.normal, 0.7, {
        column: c("#6a4a5a"), disc: c("#b08090"), tentacleColor: c("#9a8a80"), tipColor: c("#c8ffd8"),
      }, 7);
      obstacles.push({ center: p2.point.clone().add(vec(0, 0.4, 0)), radius: 0.75 });
    } },
    { material: tissueMaterial({ glow: "#c8ff9a", glowStrength: 0.3 }), build: (batch) => {
      const { point } = settle(raycaster, rocks, 5.0, 0.6);
      leatherCoral(batch, point.clone().add(vec(0, -0.05, 0)), 1.35, {
        stalk: c("#b8a48a"), cap: c("#d8c8a0"), polyp: c("#c8b890"), polypTip: c("#f0ffd0"),
      }, 13);
      obstacles.push({ center: point.clone().add(vec(0, 0.9, 0)), radius: 1.05 });
    } },
  ];
  let softTriangles = 0;
  for (const { material, build } of soft) {
    const batch = new GeometryBatch();
    build(batch);
    const mesh = new THREE.Mesh(batch.geometry(), material);
    mesh.customDepthMaterial = foliageDepth({ animated: animatedShadows });
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    softTriangles += batch.indices.length / 3;
  }
  stats.tissueTriangles = softTriangles;
  return { thickets: THICKETS, obstacles, stats };
}
