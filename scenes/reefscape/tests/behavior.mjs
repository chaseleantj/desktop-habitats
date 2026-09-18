import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../../riverscape/tests/three-loader.mjs', import.meta.url);
const { ReefSimulation, FIXED_STEP, POPULATION }=await import('../src/simulation.js');
const { currentAt,responseAt,WAVES,SURFACE }=await import('../src/water.js');
const { HOST }=await import('../src/terrain.js');
const { THICKETS }=await import('../src/layout.js');
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
let maxHome=0,nearThicket=0,chromisSamples=0,maleBelow=0,samples=0,cleaned=0,displayed=0,henDisplayed=0,upcurrent=0;
for(let i=0;i<60*180;i++){
  if(i===60*10||i===60*32)sim.feed(-1.5,1.3);
  sim.step(FIXED_STEP);
  for(const f of sim.fish){if(f.state==='clean')cleaned++;if(f.state==='display')f.rank?henDisplayed++:displayed++;}
  if(i%60===0){
    assert.ok(sim.diagnostics().finite);
    for(const f of sim.fish){
      assert.ok(f.velocity.length()<1.701);
      if(f.kind==='clown')maxHome=Math.max(maxHome,Math.hypot(f.position.x-HOST.x,f.position.y-HOST.y,f.position.z-HOST.z));
      // A chromis lives over an Acropora colony. It may cross to the other one — that is
      // how a pod splits and fuses — but it must not spend its life touring the open tank.
      if(f.kind==='chromis'){chromisSamples++;nearThicket+=THICKETS.some(c=>Math.hypot(f.position.x-c.x,f.position.z-c.z)<4.0)?1:0;}
    }
    // Only while the harem is actually holding station: a scare, the male's own U-swim and
    // a pinch of food all break the layering, and are meant to.
    if(sim.food.every(p=>!p.active)&&goldies.every(f=>f.alarm<=0&&f.display<=0&&f.hold<=0)){maleBelow+=male.position.y<hens.reduce((s,f)=>s+f.position.y,0)/hens.length?1:0;samples++;}
    const shoal=sim.shoals[2],flow=currentAt(shoal.home,sim.time,V());
    if(Math.abs(flow.x)>.15)upcurrent+=Math.sign(shoal.centre.x-shoal.home.x)===-Math.sign(flow.x)?1:0;
  }
}
// Popper & Fishelson: the territorial male holds the water by the rock with the females
// ranging above him. Reversing this is an easy accident and an obvious error to a keeper.
assert.ok(maleBelow/samples>.92,`Terminal male sat below the harem ${maleBelow}/${samples} of the time`);
assert.ok(maxHome<2.6,`Clownfish host radius ${maxHome}`);
assert.ok(nearThicket/chromisSamples>.90,`Chromis over a coral head ${nearThicket}/${chromisSamples} of the time`);
assert.ok(cleaned>0,'Fish must visit the cleaner shrimp');
assert.ok(displayed>0&&henDisplayed===0,`U-swim is male-only: male ${displayed}, females ${henDisplayed}`);
assert.ok(upcurrent>0,'The anthias must hold up-current of their promontory');
assert.ok(sim.consumed>0,'Fish must actually consume food');
assert.equal(sim.food.filter(p=>p.active).length,0,'Food bounded lifetime');
const a=new ReefSimulation(42),b=new ReefSimulation(42);
for(let i=0;i<600;i++){a.step(FIXED_STEP);b.step(FIXED_STEP);}
for(let i=0;i<a.fish.length;i++)assert.deepEqual(a.fish[i].position.toArray(),b.fish[i].position.toArray());
const threatened=a.fish[0];const pointer={position:threatened.position.clone(),speed:8};a.step(FIXED_STEP,pointer);assert.equal(threatened.state,'shelter');
// A startle runs through a school as a wave, not as one event. Frighten a single chromis
// and its pod must follow within a few frames — but not in the same one.
const wave=new ReefSimulation();for(let i=0;i<900;i++)wave.step(FIXED_STEP);
const seed=wave.fish.find(f=>f.kind==='chromis'),pod=wave.fish.filter(f=>f.kind==='chromis'&&f!==seed&&f.shoal===seed.shoal);
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
