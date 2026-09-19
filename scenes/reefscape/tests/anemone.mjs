import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../../riverscape/tests/three-loader.mjs',import.meta.url);
const { ANEMONES,HOST }=await import('../src/layout.js');
const { buildCrown,crownOrder,crownBudget }=await import('../src/anemone-crown.js');
const { createAnemone,TENTACLE_COUNT }=await import('../src/anemone.js');
const THREE=await import('three');
let total=0;const summary=[];
for(let i=0;i<ANEMONES.length;i++){
  const crown=buildCrown(ANEMONES[i],i),{roots,S,rim,count,compact}=crown;total+=count;
  assert.equal(count,roots.length);
  assert.deepEqual(crown,buildCrown(ANEMONES[i],i),'Crown generation is deterministic');
  const order=crownOrder(roots);assert.equal(new Set(order).size,count);
  for(const a of roots){
    assert.ok(Object.values(a).every(Number.isFinite));
    assert.ok(a.radius>.20&&a.radius<=1,'Mouth stays bare and roots stay on the disc');
    assert.ok(a.length>0&&a.girth>0);
    if(compact){
      assert.ok(a.length/(2*rim*S)<.48,'Compact tentacles stay below half the disc diameter');
      assert.ok(a.tilt+a.curl<1.5,'Small crowns do not hook long tentacles below the oral disc');
      assert.ok(a.flex<.65,'Short tentacles are less compliant, not miniature streamers');
      for(const b of roots)if(a!==b){
        const d=Math.hypot(Math.cos(a.angle)*a.radius-Math.cos(b.angle)*b.radius,Math.sin(a.angle)*a.radius-Math.sin(b.angle)*b.radius)*rim*S;
        assert.ok(a.girth+b.girth<=d*.85+1e-9,'Tentacle roots must not intersect');
      }
    }
  }
  for(const quality of ['eco','balanced','detail']){
    const budget=crownBudget(crown,quality);
    assert.ok(budget<=count);if(compact)assert.ok(budget>=Math.min(count,36));
    const visible=order.slice(0,budget).map(j=>roots[j]);
    for(let sector=0;sector<6;sector++)assert.ok(visible.some(t=>Math.floor(((t.angle%(Math.PI*2)+Math.PI*2)%(Math.PI*2))/(Math.PI/3))===sector),'All angular sectors survive LOD');
  }
  summary.push({radius:ANEMONES[i].radius,count,compact,meanLength:roots.reduce((n,r)=>n+r.length,0)/count});
}
assert.equal(total,TENTACLE_COUNT);
const host=buildCrown(HOST);assert.equal(host.compact,false);assert.equal(host.rim,.36);assert.equal(host.height,.66);assert.equal(host.count,Math.round(110*(HOST.radius/.9)**1.3));
const scene=new THREE.Scene(),anemone=createAnemone(scene);
for(const quality of ['detail','eco','balanced','detail']){
  anemone.setQuality(quality);
  assert.equal(anemone.tentacles.count,ANEMONES.reduce((n,a,i)=>n+crownBudget(buildCrown(a,i),quality),0));
  for(const attribute of Object.values(anemone.tentacles.geometry.attributes))assert.ok([...attribute.array].every(Number.isFinite));
}
assert.equal(scene.children.length,2,'Still one tentacle draw plus one merged-body draw');
console.log(JSON.stringify({pass:true,total,anemones:summary},null,2));
