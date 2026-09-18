import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Each process starts the same procedural streams. Check that thinning does not
// accidentally reshuffle the foreground or any later consumer of the shared RNG.
if (process.argv[2] === '--sample') {
  register('./three-loader.mjs', import.meta.url);
  const THREE = await import('three');
  const { createPlants } = await import('../src/plants.js');
  const { random } = await import('../src/math.js');
  const reference = process.argv[3] === 'reference';
  const plants = createPlants(new THREE.Scene(), reference ? {
    backgroundDensity:1,backgroundRows:30,backgroundCols:6,
  } : {});
  const hash = createHash('sha256');
  const {geometry} = plants.mesh;
  for (const attribute of Object.values(geometry.attributes)) {
    const tail = attribute.array.subarray(plants.stats.backgroundVertices * attribute.itemSize);
    hash.update(Buffer.from(tail.buffer,tail.byteOffset,tail.byteLength));
    for (const value of attribute.array) assert(Number.isFinite(value));
  }
  for (const index of geometry.index.array) assert(index < geometry.attributes.position.count);
  console.log(JSON.stringify({stats:plants.stats,foregroundHash:hash.digest('hex'),nextRandom:random()}));
} else {
  const sample = (profile) => {
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--sample',profile],{encoding:'utf8',maxBuffer:2**20});
    assert.equal(child.status,0,child.stderr);
    return JSON.parse(child.stdout.trim());
  };
  const before=sample('reference'),after=sample('balanced');
  assert.equal(after.stats.backgroundCandidates,before.stats.backgroundCandidates);
  assert(Math.abs(after.stats.backgroundKept / after.stats.backgroundCandidates - 0.7)<0.001);
  assert(after.stats.backgroundTriangles < before.stats.backgroundTriangles * 0.24);
  assert.equal(before.foregroundHash,after.foregroundHash,'Foreground geometry must be unchanged');
  assert.equal(before.nextRandom,after.nextRandom,'Subsequent procedural random state must be unchanged');
  assert.equal(before.stats.vertices-before.stats.backgroundVertices,after.stats.vertices-after.stats.backgroundVertices);
  console.log(`PASS: rear ribbons ${before.stats.backgroundKept} -> ${after.stats.backgroundKept}; rear triangles ${before.stats.backgroundTriangles} -> ${after.stats.backgroundTriangles}; foreground attributes and downstream RNG byte-for-byte unchanged`);
}
