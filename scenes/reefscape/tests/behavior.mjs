import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../../riverscape/tests/three-loader.mjs', import.meta.url);
const { ReefSimulation, FIXED_STEP, POPULATION, SHRIMP }=await import('../src/simulation.js');
const { currentAt,responseAt,WAVES,SURFACE }=await import('../src/water.js');
const { HOST }=await import('../src/terrain.js');
const { Vector3 }=await import('three');
const V=(x=0,y=0,z=0)=>new Vector3(x,y,z);
const sim=new ReefSimulation();
assert.equal(sim.fish.length,19);assert.equal(sim.shrimp.length,2);assert.equal(POPULATION.clownfish,3);
// Percula sizes must stay on Buston & Cant's ladder: 1.26 between adjacent ranks, 1.37
// for the two smallest. A group that drifts off it stops reading as a dominance queue.
const clowns=sim.fish.filter(f=>f.kind==='clown').map(f=>f.size);
assert.ok(Math.abs(clowns[0]/clowns[1]-1.26)<.05&&Math.abs(clowns[1]/clowns[2]-1.37)<.05,`Rank ratios ${clowns}`);
// The terminal male is half again the length of his females, as FishBase's 15 cm against
// 7 cm and an aquarium harem's 12.5 cm against 9 both imply.
const goldies=sim.fish.filter(f=>f.kind==='anthias');
const male=goldies.find(f=>!f.rank),hens=goldies.filter(f=>f.rank);
assert.ok(male.size/(hens.reduce((s,f)=>s+f.size,0)/hens.length)>1.35,'Terminal male must outsize the harem');
let maxHome=0,cleaned=0,displayed=0,henDisplayed=0;
// The male retains a lower local slot, but a travelling group is not required to hold a
// fixed vertical hierarchy while turning, feeding, diving or navigating reef obstacles.
assert.ok(male.position.y<hens.reduce((n,f)=>n+f.position.y,0)/hens.length);
let shrimpRange=[0,0],shrimpHome=[0,0],shrimpWalked=0,advertising=0;
const shrimpWas=sim.shrimp.map(s=>s.position.clone());
for(let i=0;i<60*180;i++){
  if(i===60*10||i===60*32)sim.feed(-1.5,1.3);
  sim.step(FIXED_STEP);
  for(const f of sim.fish){if(f.state==='clean')cleaned++;if(f.state==='display')f.rank?henDisplayed++:displayed++;}
  // A cleaner shrimp is a station animal that takes excursions: it works its own shoulder,
  // leaves it for the sand or the next rock now and then and comes back, and every channel
  // the vertex shaders read has to stay finite.
  sim.shrimp.forEach((s,i)=>{
    const away=Math.hypot(s.position.x-s.home.x,s.position.z-s.home.z);shrimpRange[i]=Math.max(shrimpRange[i],away);if(away<SHRIMP.range+.1)shrimpHome[i]++;
    shrimpWalked+=Math.hypot(s.position.x-shrimpWas[i].x,s.position.z-shrimpWas[i].z);shrimpWas[i].copy(s.position);
    assert.ok([s.position.x,s.position.y,s.position.z,s.yaw,s.step,s.walk,s.pick,s.sway,s.signal,s.flick,s.reach,s.curl,s.rhythm].every(Number.isFinite),'Shrimp state finite');
  });
  advertising+=sim.shrimp.some(s=>s.state==='advertise')?1:0;
  if(i%60===0){
    assert.ok(sim.diagnostics().finite);
    for(const f of sim.fish){
      assert.ok(f.velocity.length()<1.701);
      if(f.kind==='clown')maxHome=Math.max(maxHome,Math.hypot(f.position.x-HOST.x,f.position.y-HOST.y,f.position.z-HOST.z));
    }
  }
}
assert.ok(maxHome<2.6,`Clownfish host radius ${maxHome}`);
// Reef-wide coverage now lives in locomotion.mjs. The old requirement that chromis
// remain over one coral >72% of the time contradicted free roaming.
// A fish swims where it points. Its velocity through the water must lie along its heading
// whenever it is under way; a body sliding sideways to its goal is the tell of a tracker.
let aligned=0,moving=0;const flow=V(),rel=V(),head=V();
for(let i=0;i<60*20;i++){sim.step(FIXED_STEP);for(const f of sim.fish){currentAt(f.position,sim.time,flow);rel.copy(f.velocity).sub(flow);if(rel.length()<.2)continue;head.set(Math.cos(f.yaw)*Math.cos(f.pitch),Math.sin(f.pitch),-Math.sin(f.yaw)*Math.cos(f.pitch));moving++;if(head.dot(rel)/rel.length()>.94)aligned++;}}
assert.ok(aligned/moving>.85,`Fish swim along their heading ${aligned}/${moving} of the time`);
// And it does not beat its tail without going anywhere: a bout must be followed by a
// glide, so no species beats more than half the time or glides all of it.
for(const kind of ['chromis','anthias']){const of=sim.fish.filter(f=>f.kind===kind);let beats=0,n=0;for(let i=0;i<60*30;i++){sim.step(FIXED_STEP);for(const f of of){n++;if(f.beat)beats++;}}assert.ok(beats/n>.12&&beats/n<.55,`${kind} bout fraction ${(beats/n).toFixed(2)}`);}
assert.ok(cleaned>0,'Fish must visit the cleaner shrimp');
// Stop-and-go over its own patch, and out and back: in three minutes each shrimp has to cover
// real ground, leave its shoulder at least once, never go further than an excursion allows,
// and still spend most of its time at the station, advertising often enough for a fish to come.
assert.ok(shrimpWalked>3,`Shrimp walked only ${shrimpWalked.toFixed(2)} u`);
sim.shrimp.forEach((s,i)=>{
  assert.ok(shrimpRange[i]>.9&&shrimpRange[i]<SHRIMP.roam+.2,`Shrimp ${i} strayed ${shrimpRange[i].toFixed(2)} u from its station`);
  assert.ok(shrimpHome[i]/(60*180)>.55,`Shrimp ${i} was at its station only ${(100*shrimpHome[i]/(60*180)).toFixed(0)}% of the time`);
});
assert.ok(advertising/(60*180)>.5,`A shrimp was advertising only ${(100*advertising/(60*180)).toFixed(0)}% of the time`);
assert.ok(displayed>0&&henDisplayed===0,`U-swim is male-only: male ${displayed}, females ${henDisplayed}`);
assert.ok(sim.consumed>0,'Fish must actually consume food');
assert.equal(sim.food.filter(p=>p.active).length,0,'Food bounded lifetime');
const a=new ReefSimulation(42),b=new ReefSimulation(42);
for(let i=0;i<600;i++){a.step(FIXED_STEP);b.step(FIXED_STEP);}
for(let i=0;i<a.fish.length;i++)assert.deepEqual(a.fish[i].position.toArray(),b.fish[i].position.toArray());
const threatened=a.fish[0];const pointer={position:threatened.position.clone(),speed:8};a.step(FIXED_STEP,pointer);assert.equal(threatened.state,'shelter');
// A startle runs through a school as a wave, not as one event. Frighten a single chromis
// and its pod must follow within a few frames — but not in the same one.
const wave=new ReefSimulation();
const seed=wave.fish.find(f=>f.kind==='chromis'),pod=wave.fish.filter(f=>f.kind==='chromis'&&f!==seed&&f.shoal===seed.shoal);
// A known nearby chain tests communication, not the chance that a travelling fish
// happens to have neighbours at one arbitrary moment.
[seed,...pod].forEach((f,i)=>{f.position.set(-.8+i*.65,6.8,3.4);f.velocity.set(0,0,0);f.goal.copy(f.position);f.goalTimer=5;});
seed.alarm=2.6;wave.step(FIXED_STEP);
const first=pod.filter(f=>f.alarm>0).length;
assert.ok(first<pod.length,`A startle cannot reach a whole pod in one frame (${first}/${pod.length})`);
for(let i=0;i<12;i++)wave.step(FIXED_STEP);
assert.ok(pod.filter(f=>f.alarm>0).length>first,'A startle must keep spreading through the pod');
const pool=new ReefSimulation();for(let i=0;i<30;i++){pool.lastFeed=-100;pool.feed(0,1);}assert.equal(pool.food.filter(p=>p.active).length,32);
assert.equal(pool.feed(0,1),0,'Feed cooldown works');
for(const t of [0,1,10,100,10000]){
 const v=currentAt(V(0,2,0),t,V());assert.ok(v.toArray().every(Number.isFinite));assert.ok(v.length()<1.8);
 const response=responseAt(V(0,2,0),t,.8,V());assert.ok(response.toArray().every(Number.isFinite));
}
for(const w of WAVES)assert.ok(Math.abs(w.omega*w.omega-98.1*w.k*Math.tanh(w.k*SURFACE))<1e-9);
assert.throws(()=>sim.step(NaN),RangeError);assert.throws(()=>sim.step(1),RangeError);
console.log(JSON.stringify({pass:true,simulatedSeconds:sim.time,consumed:sim.consumed,maxClownfishHostDistance:maxHome,...sim.diagnostics()},null,2));
