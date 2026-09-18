import * as THREE from "three";
import {
  GeometryBatch,
  groundHeight,
  range,
  random,
  smoothstep,
  vec,
} from "./math.js";
import { FLOW_DIRECTION } from "./water.js";
import { TAU, blade, foliageDepth, foliageMaterial } from "./foliage.js";
import { plantForeground } from "./broadleaf.js";
import { plantStems } from "./stemplants.js";

const FLOW_ANGLE = Math.atan2(FLOW_DIRECTION.z, FLOW_DIRECTION.x);

// Rivergrass: a rosette of long, very thin ribbon leaves. Older outer leaves are longer,
// paler and lean further; most leaves grow out along the current that has shaped them,
// and the oldest tips have begun to brown.
function ribbonRosette(batch, x, z, height, count, background = null) {
  const root = vec(x, groundHeight(x, z) - 0.025, z);
  for (let i = 0; i < count; i++) {
    const age = random();
    const theta =
      random() < 0.72 ? FLOW_ANGLE + range(-0.95, 0.95) : range(0, TAU);
    const h = height * (0.5 + 0.65 * age) * range(0.92, 1.08);
    const sweep = range(0.7, 3.0) * (0.6 + 0.6 * age);
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
      rows: background ? background.rows : 30,
      cols: background ? background.cols : 6,
      emit: background ? background.keep() : true,
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

// A dead leaf on the sand: a blade that let go, browned and curling, and drifted until it
// caught on a bank. `heading` is the way the midrib points.
function fallenLeaf(batch, x, z, length, heading) {
  const direction = vec(Math.cos(heading), 0, Math.sin(heading));
  const root = vec(x, groundHeight(x, z) + 0.012, z);
  const points = [
    root,
    root.clone().addScaledVector(direction, length * 0.5).add(vec(0, 0.035, 0)),
    root.clone().addScaledVector(direction, length).add(vec(0, 0.07, 0)),
  ];
  const color = new THREE.Color().setHSL(
    range(0.08, 0.12),
    range(0.35, 0.5),
    range(0.2, 0.3),
  );
  blade(batch, points, 0.11, color, root, 0.04, {
    rows: 14,
    cols: 6,
    twist: heading + Math.PI / 2,
    thin: 0.2,
    browning: 0.7,
  });
}

// The two grass beds, as volumes the fish can swim into.
export const THICKETS = [
  { minX: -9.2, maxX: -3.2, minZ: -5.7, maxZ: -2, minY: 1.2, maxY: 6.5 },
  { minX: 4.4, maxX: 9.0, minZ: -5.7, maxZ: -2, minY: 1.2, maxY: 6.5 },
];
// Where the rivergrass is planted. It spreads by runners, so a bed is dense clumps with
// thinner grass between them, not an even fill. The two side beds are tallest at the ends
// of the tank and step down toward the channel; the left bed is the heavier, answering the
// main stone and the foot of the wood on the right. A short stand in the shade at the back
// of the middle carries the planting down under the open water without closing it.
const BEDS = [
  { minX: -9.6, maxX: -2.6, minZ: -5.7, maxZ: -2.0, clumps: 9 },
  { minX: 3.9, maxX: 10.4, minZ: -5.7, maxZ: -2.2, clumps: 7 },
  { minX: -2.8, maxX: 3.8, minZ: -5.8, maxZ: -3.6, clumps: 6, height: 0.85 },
];
const grassHeight = (x) => 5.4 + 4.0 * smoothstep(2.0, 7.5, Math.abs(x));

export function createPlants(scene, {
  backgroundDensity = 0.7, backgroundRows = 20, backgroundCols = 2, animatedShadows = true,
} = {}) {
  const batch = new GeometryBatch();
  const density = Number.isFinite(backgroundDensity) ? Math.max(0, Math.min(1, backgroundDensity)) : 0.7;
  const stats = { backgroundCandidates: 0, backgroundKept: 0 };
  const background = {
    rows: Math.max(4, Math.round(backgroundRows)),
    cols: Math.max(2, Math.round(backgroundCols)),
    keep() {
      const i = stats.backgroundCandidates++;
      // Distributed, deterministic thinning, not clump removal. No extra random draws:
      // the retained leaves, rocks, foreground plants and fish keep their old seeds.
      const keep = Math.floor((i + 1) * density + 1e-9) > Math.floor(i * density + 1e-9);
      if (keep) stats.backgroundKept++;
      return keep;
    },
  };
  for (const bed of BEDS) {
    const scale = bed.height ?? 1;
    for (let c = 0; c < bed.clumps; c++) {
      const cx = range(bed.minX, bed.maxX),
        cz = range(bed.minZ, bed.maxZ),
        spread = range(0.5, 1.1);
      const rosettes = Math.floor(range(4, 7));
      for (let i = 0; i < rosettes; i++) {
        const a = range(0, TAU),
          d = spread * Math.sqrt(random());
        const x = cx + Math.cos(a) * d,
          z = cz + Math.sin(a) * d * 0.7;
        ribbonRosette(
          batch,
          x,
          z,
          grassHeight(x) * scale * range(0.85, 1.1),
          Math.floor(range(10, 16)),
          background,
        );
      }
    }
    // Runners have set a few young plants out on their own between the clumps.
    for (let i = 0; i < 4; i++) {
      const x = range(bed.minX, bed.maxX);
      ribbonRosette(
        batch,
        x,
        range(bed.minZ, bed.maxZ),
        grassHeight(x) * scale * range(0.55, 0.8),
        Math.floor(range(5, 8)),
        background,
      );
    }
  }
  // A back row against the glass, shorter in the shade of the beds, and absent from the
  // middle where the channel runs back into open water.
  for (let i = 0; i < 10; i++) {
    const x = range(3.4, 9.8) * (i % 2 ? 1 : -1);
    ribbonRosette(batch, x, range(-5.9, -4.8), grassHeight(x) * range(0.6, 0.85), 10, background);
  }
  stats.backgroundVertices = batch.positions.length / 3;
  stats.backgroundTriangles = batch.indices.length / 3;
  plantForeground(batch);
  // Tufts along the banks break up the stone-to-sand boundaries, and two at the far right
  // carry the bed down to the glass so no bare sand shows behind the Echinodorus.
  for (const [x, z, h, n] of [
    [-3.5, -1.0, 2.4, 14],
    [-4.3, 0.9, 1.1, 12],
    [-2.6, -2.2, 2.6, 12],
    [-1.4, -1.9, 1.4, 9],
    [4.6, -1.5, 1.9, 11],
    [2.6, -1.6, 1.5, 9],
    [9.3, -2.6, 2.4, 12],
    [9.8, -1.9, 1.8, 10],
  ])
    ribbonRosette(batch, x, z, h, n);
  // Fern tufts: three on the moss clump at the fork of the trunk, the rest in the crevices
  // where stone meets sand.
  for (const [x, y, z, s, n, onWood] of [
    [1.55, 3.07, 0.05, 1.05, 48, true],
    [2.38, 2.77, 0.15, 0.9, 40, true],
    [0.98, 3.42, -0.3, 0.75, 30, true],
    [-3.6, 0.4, 0.75, 0.7, 26],
    [-3.75, 1.55, 0.05, 0.85, 32],
    [2.35, 0.3, 0.8, 0.6, 22],
    [-5.25, 0.3, 1.15, 0.65, 24],
    [3.2, 0.3, 0.75, 0.7, 22],
  ])
    fernTuft(batch, vec(x, y, z), s, n, onWood);
  // A mature tank sheds: a few dead leaves lie in the channel, on the open sand at the
  // glass and at the foot of the stones.
  for (const [x, z, length, heading] of [
    [-1.35, 2.2, 1.1, 0.4],
    [1.9, 0.95, 0.9, 2.6],
    [-5.55, 1.7, 0.8, 1.2],
    [0.7, -1.6, 0.75, -0.5],
    [7.2, 2.1, 0.85, 2.0],
  ])
    fallenLeaf(batch, x, z, length, heading);
  plantStems(batch);
  // Young runners taper the left bed into the fine stems, with gaps between shoots.
  for (const [x, z, height, leaves] of [
    [-10.15, -3.15, 3.2, 3],
    [-9.55, -3.55, 4.5, 4],
    [-9.05, -2.85, 5.3, 4],
    [-8.55, -3.3, 6.1, 5],
  ])
    ribbonRosette(batch, x, z, height, leaves);
  const mesh = new THREE.Mesh(batch.geometry(), foliageMaterial());
  mesh.name = 'Aquatic planting';
  mesh.customDepthMaterial = foliageDepth({ animated: animatedShadows });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  stats.vertices = mesh.geometry.attributes.position.count;
  stats.triangles = mesh.geometry.index.count / 3;
  return { mesh, thickets: THICKETS, stats };
}
