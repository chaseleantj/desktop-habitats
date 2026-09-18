import * as THREE from "three";
import {
  channel,
  groundHeight,
  noise,
  random,
  randomGenerator,
  range,
  smoothstep,
  vec,
} from "./math.js";
import {
  SURFACE_Y,
  currentGLSL,
  surfaceLightGLSL,
  waterLitShader,
  waterTime,
  CURRENT_SPEED,
} from "./water.js";

const TAU = Math.PI * 2;

// Coralline algae plates where the light is moderate and the water moves: the shoulders
// and faces of the rock rather than its sunlit crown, and thickest on the old rock at the
// heart of each stack. Coverage runs 0 (bare) to 1 (solid plating). A slow noise field
// lowers the threshold unevenly, so patches sit at different stages of growth.
const CRUST_COLONIES = [
  // The left stack: its shaded inner faces and the underside of the overhang.
  { center: vec(-4.2, 1.6, 0.8), radius: 1.1, strength: 0.4 },
  { center: vec(-5.6, 3.0, -0.4), radius: 0.9, strength: 0.45 },
  { center: vec(-3.3, 2.2, 0.4), radius: 0.7, strength: 0.35 },
  // The right stack and the pillar.
  { center: vec(4.3, 1.7, 0.5), radius: 1.0, strength: 0.35 },
  { center: vec(5.7, 3.1, -0.9), radius: 0.8, strength: 0.4 },
  { center: vec(7.4, 1.4, -0.9), radius: 0.9, strength: 0.4 },
  // The back ridge, deep in the blue.
  { center: vec(0.4, 1.3, -3.6), radius: 1.3, strength: 0.3 },
  { center: vec(-2.0, 1.2, -4.0), radius: 0.9, strength: 0.3 },
];
// The live rock, shared with the corals that grow on it. Two stacks, a taller one on the
// left answering a lower, wider one on the right, with an open lane of sand between them
// running back to a low ridge against the blue. Rock is stacked, not scattered: a base
// piece part sunk in the sand, a second tier set back on it, a slab pushed out as an
// overhang. `y` is the centre height of a stacked piece; a piece without it rests on the
// sand. `lean` tips a stone about the tank's front axis.
// Order matters: the corals in `corals.js` sit on a rock by its index here, and the
// crust colonies above are placed by hand, so move a rock's growth with it.
export const ROCKS = [
  // Left stack.
  { x: -4.9, z: -0.3, rx: 2.1, ry: 1.45, rz: 1.6, lean: 0.1 },
  { x: -5.4, z: -0.9, y: 2.55, rx: 1.55, ry: 1.2, rz: 1.25, lean: -0.22 },
  { x: -4.7, z: -0.7, y: 4.05, rx: 1.1, ry: 0.85, rz: 0.95, lean: 0.18 },
  { x: -3.35, z: 0.1, y: 2.5, rx: 1.15, ry: 0.42, rz: 0.85, lean: 0.32 },
  // Right stack.
  { x: 4.9, z: -0.6, rx: 1.85, ry: 1.3, rz: 1.45, lean: -0.1 },
  { x: 5.5, z: -1.2, y: 2.3, rx: 1.3, ry: 1.0, rz: 1.1, lean: 0.2 },
  { x: 3.75, z: 0.35, y: 2.15, rx: 1.15, ry: 0.42, rz: 0.9, lean: -0.28 },
  // The pillar at the far right, and the ridge along the back.
  { x: 7.7, z: -1.7, rx: 0.9, ry: 2.1, rz: 0.9, lean: 0.05 },
  { x: 0.5, z: -4.3, rx: 2.4, ry: 1.1, rz: 1.0, lean: 0 },
  { x: -1.9, z: -4.6, rx: 1.5, ry: 0.9, rz: 0.9, lean: -0.1 },
  { x: 2.7, z: -4.4, rx: 1.3, ry: 0.8, rz: 0.9, lean: 0.1 },
  // Loose pieces at the foot of the stacks.
  { x: -2.4, z: 1.3, rx: 0.5, ry: 0.35, rz: 0.45, lean: -0.15, pale: true },
  { x: 2.6, z: 1.5, rx: 0.42, ry: 0.32, rz: 0.4, lean: 0.2 },
  { x: -7.4, z: 0.6, rx: 0.6, ry: 0.4, rz: 0.5, lean: -0.1 },
  { x: 7.0, z: 0.7, rx: 0.45, ry: 0.3, rz: 0.4, lean: 0.15, pale: true },
];
// A stone on the sand is buried to a little under half its height, and deeper the more
// it leans, so the raised side of a leaning stone still meets the sand. A stacked stone
// sits where it was put.
export function rockCenterY(rock) {
  if (rock.y !== undefined) return rock.y;
  return (
    groundHeight(rock.x, rock.z) +
    rock.ry * 0.57 -
    Math.abs(rock.lean) * rock.rx * 0.55
  );
}

