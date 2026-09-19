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
  // A closed tube along `points`, `radiusAt(t)` wide, coloured by `colorAt(t)`. The
  // wall is knobbled with corallites, each polyp's cup standing a little proud of the
  // skeleton between, so a branch reads as stone laid down by many small animals rather
  // than as a pipe.
  tube(points, radiusAt, colorAt, cols = 8, knobble = 0.14) {
    const curve = new THREE.CatmullRomCurve3(points);
    const rows = Math.max(3, Math.ceil(curve.getLength() * 7));
    const frames = curve.computeFrenetFrames(rows, false);
    const start = this.positions.length / 3;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows,
        p = curve.getPointAt(t),
        r = radiusAt(t),
        color = colorAt(t);
      for (let j = 0; j <= cols; j++) {
        const a = (j / cols) * TAU;
        const cup = noise(p.x * 34 + Math.cos(a) * 2.2, p.y * 34 + Math.sin(a) * 2.2, p.z * 34 + t * 3);
        const lumps = 1 + knobble * (cup - 0.5) * 2 + 0.05 * Math.sin(a * 3 + t * 9);
        const v = p
          .clone()
          .addScaledVector(frames.normals[i], Math.cos(a) * r * lumps)
          .addScaledVector(frames.binormals[i], Math.sin(a) * r * lumps);
        this.vertex(v, color.clone().multiplyScalar(0.9 + 0.2 * cup));
        if (i < rows && j < cols) {
          const k = start + i * (cols + 1) + j;
          this.indices.push(k, k + cols + 1, k + 1, k + 1, k + cols + 1, k + cols + 2);
        }
      }
    }
    // A rounded cap at the tip: the axial corallite.
    const tip = this.vertex(curve.getPointAt(1).addScaledVector(curve.getTangentAt(1), radiusAt(1) * 0.9), colorAt(1));
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

// A staghorn colony: several thick main stems from a common base that fork again and
// again as they rise, every branch curving upward toward the light and away from its
// neighbours, and carrying short side shoots along its length, so the colony fills out
// into a thicket rather than a rack of antlers. The growing tips are pale where the
// polyps have not yet laid down pigment. `size` is the height of the colony in scene
// units; a unit is about six centimetres.
function branchingCoral(stone, base, normal, size, body, tip, seed) {
  const pick = randomGenerator(seed);
  const grow = (start, direction, length, radius, depth) => {
    const points = [start.clone()];
    const dir = direction.clone();
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
      // Each segment bends a little toward vertical and wanders.
      dir.y += 0.18 * (1 - dir.y);
      dir.x += (pick() - 0.5) * 0.28;
      dir.z += (pick() - 0.5) * 0.28;
      dir.normalize();
      points.push(points[i - 1].clone().addScaledVector(dir, length / steps));
    }
    const white = 1 - depth / 5;
    const taper = depth >= 4 ? 0.5 : 0.3;
    stone.tube(
      points,
      (t) => radius * (1 - taper * t),
      (t) => body.clone().lerp(tip, smoothstep(0.5, 1, t) * (0.35 + 0.65 * white)),
      depth > 1 ? 6 : 8,
    );
    // Side shoots along the branch: short, upright, and frequent, so the branch reads
    // as a bearing stem and not a bare pipe.
    if (depth < 4) {
      const curve = new THREE.CatmullRomCurve3(points);
      const shoots = depth === 0 ? 2 + Math.floor(pick() * 2) : pick() < 0.75 ? 1 + Math.floor(pick() * 2) : 0;
      for (let k = 0; k < shoots; k++) {
        const t = 0.25 + pick() * 0.55;
        const p = curve.getPointAt(t);
        const a = pick() * TAU;
        const out = vec(Math.cos(a), 0.7 + pick() * 0.6, Math.sin(a)).normalize();
        grow(p, out, length * (0.3 + pick() * 0.25), radius * 0.45, depth + 3);
      }
    }
    if (depth >= 4 || length < size * 0.1) return;
    const end = points[points.length - 1];
    const children = depth === 0 ? 3 : pick() < 0.75 ? 2 : 1;
    const spin = pick() * TAU;
    for (let c = 0; c < children; c++) {
      const a = spin + (c / children) * TAU + (pick() - 0.5) * 0.8;
      const spread = 0.32 + pick() * 0.3;
      const child = dir
        .clone()
        .multiplyScalar(1 - spread)
        .add(vec(Math.cos(a) * spread, 0.25, Math.sin(a) * spread))
        .normalize();
      grow(end, child, length * (0.66 + pick() * 0.2), radius * 0.72, depth + 1);
    }
  };
  const stems = 4 + Math.floor(pick() * 2);
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * TAU + pick() * 0.7;
    const lean = 0.3 + pick() * 0.3;
    const dir = normal.clone().multiplyScalar(1 - lean).add(vec(Math.cos(a) * lean, 0.1, Math.sin(a) * lean)).normalize();
    const foot = base.clone().add(vec(Math.cos(a) * size * 0.08, -0.08, Math.sin(a) * size * 0.08));
    grow(foot, dir, size * 0.36, size * 0.075, 0);
  }
  // A low mound of skeleton where the stems meet, the colony's old base.
  const mound = new THREE.SphereGeometry(1, 20, 12);
  const mp = mound.attributes.position;
  const start = stone.positions.length / 3;
  for (let i = 0; i < mp.count; i++) {
    const v = vec(mp.getX(i), mp.getY(i), mp.getZ(i));
    const bump = 1 + 0.12 * (noise(v.x * 5 + seed, v.y * 5, v.z * 5) - 0.5);
    stone.vertex(vec(v.x * size * 0.16 * bump, v.y * size * 0.09 * bump, v.z * size * 0.16 * bump).add(base).add(vec(0, -0.06, 0)), body.clone().multiplyScalar(0.85));
  }
  for (let i = 0; i < mound.index.count; i++) stone.indices.push(start + mound.index.getX(i));
  mound.dispose();
  // The heads are where the chromis go: the volume the branches fill.
  THICKETS.push({
    minX: base.x - size * 0.55, maxX: base.x + size * 0.55,
    minZ: base.z - size * 0.5, maxZ: base.z + size * 0.5,
    minY: base.y + size * 0.2, maxY: base.y + size * 1.15,
  });
}

