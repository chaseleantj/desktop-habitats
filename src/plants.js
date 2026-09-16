import * as THREE from "three";
import { GeometryBatch, groundHeight, range, random, vec } from "./math.js";
import { FLOW_DIRECTION } from "./water.js";
import { TAU, blade, foliageDepth, foliageMaterial, stem } from "./foliage.js";
import { plantForeground } from "./broadleaf.js";
import { plantStems } from "./stemplants.js";

const FLOW_ANGLE = Math.atan2(FLOW_DIRECTION.z, FLOW_DIRECTION.x);

// Rivergrass: a rosette of long, very thin ribbon leaves. Older outer leaves are longer,
// paler and lean further; most leaves grow out along the current that has shaped them,
// and the oldest tips have begun to brown.
function ribbonRosette(batch, x, z, height, count) {
  const root = vec(x, groundHeight(x, z) - 0.025, z);
  for (let i = 0; i < count; i++) {
    const age = random();
    const theta =
      random() < 0.6 ? FLOW_ANGLE + range(-1.2, 1.2) : range(0, TAU);
    const h = height * (0.5 + 0.65 * age) * range(0.92, 1.08);
    const sweep = range(1.0, 3.6) * (0.6 + 0.6 * age);
    const direction = vec(Math.cos(theta), 0, Math.sin(theta));
    const base = root.clone().addScaledVector(direction, range(0, 0.08));
    const points = [
      base,
      base.clone().add(vec(direction.x * 0.08, h * 0.7, direction.z * 0.08)),
      base
        .clone()
        .add(
          vec(direction.x * sweep * 0.3, h * 1.2, direction.z * sweep * 0.3),
        ),
      base
        .clone()
        .add(vec(direction.x * sweep, h * range(0.87, 1), direction.z * sweep)),
    ];
    const color = new THREE.Color().setHSL(
      0.235 + 0.055 * (1 - age) + range(-0.012, 0.012),
      range(0.7, 0.88),
      0.2 + 0.17 * age,
    );
    blade(batch, points, range(0.044, 0.115), color, root, range(0.85, 1.15), {
      rows: 30,
      cols: 6,
      twist: theta + Math.PI / 2,
      ribbon: true,
      thin: 1,
      browning: age > 0.82 ? range(0.08, 0.2) : 0,
    });
  }
}

function fernTuft(batch, center, size, count, onWood = false) {
  for (let i = 0; i < count; i++) {
    const a = range(0, TAU),
      length = range(0.5, 1.15) * size;
    const root = center
      .clone()
      .add(
        vec(
          range(-0.15, 0.15),
          range(onWood ? -0.2 : -0.04, onWood ? 0.2 : 0.04),
          range(-0.1, 0.1),
        ),
      );
    const end = root
      .clone()
      .add(
        vec(
          Math.cos(a) * length,
          range(onWood ? -0.12 : 0.1, onWood ? 0.5 : 0.4) * size,
          Math.sin(a) * length * (onWood ? 0.36 : 0.7),
        ),
      );
    const mid = root
      .clone()
      .lerp(end, 0.45)
      .add(vec(0, length * 0.32, 0));
    const color = new THREE.Color().setHSL(
      range(0.225, 0.29),
      0.85,
      range(0.14, 0.28),
    );
    blade(
      batch,
      [root, mid, end],
      range(0.028, 0.061) * size,
      color,
      root,
      0.3,
      { rows: 18, cols: 4, twist: a + 1.57, thin: 0.4 },
    );
  }
}

// The two grass beds, as volumes the fish can swim into.
const THICKETS = [
  { minX: -8.8, maxX: -1.9, minZ: -5.7, maxZ: -2, minY: 1.2, maxY: 6.5 },
  { minX: 3.0, maxX: 8.7, minZ: -5.7, maxZ: -2, minY: 1.2, maxY: 6.5 },
];

export function createPlants(scene) {
  const batch = new GeometryBatch();
  for (let i = 0; i < 36; i++) {
    const bed = THICKETS[i < 20 ? 0 : 1];
    ribbonRosette(
      batch,
      range(bed.minX, bed.maxX),
      range(bed.minZ, bed.maxZ),
      range(6.6, 9.3),
      Math.floor(range(9, 15)),
    );
  }
  for (let i = 0; i < 12; i++) {
    const x = range(-8.4, 8.4),
      z = range(-5.9, -4.8);
    ribbonRosette(batch, x, z, range(4.6, 7.5), 10);
  }
  plantForeground(batch);
  // Foreground tufts and epiphytes break up the rock-to-sand boundaries.
  for (const [x, z, h, n] of [
    [-3.65, -0.8, 2.5, 15],
    [-4.2, 0.8, 1.1, 12],
    [-2.8, -2, 2.8, 12],
    [0.2, -1.2, 1.6, 10],
    [4.8, -1, 1.8, 11],
    [7.8, 1.2, 0.7, 8],
  ])
    ribbonRosette(batch, x, z, h, n);
  for (const [x, y, z, s, n, onWood] of [
    [1.55, 3.07, 0.05, 1.05, 48, true],
    [2.38, 2.77, 0.15, 0.9, 40, true],
    [0.98, 3.42, -0.3, 0.75, 30, true],
    [-3.55, 0.55, 0.75, 0.8, 30],
    [-3.2, 1.12, -0.25, 0.9, 36],
    [0.6, 0.34, 0.5, 0.65, 24],
    [-6.1, 0.35, 1.25, 0.7, 25],
    [4.3, 0.4, -0.3, 0.8, 24],
  ])
    fernTuft(batch, vec(x, y, z), s, n, onWood);
  plantStems(batch);
  const mesh = new THREE.Mesh(batch.geometry(), foliageMaterial());
  mesh.customDepthMaterial = foliageDepth();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, thickets: THICKETS };
}