function crustCoverage(p, n, shelter, bias = 0) {
  let colony = 0;
  for (const c of CRUST_COLONIES) {
    const d = p.distanceToSquared(c.center) / (c.radius * c.radius);
    colony = Math.max(colony, c.strength * Math.exp(-d * 1.6));
  }
  const patch =
    noise(p.x * 1.15 + 5.2, p.y * 1.15, p.z * 1.15) * 0.55 +
    noise(p.x * 3.4 + 1.7, p.y * 3.4, p.z * 3.4 + 8.4) * 0.45;
  const age = noise(p.x * 0.4 + 21.3, p.y * 0.4, p.z * 0.4 + 4.6);
  // Coralline likes the sides of the rock, out of the full glare of the lamp.
  const exposure = 0.45 + 0.55 * (1 - Math.max(0, n.y) * 0.7);
  const value = patch * exposure + shelter * 0.25 + colony + bias;
  const threshold = 0.82 - age * 0.25;
  return smoothstep(threshold, threshold + 0.3, value);
}

// Writes per-vertex coverage into `geometry` (in world space through `matrix`).
function growCrust(geometry, matrix, shelterAt, bias = 0) {
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const coverage = new Float32Array(positions.count);
  const p = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    p.fromBufferAttribute(positions, i).applyMatrix4(matrix);
    n.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
    coverage[i] = crustCoverage(p, n, shelterAt(p, i), bias);
  }
  geometry.setAttribute("moss", new THREE.BufferAttribute(coverage, 1));
}