// A brain coral: a boulder whose surface is folded into meandering valleys, the ridges
// one colour and the valleys another. The valleys are cut deep enough to shade, and
// the ridges carry a fine sawtooth of septa across them.
function brainCoral(stone, centre, radius, ridge, valley, seed) {
  const sphere = new THREE.SphereGeometry(1, 100, 64);
  const p = sphere.attributes.position;
  const start = stone.positions.length / 3;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Meanders: a slowly varying field, banded, with a second field that breaks the
    // bands into the short closed loops a real brain coral has.
    const field =
      noise(v.x * 2.6 + seed, v.y * 2.6, v.z * 2.6) * 2 +
      noise(v.x * 6.5 + seed, v.y * 6.5, v.z * 6.5) * 0.7 +
      noise(v.x * 1.2 + seed * 3, v.y * 1.2, v.z * 1.2) * 0.8;
    const groove = 0.5 + 0.5 * Math.sin(field * 10.5);
    const depth = smoothstep(0.3, 0.8, groove);
    const septa = 0.5 + 0.5 * Math.sin(field * 10.5 * 5.0 + noise(v.x * 30, v.y * 30, v.z * 30) * 3);
    const bulge = 1 + 0.07 * (noise(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3) - 0.5);
    // Squat: a boulder coral is wider than it is tall, and its underside is buried.
    const r = radius * bulge * (1 - 0.11 * depth - 0.012 * septa * (1 - depth));
    const q = vec(v.x * r, v.y * r * 0.72, v.z * r).add(centre);
    stone.vertex(q, ridge.clone().lerp(valley, depth).multiplyScalar(1 - 0.08 * septa * (1 - depth)));
  }
  const index = sphere.index;
  for (let i = 0; i < index.count; i++) stone.indices.push(start + index.getX(i));
  sphere.dispose();
}

