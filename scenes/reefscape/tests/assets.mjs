import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
register('../../riverscape/tests/three-loader.mjs',import.meta.url);
const { makeFishGeometry }=await import('../src/fish-model.js');
import { TANK } from '../src/layout.js';

for(const kind of ['clown','chromis','anthias']){
  const geo=makeFishGeometry(kind),count=geo.attributes.position.count;
  assert.equal(geo.attributes.part.count,count,kind+' anatomical attribute alignment');
  for(const attr of Object.values(geo.attributes))assert.ok([...attr.array].every(Number.isFinite),kind+' finite vertex attributes');
  assert.ok([...geo.index.array].every(i=>i<count),kind+' valid indexed topology');
  geo.dispose();
}
const file=await readFile(new URL('../assets/live-rock.bin',import.meta.url));
const b=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),h=new Uint32Array(b,0,4),N=h[2],I=h[3];
assert.equal(h[0],0x52454546);assert.equal(h[1],1);
const p=new Float32Array(b,16,N*3),n=new Float32Array(b,16+N*12,N*3),offset=Math.ceil((16+N*27)/4)*4,idx=new Uint32Array(b,offset,I);
assert.ok([...p,...n].every(Number.isFinite));assert.ok([...idx].every(i=>i<N));
let outward=0,samples=0;
for(let i=0;i<I;i+=18){const a=idx[i]*3,c=idx[i+1]*3,d=idx[i+2]*3;const u=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]],v=[p[d]-p[a],p[d+1]-p[a+1],p[d+2]-p[a+2]];const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(cross[0]*n[a]+cross[1]*n[a+1]+cross[2]*n[a+2]>0)outward++;samples++;}
assert.ok(outward/samples>.96,'outward-facing limestone topology');
const sf=await readFile(new URL('../assets/rock-support.bin',import.meta.url)),sb=sf.buffer.slice(sf.byteOffset,sf.byteOffset+sf.byteLength),sh=new Uint32Array(sb,0,2),heights=new Float32Array(sb,8);
assert.equal(heights.length,sh[0]*sh[1]);assert.ok([...heights].every(y=>Number.isFinite(y)&&y<TANK.surface&&y>-.8));
console.log(JSON.stringify({pass:true,indexedFishModels:3,limestoneVertices:N,limestoneTriangles:I/3,outwardNormalAgreement:outward/samples,attachmentField:[sh[0],sh[1]]},null,2));