// The crust on rock and sand: on live rock, coralline algae, a thin pink film where it is
// young and a hard purple plating where it is established; on the sand, the brown film of
// diatoms that settles wherever the flow lets it. Plating coralline is smooth and a little
// glossy, unlike turf, so the crust lowers roughness rather than raising it, and its edge
// is broken up by fine noise the way a crust grows outward in lobes.
const mossGLSL = /* glsl */ `
  varying float vMoss;
  uniform vec3 mossFilm;
  uniform vec3 mossTurf;
  float gMoss = 0.0;
  vec3 gMossColor = vec3(0.0);
  float mossHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float mossNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(mossHash(i), mossHash(i + vec3(1, 0, 0)), f.x), mix(mossHash(i + vec3(0, 1, 0)), mossHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(mossHash(i + vec3(0, 0, 1)), mossHash(i + vec3(1, 0, 1)), f.x), mix(mossHash(i + vec3(0, 1, 1)), mossHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;
function mossLayer(material, film, turf) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.mossFilm = { value: new THREE.Color(film) };
    shader.uniforms.mossTurf = { value: new THREE.Color(turf) };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float moss; varying float vMoss;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMoss = moss;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${mossGLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        vec3 mossFuzz = vec3(0.0);
        if (vMoss > 0.02) {
          float mossFine = mossNoise(vWaterPosition * 9.0) * 0.6 + mossNoise(vWaterPosition * 27.0) * 0.4;
          gMoss = smoothstep(0.07, 0.5, vMoss + (mossFine - 0.5) * 0.45);
          gMossColor = mix(mossFilm, mossTurf, smoothstep(0.15, 0.85, vMoss)) * (0.6 + 0.8 * mossFine);
          // Growth lies in the same shade as the surface it grows on: the pit of a stone,
          // the hollow of a sand ripple.
          #ifdef USE_COLOR
            gMossColor *= vColor;
          #endif
          diffuseColor.rgb = mix(diffuseColor.rgb, gMossColor, gMoss);
          mossFuzz = vec3(mossFine - 0.5, mossNoise(vWaterPosition * 31.0 + 7.0) - 0.5, fract(mossFine * 7.0) - 0.5);
        }
      `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, gMoss);",
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        normal = normalize(normal + gMoss * 0.18 * mossFuzz);
      `,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `
        #include <lights_fragment_end>
        // Coralline answers the blue light with a faint pink fluorescence of its own.
        reflectedLight.indirectDiffuse += gMoss * gMossColor * 0.22;
      `,
      );
    waterLitShader(shader);
  };
  material.customProgramCacheKey = () => "crusted-surface-v1";
  return material;
}

// Young coralline is a thin rose film; established plating is a deep purple. The film on
// sand is the brown of diatoms rather than pink.
async function surface(loader, name, repeat, color, film, turf = "#8a3d86") {
  const [map, normalMap] = await Promise.all([
    loader.loadAsync(`assets/${name}_diff.jpg`),
    loader.loadAsync(`assets/${name}_nor_gl.jpg`),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = 8;
  }
  return mossLayer(
    new THREE.MeshStandardMaterial({
      map,
      normalMap,
      color,
      roughness: 0.92,
      normalScale: new THREE.Vector2(0.65, 0.65),
      vertexColors: true,
    }),
    film,
    turf,
  );
}

function rockGeometry(seed, detail = 112) {
  const geometry = new THREE.SphereGeometry(
    1,
    detail,
    Math.floor(detail * 0.7),
  );
  const positions = geometry.attributes.position;
  const color = new THREE.Color();
  const colors = [];
  const planes = [];
  const sample = randomGenerator(Math.round(seed * 1000) + 27461);
  const pits = [];
  if (detail > 20)
    for (let i = 0; i < 115; i++) {
      const y = sample() * 2 - 1,
        a = sample() * Math.PI * 2,
        r = Math.sqrt(1 - y * y);
      const radius = 0.022 + sample() ** 2 * 0.18;
      pits.push({
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        radius,
        depth: radius * (0.3 + sample() * 0.8),
      });
    }
  for (let i = 0; i < 15; i++) {
    const a = i * 2.399963 + seed,
      y = 1 - (2 * (i + 0.5)) / 15,
      r = Math.sqrt(1 - y * y);
    planes.push({
      normal: vec(Math.cos(a) * r, y, Math.sin(a) * r),
      distance: 0.76 + noise(i, seed, 4) * 0.35,
    });
  }
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const a = noise(x * 2.5 + seed, y * 2.5, z * 2.5);
    const b = noise(x * 7 + seed, y * 7, z * 7);
    const c = noise(x * 22 + seed, y * 22, z * 22);
    const strata = Math.pow(
      Math.abs(Math.sin(x * 3.2 + y * 9 + z * 2.7 + a * 6)),
      18,
    );
    let radius = 1.28;
    for (const plane of planes) {
      const dot = x * plane.normal.x + y * plane.normal.y + z * plane.normal.z;
      if (dot > 0) radius = Math.min(radius, plane.distance / dot);
    }
    radius +=
      (a - 0.5) * 0.1 + (b - 0.5) * 0.055 + (c - 0.5) * 0.023 - strata * 0.017;
    let depression = 0;
    let rim = 0;
    for (const pit of pits) {
      const d =
        Math.sqrt(
          (x - pit.x) ** 2 + ((y - pit.y) * 1.17) ** 2 + (z - pit.z) ** 2,
        ) / pit.radius;
      if (d < 1) depression += pit.depth * (1 - d * d) ** 0.65;
      else if (d < 1.2) rim += (1.2 - d) * 0.1;
    }
    radius -= Math.min(0.25, depression);
    positions.setXYZ(i, x * radius, y * radius, z * radius);
    color
      .setRGB(1, 0.985, 0.945)
      .multiplyScalar(
        (0.8 + 0.2 * a + rim) * (1 - Math.min(0.52, depression * 2.1)),
      );
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createContactShadows(scene, rocks) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 5, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,.85)");
  gradient.addColorStop(0.42, "rgba(0,0,0,.48)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    opacity: 0.67,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  for (const rock of rocks) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(rock.rx * 3.5, rock.rz * 3.5),
      material,
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(rock.x, groundHeight(rock.x, rock.z) + 0.008, rock.z);
    scene.add(plane);
  }
}

export async function createEnvironment(scene) {
  const loader = new THREE.TextureLoader();
  const [rockMaterial, sandMaterial] = await Promise.all([
    surface(loader, "rock_boulder_dry", [1.8, 1.4], 0xb4aab4, "#d493b8"),
    surface(loader, "sand_01", [10, 6], 0xfff7e9, "#7a5c48", "#4d3a2e"),
  ]);
  rockMaterial.normalScale.set(0.85, 0.85);
  sandMaterial.normalScale.set(0.28, 0.28);

  const rocks = ROCKS;
  // How sheltered the sand is from the flow: against the foot of each stack and along the
  // back ridge, where rubble collects and the diatom film is left alone.
  const shelterAt = (x, z) => {
    let shelter = 0;
    for (const r of rocks) {
      if (r.y !== undefined) continue;
      const size = Math.max(r.rx, r.rz);
      const gap = Math.hypot(x - r.x, z - r.z) - size;
      shelter = Math.max(shelter, smoothstep(0.6 + 0.8 * size, 0.1, gap));
    }
    return Math.max(shelter, 0.55 * smoothstep(-1.4, -3.2, z));
  };
  // Diatoms film the sheltered sand; the open lane is swept nearly clean.
  const sandShelter = (p) => shelterAt(p.x, p.z) * (1 - 0.85 * channel(p.x, p.z));
  // Relative rubble density: broken coral and shell gather where the sand is sheltered and
  // along the edges of the lane, where the flow leaving it slackens.
  const sediment = (x, z) => {
    const open = channel(x, z);
    const bank = smoothstep(0.55, 0.2, open) * smoothstep(0.02, 0.1, open);
    return (0.06 + 1.3 * shelterAt(x, z) + 0.6 * bank) * (1 - 0.85 * open);
  };
  const sedimentSpot = (minX, maxX, minZ, maxZ, floor = 0) => {
    for (;;) {
      const x = range(minX, maxX),
        z = range(minZ, maxZ);
      if (random() * 2 < floor + (1 - floor) * sediment(x, z)) return [x, z];
    }
  };

  const ground = new THREE.PlaneGeometry(24, 18, 200, 140);
  ground.rotateX(-Math.PI / 2);
  const position = ground.attributes.position;
  const groundColors = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i);
    position.setY(i, groundHeight(x, z) + 0.006 * noise(x * 40, 0, z * 40));
    // White sand stays bright a long way back under a reef lamp; it only dims in the
    // last stretch against the ridge.
    const shade = 0.3 + 0.7 * THREE.MathUtils.smoothstep(z, -5.2, -1.6);
    groundColors.push(shade, shade, shade);
  }
  ground.setAttribute("color", new THREE.Float32BufferAttribute(groundColors, 3));
  ground.computeVertexNormals();
  const sand = new THREE.Mesh(ground, sandMaterial);
  sand.receiveShadow = true;
  scene.add(sand);
  growCrust(ground, sand.matrix, (p) => 0.4 * sandShelter(p), -0.3);

  const obstacles = [];
  const landmarks = [];
  // The pale rock is a fresher, whiter piece of the same reef rock.
  const pale = mossLayer(rockMaterial.clone(), "#d493b8", "#8a3d86");
  pale.color.set(0xd8d0c8);
  const perches = [];
  rocks.forEach((r, i) => {
    const geometry = rockGeometry(i * 2.63);
    const grain = Math.max(0.8, (r.rx + r.ry + r.rz) / 3.3);
    const uv = geometry.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * grain, uv.getY(k) * grain);
    const mesh = new THREE.Mesh(geometry, r.pale ? pale : rockMaterial);
    mesh.scale.set(r.rx, r.ry, r.rz);
    mesh.position.set(r.x, rockCenterY(r), r.z);
    mesh.rotation.set(range(-0.1, 0.1), range(-3, 3), r.lean, "ZYX");
    mesh.updateMatrix();
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    // Pits hold the crust's first settlers; the lower faces of a stacked stone are shaded.
    const tints = mesh.geometry.attributes.color;
    growCrust(
      mesh.geometry,
      mesh.matrix,
      (p, index) => 0.4 * (1 - tints.getX(index)) + 0.25 * smoothstep(0.9, 0.2, p.y - groundHeight(p.x, p.z)),
      -0.04,
    );
    const radius = Math.max(r.rx, r.ry, r.rz) * 0.82;
    obstacles.push({ center: mesh.position.clone(), radius });
    perches.push({ index: i, mesh, top: mesh.position.y + r.ry * 0.9 });
    if (radius > 0.6)
      landmarks.push({
        kind: "rock",
        point: mesh.position.clone().add(vec(0, r.ry * 0.85, r.rz * 0.55)),
        obstacle: obstacles.length - 1,
      });
  });
  createContactShadows(scene, rocks.filter((r) => r.y === undefined));

  // Rubble: broken branch tips and shell, mostly white, some still carrying crust.
  const rubbleGeometry = rockGeometry(37, 12);
  rubbleGeometry.setAttribute(
    "moss",
    new THREE.BufferAttribute(new Float32Array(rubbleGeometry.attributes.position.count), 1),
  );
  const rubbleMaterial = new THREE.MeshStandardMaterial({ color: 0xf2ebe0, roughness: 0.95, vertexColors: true });
  rubbleMaterial.onBeforeCompile = (shader) => waterLitShader(shader);
  const rubble = new THREE.InstancedMesh(rubbleGeometry, rubbleMaterial, 300);
  const matrix = new THREE.Object3D(),
    color = new THREE.Color();
  for (let i = 0; i < rubble.count; i++) {
    const [x, z] = sedimentSpot(-8.7, 8.7, -3.4, 3.1);
    const s =
      (0.02 + 0.09 * random() ** 2.4) *
      (0.7 + 0.8 * Math.min(1, sediment(x, z))) *
      (1 - 0.45 * channel(x, z));
    matrix.position.set(x, groundHeight(x, z) + s * 0.3, z);
    matrix.scale.set(s * range(0.8, 1.6), s * range(0.45, 0.8), s);
    matrix.rotation.set(range(-0.4, 0.4), range(0, 3), range(-0.4, 0.4));
    matrix.updateMatrix();
    rubble.setMatrixAt(i, matrix.matrix);
    rubble.setColorAt(i, color.setHSL(range(0.85, 0.98), range(0, 0.2), range(0.8, 1.0)));
  }
  rubble.castShadow = rubble.receiveShadow = true;
  scene.add(rubble);

  const gritMaterial = new THREE.MeshStandardMaterial({ color: 0xe8dccb, roughness: 1 });
  const grit = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), gritMaterial, 3600);
  for (let i = 0; i < grit.count; i++) {
    const [x, z] = sedimentSpot(-9, 9, -4, 4, 0.35);
    const s = range(0.006, 0.024);
    matrix.position.set(x, groundHeight(x, z) + s * 0.3, z);
    matrix.scale.set(s, s * 0.55, s);
    matrix.rotation.set(range(0, 3), range(0, 3), range(0, 3));
    matrix.updateMatrix();
    grit.setMatrixAt(i, matrix.matrix);
    grit.setColorAt(i, color.setHSL(range(0.05, 0.12), range(0.05, 0.3), range(0.4, 0.92)));
  }
  grit.receiveShadow = true;
  scene.add(grit);

  return { obstacles, landmarks, perches, rockMaterial };
}

export function createParticles(scene, { thickets }) {
  const debris = 620,
    bubbles = 48,
    count = debris + bubbles;
  const positions = new Float32Array(count * 3),
    seeds = new Float32Array(count),
    kinds = new Float32Array(count),
    sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const bubble = i >= debris;
    if (bubble) {
      // Bubbles rise from the wavemaker at the back left and from a few pockets under the
      // rock where the skimmer's return collects.
      if (i % 3 !== 0) positions.set([range(-8.6, -7.4), range(3, 7), range(-4.6, -3.6)], i * 3);
      else {
        const x = range(-7, 7),
          z = range(-1.5, 2.6);
        positions.set([x, groundHeight(x, z) + 0.1, z], i * 3);
      }
      sizes[i] = range(0.03, 0.075);
    } else {
      positions.set([range(-9, 9), range(0.4, 9.6), range(-5.4, 3.4)], i * 3);
      // Mostly fine suspended matter, with an occasional larger fragment catching light.
      sizes[i] = 0.005 + 0.038 * random() ** 2.4;
    }
    seeds[i] = random();
    kinds[i] = bubble ? 1 : 0;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("kind", new THREE.BufferAttribute(kinds, 1));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.lights,
    THREE.UniformsLib.fog,
    { pixelScale: { value: 1000 } },
  ]);
  uniforms.waterTime = waterTime;
  const material = new THREE.ShaderMaterial({
    uniforms,
    lights: true,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_vertex>
      uniform float pixelScale;
      attribute float seed;
      attribute float kind;
      attribute float size;
      varying float vKind;
      varying float vFade;
      varying float vLight;
      varying vec2 vGlint;
      ${currentGLSL}
      ${surfaceLightGLSL}
      #if NUM_DIR_LIGHT_SHADOWS > 0
        uniform mat4 directionalShadowMatrix[NUM_DIR_LIGHT_SHADOWS];
        uniform sampler2D directionalShadowMap[NUM_DIR_LIGHT_SHADOWS];
      #endif
      void main() {
        float t = waterTime;
        vec3 p = position;
        vKind = kind;
        float tumble = 1.0;
        if (kind > 0.5) {
          // Buoyancy carries a bubble up at a speed set by its size; it wobbles as it rises
          // and is released again at its origin once it reaches the surface.
          float speed = 1.2 + size * 30.0;
          float travel = ${SURFACE_Y.toFixed(1)} - position.y;
          float period = travel / speed + 2.0 + seed * 9.0;
          float age = mod(t + seed * period, period);
          float risen = age * speed;
          p.y += min(risen, travel);
          p.x += sin(age * 6.0 + seed * 20.0) * 0.035;
          p.z += cos(age * 5.1 + seed * 17.0) * 0.03;
          vFade = smoothstep(0.0, 0.15, age) * (1.0 - step(travel, risen));
        } else {
          // Neutrally buoyant flecks ride the current, sinking a little, tumbling as they go.
          p += FLOW_DIRECTION * currentTravel(position, t) * ${CURRENT_SPEED.toFixed(3)} * (0.75 + seed * 0.5);
          p.x = mod(p.x + 9.5, 19.0) - 9.5;
          p.z = mod(p.z + 5.6, 9.2) - 5.6;
          p.y = mod(position.y - t * (0.012 + seed * 0.02) - 0.3, 9.4) + 0.3;
          tumble = 0.35 + 0.65 * abs(sin(t * (1.1 + seed * 2.5) + seed * 40.0));
          vFade = smoothstep(9.5, 8.6, abs(p.x)) * smoothstep(0.3, 0.9, p.y) * (0.45 + 0.55 * fract(seed * 7.31));
        }
        float lit = 1.0;
        #if NUM_DIR_LIGHT_SHADOWS > 0
          vec4 shadowCoord = directionalShadowMatrix[0] * vec4(p, 1.0);
          shadowCoord.xyz /= shadowCoord.w;
          if (all(greaterThan(shadowCoord.xy, vec2(0.0))) && all(lessThan(shadowCoord.xy, vec2(1.0)))) {
            float occluder = unpackRGBAToDepth(texture2D(directionalShadowMap[0], shadowCoord.xy));
            lit = shadowCoord.z - 0.0015 <= occluder ? 1.0 : 0.0;
          }
        #endif
        vec3 water = waterLight(p, t) * waterLightDrift(p, t);
        vLight = (0.08 + 0.92 * lit) * water.g * tumble;
        vGlint = vec2(-0.16, 0.2);
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = max(1.3, size * pixelScale / -mvPosition.z);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      varying float vKind;
      varying float vFade;
      varying float vLight;
      varying vec2 vGlint;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0 || vFade <= 0.0) discard;
        vec3 color;
        float alpha;
        if (vKind > 0.5) {
          // An air sphere: light refracts around a dark rim, and a bright glint faces the lamp.
          float rim = smoothstep(0.5, 1.0, r);
          float glint = exp(-dot(c - vGlint, c - vGlint) * 55.0);
          color = mix(vec3(0.22, 0.27, 0.22), vec3(0.02, 0.03, 0.02), rim) * (0.4 + 0.6 * vLight) + glint * 3.2 * vLight;
          alpha = (0.3 + 0.6 * rim) * vFade;
        } else {
          // A matte fleck: bright in the beam, invisible in shade; some are darker plant
          // fragments, some pale mulm.
          color = vec3(0.62, 0.64, 0.5) * vLight * (1.2 + 2.4 * vFade);
          alpha = (1.0 - smoothstep(0.15, 1.0, r)) * vFade * 0.72;
        }
        gl_FragColor = vec4(color, alpha);
        #include <fog_fragment>
      }`,
  });
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;
  scene.add(particles);
  return {
    // pixelScale converts a world-space size at unit distance into rendered pixels.
    update(pixelScale) {
      uniforms.pixelScale.value = pixelScale;
    },
  };
}