// A table coral: a plate that grew outward from a short stalk, thick at the centre and
// thinning to an irregular rim, its upper face crowded with short vertical branchlets
// that stand closest at the rim where growth is youngest, and its underside bare.
function tableCoral(stone, base, radius, body, tip, seed) {
  const pick = randomGenerator(seed);
  const top = base.y + radius * 0.4;
  // Stalk: short and thick, flaring into the plate.
  stone.tube(
    [base.clone(), vec(base.x, base.y + radius * 0.2, base.z), vec(base.x, top - 0.02, base.z)],
    (t) => radius * (0.26 - 0.06 * Math.sin(t * Math.PI) + 0.1 * t * t),
    () => body.clone().multiplyScalar(0.8),
    12,
    0.1,
  );
  // Plate: rings of vertices on the upper and lower faces, the rim wavy and lobed, the
  // plate doming slightly toward its centre.
  const segments = 72, rings = 5;
  const rim = (a) => radius * (1 + 0.1 * Math.sin(a * 4 + seed) + 0.06 * Math.sin(a * 9 + 1.3) + 0.03 * Math.sin(a * 17));
  const under = body.clone().multiplyScalar(0.5);
  const start = stone.positions.length / 3;
  for (const face of [1, -1]) {
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      for (let j = 0; j <= segments; j++) {
        const a = (j / segments) * TAU;
        const r = rim(a) * t;
        const thickness = radius * (0.09 * (1 - t * t) + 0.02);
        const dome = radius * 0.05 * (1 - t * t) - radius * 0.03 * t * t;
        const y = top + dome + (face > 0 ? thickness * 0.5 : -thickness * 0.5);
        const ripple = 1 + 0.02 * noise(Math.cos(a) * r * 6, y * 3, Math.sin(a) * r * 6);
        stone.vertex(vec(base.x + Math.cos(a) * r * ripple, y, base.z + Math.sin(a) * r * ripple), face > 0 ? body.clone().lerp(tip, 0.25 * t) : under);
      }
    }
  }
  const faceStride = (rings + 1) * (segments + 1);
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const k = start + i * (segments + 1) + j;
      stone.indices.push(k, k + 1, k + segments + 1, k + 1, k + segments + 2, k + segments + 1);
      const m = k + faceStride;
      stone.indices.push(m, m + segments + 1, m + 1, m + 1, m + segments + 1, m + segments + 2);
    }
  }
  // The rim: a band joining the two faces.
  for (let j = 0; j < segments; j++) {
    const u = start + rings * (segments + 1) + j;
    const l = u + faceStride;
    stone.indices.push(u, l, u + 1, u + 1, l, l + 1);
  }
  // Branchlets over the plate: a dense field of short, thick knobs, tallest and
  // closest toward the rim.
  const count = Math.round(radius * radius * 260);
  for (let i = 0; i < count; i++) {
    const a = pick() * TAU,
      d = Math.pow(pick(), 0.65) * 0.94;
    const r = rim(a) * d;
    const dome = radius * 0.05 * (1 - d * d) - radius * 0.03 * d * d;
    const foot = vec(base.x + Math.cos(a) * r, top + dome + radius * (0.09 * (1 - d * d) + 0.02) * 0.5 - 0.01, base.z + Math.sin(a) * r);
    const h = radius * (0.07 + 0.11 * pick()) * (0.6 + 0.4 * d);
    const lean = vec((pick() - 0.5) * 0.35 + Math.cos(a) * 0.15 * d, 1, (pick() - 0.5) * 0.35 + Math.sin(a) * 0.15 * d).normalize();
    stone.tube(
      [foot, foot.clone().addScaledVector(lean, h * 0.5), foot.clone().addScaledVector(lean, h)],
      (t) => radius * 0.035 * (1 - 0.25 * t),
      (t) => body.clone().lerp(tip, smoothstep(0.3, 1, t)),
      5,
      0.1,
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
    // The wall closes to a point at the tip.
    const r = (radius * (1 - 0.5 * t) + swell) * (1 - Math.pow(t, 10));
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

// A bubble-tip anemone: a short column fixed in a crevice, an oral disc, and a crowd of
// tentacles, each swollen into a bulb just below the tip, the outer ones sprawling
// outward and the inner ones standing up around the mouth. The chromis leave it alone;
// a clownfish would not.
function anemone(batch, centre, normal, radius, { column, disc, tentacleColor, tipColor }, seed) {
  const pick = randomGenerator(seed);
  // The column: a short, wide tube up to the oral disc, held still, its wall creased
  // with fine longitudinal folds.
  const still = { direction: vec(1, 0, 0), tangent: vec(0, 1, 0), distance: 0, compliance: 0 };
  const rows = 5, cols = 24;
  const height = radius * 0.32;
  const start = batch.positions.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * TAU;
      const fold = 1 + 0.03 * Math.sin(a * 14 + seed) + 0.04 * Math.sin(a * 3 + t * 2);
      const r = radius * (0.6 + 0.2 * Math.sin(t * Math.PI * 0.8) + 0.2 * t) * fold;
      const v = centre.clone().add(vec(Math.cos(a) * r, t * height, Math.sin(a) * r));
      batch.vertex(v, [j / cols, t], column.clone().lerp(disc, t * t), centre, still, 0);
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  // The oral disc: a shallow dish, dipping to the mouth at its centre.
  const discY = centre.y + height;
  const discRings = 3;
  const dstart = batch.positions.length / 3;
  for (let i = 0; i <= discRings; i++) {
    const t = i / discRings;
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * TAU;
      const r = radius * t;
      const y = discY + radius * (0.04 * t - 0.03 * (1 - t) * (1 - t));
      batch.vertex(vec(centre.x + Math.cos(a) * r, y, centre.z + Math.sin(a) * r), [j / cols, t], disc.clone().multiplyScalar(0.7 + 0.3 * t), centre, still, 0);
      if (i < discRings && j < cols) {
        const k = dstart + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  // Tentacles: crowded, longest at the rim where they lean out over the column, shorter
  // and more upright near the mouth.
  const count = Math.round(radius * radius * 210);
  for (let i = 0; i < count; i++) {
    const a = pick() * TAU,
      d = 0.12 + 0.86 * Math.sqrt(pick());
    const rootY = discY + radius * (0.04 * d - 0.03 * (1 - d) * (1 - d));
    const root = vec(centre.x + Math.cos(a) * radius * d, rootY, centre.z + Math.sin(a) * radius * d);
    const out = vec(Math.cos(a), 0, Math.sin(a));
    const wobble = vec((pick() - 0.5) * 0.5, 0, (pick() - 0.5) * 0.5);
    const direction = normal.clone().multiplyScalar(1.2 - 0.85 * d).addScaledVector(out, 0.1 + 0.95 * d).add(wobble).normalize();
    const length = radius * (0.5 + 0.45 * d) * (0.8 + 0.4 * pick());
    tentacle(batch, root, direction, length, radius * 0.038, (t) => tentacleColor.clone().lerp(tipColor, smoothstep(0.55, 0.9, t)), {
      bulb: radius * (0.045 + 0.03 * pick()),
      compliance: 1.3 + 0.5 * pick(),
      rows: 9,
      cols: 6,
    });
  }
}

// A toadstool leather coral: a stout stalk under a broad cap that folds and droops at
// its rim like a mushroom's, the cap's upper face furred with small polyps that all
// lean the same way in the flow.
function leatherCoral(batch, base, radius, { stalk, cap, polyp, polypTip }, seed) {
  const pick = randomGenerator(seed);
  const still = { direction: vec(1, 0, 0), tangent: vec(0, 1, 0), distance: 0, compliance: 0 };
  const height = radius * 0.5;
  // Stalk: narrower than the cap by a good margin, waisted, flaring into the cap.
  const rows = 6, cols = 20;
  let start = batch.positions.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * TAU;
      const crease = 1 + 0.03 * Math.sin(a * 9 + seed) + 0.02 * Math.sin(a * 4 - t * 3);
      const r = radius * (0.3 - 0.07 * Math.sin(t * Math.PI * 0.9) + 0.22 * t * t * t) * crease;
      const v = base.clone().add(vec(Math.cos(a) * r, t * height, Math.sin(a) * r));
      batch.vertex(v, [j / cols, t], stalk.clone().lerp(cap, t * t), base, still, 0);
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
  // Cap: a thick lens, its upper face gently domed then dished toward a lobed, folded
  // rim that turns down; an underside that turns back in toward the stalk.
  const segments = 96, rings = 10;
  // Heights below are relative to `base`, as the stalk's are.
  const capY = height;
  const lobes = (a, t) => 1 + t * t * (0.13 * Math.sin(a * 5 + seed) + 0.06 * Math.sin(a * 11 + 2.0) + 0.03 * Math.sin(a * 23));
  // The rim rises and falls in folds, like the brim of a hat that has been crumpled.
  const folds = (a, t) => radius * t * t * t * (0.1 * Math.sin(a * 5 + seed + 1.2) + 0.05 * Math.sin(a * 8 - 0.7));
  const capTop = (t, a) => radius * (0.14 * Math.sin(t * Math.PI * 0.75) - 0.2 * t * t * t * t) + folds(a, t);
  const capUnder = (t, a) => capTop(Math.min(1, t), a) - radius * (0.1 * (1 - t * t) + 0.02);
  start = batch.positions.length / 3;
  for (const face of [1, -1]) {
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      for (let j = 0; j <= segments; j++) {
        const a = (j / segments) * TAU;
        const r = radius * (face > 0 ? t : 0.33 + 0.67 * t) * lobes(a, t);
        const y = capY + (face > 0 ? capTop(t, a) : capUnder(t, a)) + 0.01 * Math.sin(a * 11 + t * 4);
        batch.vertex(base.clone().add(vec(Math.cos(a) * r, y, Math.sin(a) * r)), [j / segments, t], face > 0 ? cap : cap.clone().multiplyScalar(0.62), base, still, 0);
      }
    }
  }
  const faceStride = (rings + 1) * (segments + 1);
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const k = start + i * (segments + 1) + j;
      batch.quad(k, k + 1, k + segments + 1, k + segments + 2);
      const m = k + faceStride;
      batch.quad(m + 1, m, m + segments + 2, m + segments + 1);
    }
  }
  for (let j = 0; j < segments; j++) {
    const u = start + rings * (segments + 1) + j;
    const l = u + faceStride;
    batch.quad(u + 1, u, l + 1, l);
  }
  // Polyps over the cap: a fuzz of them, short and fine and close together, so the cap
  // reads as velvet rather than a lawn.
  const count = Math.round(radius * radius * 640);
  for (let i = 0; i < count; i++) {
    const a = pick() * TAU,
      t = Math.sqrt(pick()) * 0.97;
    const r = radius * t * lobes(a, t);
    const y = capY + capTop(t, a) + 0.01 * Math.sin(a * 11 + t * 4) + 0.004;
    const root = base.clone().add(vec(Math.cos(a) * r, y, Math.sin(a) * r));
    tentacle(batch, root, vec((pick() - 0.5) * 0.6 + Math.cos(a) * 0.35 * t, 1, (pick() - 0.5) * 0.6 + Math.sin(a) * 0.35 * t).normalize(), radius * (0.07 + 0.05 * pick()), radius * 0.011, (s) => polyp.clone().lerp(polypTip, s), {
      compliance: 2.4,
      rows: 2,
      cols: 3,
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
      branchingCoral(s, point, normal, 2.3, c("#8a6a4a"), c("#b9e6ff"), 11);
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
      brainCoral(s, vec(x, groundHeight(x, z) + 0.2, z), 0.95, c("#c8b48a"), c("#3e5a44"), 5);
      obstacles.push({ center: vec(x, groundHeight(x, z) + 0.2, z), radius: 1.0 });
      const x2 = -7.0, z2 = -2.0;
      brainCoral(s, vec(x2, groundHeight(x2, z2) + 0.15, z2), 0.7, c("#b8ac92"), c("#3c4470"), 9);
      obstacles.push({ center: vec(x2, groundHeight(x2, z2) + 0.15, z2), radius: 0.75 });
    } },
    // The table coral on the right stack's front slab.
    { skin: coralSkin({ glow: "#ffd27a", glowStrength: 0.35 }), build: (s) => {
      const { point } = settle(raycaster, rocks, 3.7, 0.35);
      tableCoral(s, point, 1.05, c("#9a8660"), c("#f4e8c8"), 17);
      obstacles.push({ center: point.clone().add(vec(0, 0.45, 0)), radius: 1.05 });
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
      leatherCoral(batch, point.clone().add(vec(0, -0.05, 0)), 1.3, {
        stalk: c("#a89478"), cap: c("#d4c49c"), polyp: c("#c4b48c"), polypTip: c("#eef4cc"),
      }, 13);
      obstacles.push({ center: point.clone().add(vec(0, 0.7, 0)), radius: 1.2 });
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
